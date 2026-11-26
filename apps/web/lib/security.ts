import { createHash } from "node:crypto";
import { clubClock } from "./club";
import { sql } from "./database";
import { hourLabel } from "./club-public";
import { isBookable, startOfDay } from "./dates";
import { sessionExists } from "./db";
import { isAdminApiRequest } from "./admin-access";

// ---------------------------------------------------------------------------
// Rate limits
//
// Two stores:
//
//   memory    (default) a count per server instance. Simple and free, but a
//             limit of 10 is 10 on EACH instance, and instances come and go.
//   database  RATE_LIMIT_STORE=database: one count in Postgres (the
//             rate_limits table, migration 0014), the same on every
//             instance (audit H6). One small statement per check.
//
// checkRateLimit() is the in-memory one and stays synchronous. rateLimit()
// follows RATE_LIMIT_STORE and is what sign-in uses; move a caller to it
// when its limit has to hold across instances. If the database can't answer
// (or the table isn't there yet), rateLimit() falls back to this instance's
// own count rather than letting everything through or locking everyone out.
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, { count: number; reset: number }>();

export function checkRateLimit(
  key: string,
  limit = 20,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.reset) {
    rateLimitMap.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

export type RateLimitStore = "memory" | "database";

export function rateLimitStore(env: Record<string, string | undefined> = process.env): RateLimitStore {
  return env.RATE_LIMIT_STORE?.trim().toLowerCase() === "database" ? "database" : "memory";
}

type RateLimitDb = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

let lastStoreError = "";

/**
 * One more request for `key`: true when it is within `limit` per `windowMs`.
 * A fixed window, like checkRateLimit: the first request opens it, and the
 * count starts again once it has passed.
 */
export async function rateLimit(key: string, limit = 20, windowMs = 60_000, db: RateLimitDb = sql): Promise<boolean> {
  if (rateLimitStore() !== "database" || (db === sql && !process.env.POSTGRES_URL)) return checkRateLimit(key, limit, windowMs);
  try {
    // One statement, so two instances can't both read "9" and both allow the tenth.
    const { rows } = await db.query(
      `INSERT INTO rate_limits AS r (key_hash, count, reset_at)
       VALUES ($1, 1, NOW() + ($2::bigint * INTERVAL '1 millisecond'))
       ON CONFLICT (key_hash) DO UPDATE SET
         count = CASE WHEN r.reset_at <= NOW() THEN 1 ELSE LEAST(r.count + 1, 1000000) END,
         reset_at = CASE WHEN r.reset_at <= NOW() THEN EXCLUDED.reset_at ELSE r.reset_at END
       RETURNING count;`,
      [createHash("sha256").update(key).digest("hex"), Math.max(1, Math.round(windowMs))],
    );
    // Now and then, clear out counters whose window passed long ago.
    if (Math.random() < 0.005) await db.query(`DELETE FROM rate_limits WHERE reset_at < NOW() - INTERVAL '1 day';`).catch(() => {});
    return Number(rows[0]?.count) <= limit;
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 200);
    if (message !== lastStoreError) {
      lastStoreError = message;
      console.warn(`[rate-limit] the database store can't answer, counting on this instance instead: ${message}`);
    }
    return checkRateLimit(key, limit, windowMs);
  }
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function verifyTurnstile(
  token: string | undefined,
  ip: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    },
  );
  const data = (await res.json()) as { success: boolean };
  return data.success;
}

export async function assertSessionBookable(sessionDate: string): Promise<void> {
  const [y, m, d] = sessionDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const clock = await clubClock();
  if (!isBookable(date, new Date(), clock)) {
    throw new Error(
      `Booking is only open from ${clock.bookingWindowDays} days before the session until ${hourLabel(clock.bookingCutoffHour)} on the day of play`,
    );
  }
  if (process.env.POSTGRES_URL) {
    const exists = await sessionExists(sessionDate);
    if (!exists) {
      throw new Error("This date is not an open session");
    }
  }
}

export function parseSessionDate(sessionDate: string): Date {
  const [y, m, d] = sessionDate.split("-").map(Number);
  if (!y || !m || !d) throw new Error("Invalid session date");
  return startOfDay(new Date(y, m - 1, d));
}

// Mirrors the admin check in proxy.ts, for use in API route handlers (which
// get a plain Request). Both go through lib/admin-access.ts: a full club
// admin signed in within 12 hours.
export async function isAdminRequest(request: Request): Promise<boolean> {
  return isAdminApiRequest(request);
}
