import crypto from "crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { sql } from "@vercel/postgres";
import {
  PLAYER_COLUMNS,
  ensurePlayerTables,
  mapPlayer,
  normalizeAccountEmail,
  type Player,
  type PlayerRow,
} from "./player-db";

// Player sign-in: a random session token in an httpOnly cookie, stored only
// as a SHA-256 hash, with a 90-day expiry that slides forward with use.
// Sign-in codes (email) are 6 digits, HMAC-hashed, valid 10 minutes, 5 tries.

export const PLAYER_COOKIE = "tw_player";
export const PLAYER_SESSION_DAYS = 90;
const SESSION_REFRESH_AFTER_MS = 60 * 60 * 1000;
export const CODE_TTL_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;
/** Codes per email in any 15 minutes. */
export const CODE_REQUESTS_PER_WINDOW = 3;

let warnedFallback = false;

// Keys the HMAC of sign-in codes and phone proofs (session tokens are random
// and stored as plain SHA-256, so they don't depend on it). If
// PLAYER_SESSION_SECRET isn't set yet, a key derived from ADMIN_PASSWORD
// keeps sign-in working right after deploy; Admin → Setup check flags it.
function secret(): string {
  const s = process.env.PLAYER_SESSION_SECRET;
  if (s) return s;
  const admin = process.env.ADMIN_PASSWORD;
  if (admin) {
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn("[players] PLAYER_SESSION_SECRET is not set; using a key derived from ADMIN_PASSWORD.");
    }
    return crypto.createHash("sha256").update(`three-wolves-player:${admin}`).digest("hex");
  }
  if (process.env.NODE_ENV !== "production") return "dev-only-player-session-secret";
  throw new Error("PLAYER_SESSION_SECRET is not configured");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmac(value: string): string {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function playerCookieOptions(maxAgeSeconds = PLAYER_SESSION_DAYS * 24 * 60 * 60) {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function createPlayerSession(playerId: number, userAgent: string | null): Promise<string> {
  await ensurePlayerTables();
  const token = crypto.randomBytes(32).toString("base64url");
  await sql.query(
    `INSERT INTO player_sessions (player_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 day'));`,
    [playerId, sha256(token), userAgent?.slice(0, 300) ?? null, PLAYER_SESSION_DAYS],
  );
  await sql`UPDATE players SET claimed_at = coalesce(claimed_at, NOW()) WHERE id = ${playerId};`;
  return token;
}

async function playerForToken(token: string | undefined): Promise<Player | null> {
  if (!token || token.length > 100) return null;
  await ensurePlayerTables();
  const { rows } = await sql.query(
    `SELECT ${PLAYER_COLUMNS}, s.id AS session_id, s.last_seen_at AS session_seen
     FROM player_sessions s JOIN players p ON p.id = s.player_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND p.deleted_at IS NULL;`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) return null;
  // Slide the expiry forward, at most once an hour so page loads stay reads.
  if (Date.now() - new Date(row.session_seen as Date).getTime() > SESSION_REFRESH_AFTER_MS) {
    await sql.query(
      `UPDATE player_sessions SET last_seen_at = NOW(), expires_at = NOW() + ($2 * INTERVAL '1 day') WHERE id = $1;`,
      [row.session_id, PLAYER_SESSION_DAYS],
    );
  }
  return mapPlayer(row as PlayerRow);
}

/** The signed-in player for this request (server components and actions). */
export const getCurrentPlayer = cache(async (): Promise<Player | null> => {
  const store = await cookies();
  return playerForToken(store.get(PLAYER_COOKIE)?.value);
});

/** Same, for route handlers that get a plain Request. */
export async function getPlayerFromRequest(request: Request): Promise<Player | null> {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === PLAYER_COOKIE) {
      return playerForToken(decodeURIComponent(part.slice(eq + 1).trim()));
    }
  }
  return null;
}

export async function endPlayerSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await ensurePlayerTables();
  await sql`DELETE FROM player_sessions WHERE token_hash = ${sha256(token)};`;
}

export async function endAllPlayerSessions(playerId: number): Promise<void> {
  await sql`DELETE FROM player_sessions WHERE player_id = ${playerId};`;
}

// ---------------------------------------------------------------------------
// Email sign-in codes
// ---------------------------------------------------------------------------

export type IssuedCode = { code: string; linkToken: string };

export type IssueCodeResult =
  | { ok: true; issued: IssuedCode }
  | { ok: false; reason: "too_many" };

export async function issueEmailCode(rawEmail: string, ip: string): Promise<IssueCodeResult> {
  await ensurePlayerTables();
  const email = normalizeAccountEmail(rawEmail);
  const { rows } = await sql`
    SELECT count(*)::int AS n FROM auth_codes
    WHERE email = ${email} AND created_at > NOW() - INTERVAL '15 minutes';
  `;
  if ((rows[0]?.n as number) >= CODE_REQUESTS_PER_WINDOW) return { ok: false, reason: "too_many" };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const linkToken = crypto.randomBytes(24).toString("base64url");
  await sql.query(
    `INSERT INTO auth_codes (email, code_hash, link_token_hash, expires_at, ip_hash)
     VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 minute'), $5);`,
    [email, hmac(`${email}:${code}`), sha256(linkToken), CODE_TTL_MINUTES, sha256(ip)],
  );
  return { ok: true, issued: { code, linkToken } };
}

export type VerifyCodeResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" | "too_many_attempts" };

/** Checks a typed code against the newest live code for the email. */
export async function verifyEmailCode(rawEmail: string, rawCode: string): Promise<VerifyCodeResult> {
  await ensurePlayerTables();
  const email = normalizeAccountEmail(rawEmail);
  const code = rawCode.replace(/\D/g, "");
  const { rows } = await sql`
    SELECT id, code_hash, attempts, expires_at FROM auth_codes
    WHERE email = ${email} AND consumed_at IS NULL
    ORDER BY created_at DESC LIMIT 1;
  `;
  const row = rows[0];
  if (!row) return { ok: false, reason: "expired" };
  if (new Date(row.expires_at as Date).getTime() < Date.now()) return { ok: false, reason: "expired" };
  if ((row.attempts as number) >= CODE_MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  if (code.length !== 6 || !safeEqualHex(hmac(`${email}:${code}`), row.code_hash as string)) {
    await sql`UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ${row.id};`;
    return { ok: false, reason: (row.attempts as number) + 1 >= CODE_MAX_ATTEMPTS ? "too_many_attempts" : "invalid" };
  }
  // Single use: only the request that flips consumed_at wins.
  const { rowCount } = await sql`
    UPDATE auth_codes SET consumed_at = NOW() WHERE id = ${row.id} AND consumed_at IS NULL;
  `;
  if (!rowCount) return { ok: false, reason: "expired" };
  return { ok: true, email };
}

/** The one-tap link in the code email. */
export async function verifyLinkToken(token: string): Promise<VerifyCodeResult> {
  await ensurePlayerTables();
  if (!token || token.length > 100) return { ok: false, reason: "invalid" };
  const { rows } = await sql`
    UPDATE auth_codes SET consumed_at = NOW()
    WHERE link_token_hash = ${sha256(token)} AND consumed_at IS NULL AND expires_at > NOW()
    RETURNING email;
  `;
  const email = rows[0]?.email as string | undefined;
  return email ? { ok: true, email } : { ok: false, reason: "expired" };
}

export { safeNextPath } from "./safe-next";
