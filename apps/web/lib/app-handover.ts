// The cutover's one-time session handover (phase-4-cutover.md §4.1): a member
// signed in on the club's website arrives in the players' app signed in.
//
// The website makes a random token, keeps only its hash for 60 seconds, and
// sends the browser to `<PLAYER_APP_URL>/handover#t=<token>&to=<screen>`; the
// app swaps the token once (`auth.handover`) for its own session.
//
// The token rows live in `admin_handoffs` (decision (a) of §4.1: no migration).
// The two kinds can never be swapped: an app token's row is the hash of the
// token under its own label, an admin token's is the plain hash, and both
// sides take only the exact token shape (32 random bytes, base64url), so
// neither can be handed a string that hashes to the other's row.
//
// The row's created_at is the website session's sign-in time, and the app
// session starts from it, so a handover never counts as a fresh sign-in (the
// admin's 12-hour check, through the app's "Club admin" handoff).
import crypto from "node:crypto";
import { sql } from "./database";
import { sha256 } from "./player-auth";

export const APP_HANDOVER_TTL_SECONDS = 60;
export const HANDOFF_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const LABEL = "luvallplay/app-handover/v1\n";

export const appHandoverHash = (token: string): string => sha256(LABEL + token);

/**
 * The players' app address, from the `PLAYER_APP_URL` setting (its origin,
 * https only; http only for a local address). Unset or malformed: null, and
 * the handover is off (the website behaves exactly as before the cutover).
 */
export function playerAppUrl(value: string | undefined = process.env.PLAYER_APP_URL): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** A new handover token for this player, carrying the website session's sign-in time. */
export async function createAppHandover(playerId: number, signedInAt: Date): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await sql.query(
    `INSERT INTO admin_handoffs (token_hash, player_id, created_at, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'));`,
    [appHandoverHash(token), playerId, signedInAt.toISOString(), APP_HANDOVER_TTL_SECONDS],
  );
  await sql.query(`DELETE FROM admin_handoffs WHERE expires_at < NOW() - INTERVAL '1 day';`);
  return token;
}

/** Single use, 60 seconds: only the request that marks it used gets the player and the sign-in time. */
export async function consumeAppHandover(token: string): Promise<{ playerId: number; signedInAt: Date } | null> {
  if (!HANDOFF_TOKEN.test(token)) return null;
  const { rows } = await sql.query(
    `UPDATE admin_handoffs SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
     RETURNING player_id, created_at;`,
    [appHandoverHash(token)],
  );
  const row = rows[0];
  return row ? { playerId: Number(row.player_id), signedInAt: new Date(row.created_at as string | Date) } : null;
}

/** The app screen to open: a path of the app (the website's safe-path rule), else Home. */
export function handoverScreen(to: string | null): string {
  if (!to || to.length > 512 || !to.startsWith("/") || to.startsWith("//") || /[\\\u0000-\u001f]/.test(to)) return "/home";
  if (to.startsWith("/api/") || /^\/(signin|handover|welcome)(?=$|[/?#])/.test(to)) return "/home";
  return to;
}
