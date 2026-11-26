// The players' app API (/api/v1/app/..., build plan §4.1): one wrapper every
// route handler goes through, so each route is validated at the edge,
// rate-limited, authenticated the same way and answers in the contract's
// shape (packages/api).
//
// - Who is calling: `Authorization: Bearer <session token>` (the app) or the
//   web's session cookie. Both are rows in player_sessions.
// - CORS: an allow-list (the app's host, the Capacitor web view origins),
//   never "*", because these routes accept credentials.
// - Bad input is always a 400 with a stable code, never a 500.
// - The answer is parsed with the contract's schema, which also drops any
//   field the contract doesn't name.
import { NextResponse } from "next/server";
import { ENDPOINTS, type BodyOf, type EndpointId, type ParamsOf, type QueryOf, type ResponseOf } from "@luvallplay/api/contract";
import { clubConfig } from "./club";
import { loadClubConfigFromDb, type ClubConfig } from "./club-config";
import { enabledModules } from "./club-modules";
import { sql } from "./database";
import { PLAYER_COOKIE, PLAYER_SESSION_DAYS, sessionForToken, sha256 } from "./player-auth";
import type { Player } from "./player-db";
import { slideSession } from "./repos/sessions";
import { checkRateLimit, getClientIp, rateLimit } from "./security";
import { defaultTenantSlug } from "./tenant-members";
import { deploymentRegion } from "./tenant-routing";

const SESSION_REFRESH_AFTER_MS = 60 * 60 * 1000;

// ── CORS ────────────────────────────────────────────────────────────────────

const FIXED_ORIGINS = ["https://app.luvallplay.com", "capacitor://localhost", "https://localhost"];
const DEV_ORIGINS = ["http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173", "http://127.0.0.1:4173"];

/** The origins allowed to call the API from a browser or web view. APP_ORIGINS adds more (comma-separated). */
export function allowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const extra = (env.APP_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter((s) => /^(https?|capacitor):\/\/[^\s/]+$/.test(s));
  return [...FIXED_ORIGINS, ...(env.NODE_ENV === "production" ? [] : DEV_ORIGINS), ...extra];
}

export function corsHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

// ── Errors ──────────────────────────────────────────────────────────────────

/** Thrown (or returned with `fail`) by a handler to answer with a contract error. */
export class AppApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra?: Record<string, unknown>;
  constructor(status: number, code: string, extra?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const fail = (status: number, code: string, extra?: Record<string, unknown>) => new AppApiError(status, code, extra);

// ── Who is calling ──────────────────────────────────────────────────────────

function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export type SessionToken = { token: string; via: "bearer" | "cookie" };

/** The session token on a request: the bearer header first, then the web's cookie. */
export function sessionTokenFrom(request: Request): SessionToken | null {
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  // "tw_…" is a personal access key (the integrations API), not a session.
  if (m && !m[1].startsWith("tw_")) return { token: m[1], via: "bearer" };
  const cookie = cookieValue(request, PLAYER_COOKIE);
  return cookie ? { token: cookie, via: "cookie" } : null;
}

export type AppSession = { player: Player; signedInAt: Date; token: string; via: "bearer" | "cookie" };

export async function sessionFrom(request: Request): Promise<AppSession | null> {
  const found = sessionTokenFrom(request);
  if (!found) return null;
  const session = await sessionForToken(found.token);
  if (!session) return null;
  // Keep the session alive while it is used, like the web does.
  try {
    await slideSession(sha256(found.token), PLAYER_SESSION_DAYS, SESSION_REFRESH_AFTER_MS);
  } catch (err) {
    console.error("[app-api] could not slide the session:", err);
  }
  return { ...session, ...found };
}

/**
 * A cookie is sent by the browser on its own, so a request that changes
 * something and is authenticated by cookie must come from a page we trust
 * (same host, or the allow-list). A bearer token is only ever sent on purpose.
 */
function cookieWriteAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    if (new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host)) return true;
  } catch {
    return false;
  }
  return allowedOrigins().includes(origin);
}

// ── Clubs ───────────────────────────────────────────────────────────────────

/** Where a region's API lives. Only Sydney exists today (build plan §6.9). */
export function apiBaseForRegion(region: string, request: Request): string | null {
  const configured = process.env[`API_BASE_${region.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`]?.trim().replace(/\/+$/, "");
  if (configured) return `${configured}/api/v1/app`;
  if (region !== deploymentRegion()) return null;
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return `${proto}://${host}/api/v1/app`;
}

let storedClub: { at: number; slug: string; config: ClubConfig } | null = null;

/**
 * The club this deployment serves, by its slug (TENANT_SLUG), or null when
 * it has no row yet. For the club the app's settings were written for, the
 * app's own settings source answers (lib/club.ts), so the API and the web
 * pages can never disagree. Any other club's settings come from its rows.
 */
export async function deploymentClub(now = Date.now()): Promise<ClubConfig | null> {
  const slug = defaultTenantSlug();
  const config = await clubConfig();
  if (config.slug === slug) return config;
  if (storedClub && storedClub.slug === slug && now - storedClub.at < 60_000) return storedClub.config;
  const stored = await loadClubConfigFromDb(sql, slug);
  if (!stored) return null;
  storedClub = { at: now, slug, config: stored.config };
  return stored.config;
}

// ── The wrapper ─────────────────────────────────────────────────────────────

export type Ctx<K extends EndpointId> = {
  request: Request;
  ip: string;
  params: ParamsOf<K>;
  query: QueryOf<K>;
  body: BodyOf<K>;
  /** Present when the endpoint needs a session; may be present on public ones too. */
  session: AppSession | null;
  /** The signed-in person (never null on a "session" endpoint). */
  player: Player;
  /** The club in the path (scope "club" endpoints). */
  club: ClubConfig;
};

type Handler<K extends EndpointId> = (ctx: Ctx<K>) => Promise<ResponseOf<K> | AppApiError>;
type RouteArgs = { params?: Promise<Record<string, string | string[] | undefined>> };
type Options = {
  /** The rate-limit bucket, when it should be shared with another surface (e.g. the web's sign-in or message routes). */
  rateKey?: (ip: string, session: AppSession | null) => string;
  /** The error code for a body that doesn't validate (default "bad_request"). */
  badRequestCode?: string;
};

export function appRoute<K extends EndpointId>(id: K, handler: Handler<K>, options: Options = {}) {
  const endpoint = ENDPOINTS[id] as (typeof ENDPOINTS)[EndpointId] & { params?: import("zod").ZodTypeAny; query?: import("zod").ZodTypeAny; body?: import("zod").ZodTypeAny; module?: string };

  const answer = (request: Request, data: unknown, status = 200) => NextResponse.json(data, { status, headers: corsHeaders(request) });
  const error = (request: Request, e: AppApiError) => answer(request, { error: e.code, ...e.extra }, e.status);

  async function handle(request: Request, args: RouteArgs = {}): Promise<Response> {
    try {
      const ip = getClientIp(request);
      if (!process.env.POSTGRES_URL) return error(request, fail(503, "unavailable"));

      const session = endpoint.auth === "session" || sessionTokenFrom(request) ? await sessionFrom(request) : null;
      if (endpoint.auth === "session" && !session) return error(request, fail(401, "unauthorized"));
      if (session?.via === "cookie" && endpoint.method !== "GET" && !cookieWriteAllowed(request)) return error(request, fail(403, "bad_origin"));

      const { limit, windowMs } = endpoint.rateLimit;
      const key = options.rateKey ? options.rateKey(ip, session) : `app:${id}:${session ? `p${session.player.id}` : ip}`;
      // Sign-in (the public endpoints) is counted in the shared store, so its
      // limits hold across server instances; the rest count per instance.
      const within = endpoint.auth === "public" && endpoint.method !== "GET" ? await rateLimit(key, limit, windowMs) : checkRateLimit(key, limit, windowMs);
      if (!within) return error(request, fail(429, "rate_limited"));

      const bad = fail(400, options.badRequestCode ?? "bad_request");
      let params: unknown;
      if (endpoint.params) {
        const parsed = endpoint.params.safeParse(await args.params);
        if (!parsed.success) return error(request, fail(404, "not_found"));
        params = parsed.data;
      }
      let club: ClubConfig | undefined;
      if (endpoint.scope === "club") {
        // One club per deployment until host routing is enforced: any other
        // slug doesn't exist here, whoever asks.
        const here = await deploymentClub();
        if (!here || (params as { club?: string } | undefined)?.club !== here.slug) return error(request, fail(404, "club_not_found"));
        club = here;
        // Before the query and body are looked at: with its module off, an
        // endpoint isn't there, whatever is sent to it.
        if (endpoint.module && !(await enabledModules(sql)).has(endpoint.module)) return error(request, fail(404, "module_off"));
      }

      let query: unknown;
      if (endpoint.query) {
        const parsed = endpoint.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!parsed.success) return error(request, bad);
        query = parsed.data;
      }
      let body: unknown;
      if (endpoint.body) {
        let raw: unknown;
        try {
          const text = await request.text();
          raw = text.trim() ? JSON.parse(text) : {};
        } catch {
          return error(request, bad);
        }
        const parsed = endpoint.body.safeParse(raw);
        if (!parsed.success) return error(request, bad);
        body = parsed.data;
      }

      const result = await handler({ request, ip, params, query, body, session, player: session?.player as Player, club: club as ClubConfig } as Ctx<K>);
      if (result instanceof AppApiError) return error(request, result);
      const checked = endpoint.response.safeParse(result);
      if (!checked.success) {
        console.error(`[app-api] ${id} answer doesn't match the contract:`, checked.error.issues.slice(0, 5));
        return error(request, fail(500, "contract"));
      }
      return answer(request, checked.data);
    } catch (err) {
      if (err instanceof AppApiError) return error(request, err);
      console.error(`[app-api] ${id} failed:`, err);
      return error(request, fail(500, "failed"));
    }
  }

  /** CORS preflight. */
  function preflight(request: Request): Response {
    return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
  }

  return { handle, preflight };
}
