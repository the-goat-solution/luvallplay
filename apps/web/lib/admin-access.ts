// Same database as the rest of the site, whichever bundle loads this (lib/db-env.ts).
import "./db-env";
import { sql } from "./database";
import { cookies } from "next/headers";
import { PLAYER_COOKIE, sessionForToken } from "./player-auth";
import {
  adminApiAllowed,
  adminPathAllowed,
  getAccess,
  isStepUpFresh,
  writeAudit,
  type Access,
  type Actor,
  type AuditEntry,
  type Db,
} from "./admin-roles";
import { configureLocalNeon } from "./local-neon";

// Who is using admin right now (build plan §2.4).
//
// One way in: a signed-in player whose account has a club role or platform
// admin. Admin pages also need a sign-in within 12 hours. (The ADMIN_PASSWORD
// "break-glass" login was removed in Phase 2; old audit rows keep its name.)
//
// The middleware (Node runtime) calls resolveAdmin() for every /admin and
// /api/admin request, so server actions are covered too; pages and actions
// that change who is an admin check again with requireAdminActor().

// The middleware is its own bundle, so the local-test database hook
// (lib/local-neon.ts, a no-op unless NEON_LOCAL_WS_PROXY is set) runs here too.
const localReady = process.env.NEON_LOCAL_WS_PROXY ? configureLocalNeon() : Promise.resolve(false);

export const db: Db = {
  query: async (text, params) => {
    await localReady;
    return sql.query(text, params as unknown[] | undefined);
  },
};

export type AdminPlayer = { id: number; email: string; firstName: string; lastName: string };

export type AdminContext = { kind: "player"; player: AdminPlayer; access: Access; signedInAt: Date; stepUpFresh: boolean };

export type AdminVerdict =
  | { ok: true; ctx: AdminContext }
  | { ok: false; reason: "signed_out" | "no_access" | "not_allowed" | "step_up"; ctx?: AdminContext };

export type CookieReader = (name: string) => string | undefined;

/** Signed-in player's context (no permission decision yet). */
export async function adminContextFromCookies(read: CookieReader): Promise<AdminContext | null> {
  await localReady;
  const session = await sessionForToken(read(PLAYER_COOKIE));
  if (!session) return null;
  const { player, signedInAt } = session;
  const access = await getAccess(db, player.id, player.email);
  return {
    kind: "player",
    player: { id: player.id, email: player.email, firstName: player.firstName, lastName: player.lastName },
    access,
    signedInAt,
    stepUpFresh: isStepUpFresh(signedInAt),
  };
}

/** The decision for one admin page or API path. */
export function decide(ctx: AdminContext | null, path: string, api: boolean): AdminVerdict {
  if (!ctx) return { ok: false, reason: "signed_out" };
  const allowed = api ? adminApiAllowed(ctx.access) : adminPathAllowed(ctx.access, path);
  if (!ctx.access.role && !ctx.access.platformAdmin) return { ok: false, reason: "no_access", ctx };
  if (!allowed) return { ok: false, reason: "not_allowed", ctx };
  if (!ctx.stepUpFresh) return { ok: false, reason: "step_up", ctx };
  return { ok: true, ctx };
}

export async function resolveAdmin(read: CookieReader, path: string, api = false): Promise<AdminVerdict> {
  return decide(await adminContextFromCookies(read), path, api);
}

/** For server components: the current admin context (middleware already allowed the request). */
export async function currentAdmin(): Promise<AdminContext | null> {
  const store = await cookies();
  return adminContextFromCookies((n) => store.get(n)?.value);
}

export function actorFor(ctx: AdminContext): Actor {
  return { kind: "player", playerId: ctx.player.id, access: ctx.access };
}

/**
 * For server actions that change roles: re-check here, independent of the
 * middleware (defence in depth), including the 12-hour step-up.
 */
export async function requireAdminActor(path: string): Promise<{ ctx: AdminContext; actor: Actor }> {
  const store = await cookies();
  const verdict = await resolveAdmin((n) => store.get(n)?.value, path);
  if (!verdict.ok) throw new Error(`Admin access refused: ${verdict.reason}`);
  return { ctx: verdict.ctx, actor: actorFor(verdict.ctx) };
}

/** Writes an audit row; never lets a logging failure break the admin action. */
export async function audit(ctx: AdminContext | null, e: Omit<AuditEntry, "actorPlayerId" | "actorKind">): Promise<void> {
  try {
    await writeAudit(db, {
      actorPlayerId: ctx ? ctx.player.id : null,
      actorKind: ctx ? "player" : "system",
      ...e,
    });
  } catch (err) {
    console.error("[admin] audit write failed:", err);
  }
}

/** Route handlers under /api/admin: a full club admin with a fresh sign-in. */
export async function isAdminApiRequest(request: Request): Promise<boolean> {
  const verdict = await resolveAdmin((n) => readCookie(request, n), new URL(request.url).pathname, true);
  return verdict.ok;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** Whether this admin sees a page in the menu and on the Today page. */
export function canOpenAdminPage(ctx: AdminContext | null, href: string): boolean {
  return ctx ? adminPathAllowed(ctx.access, href) : false;
}
