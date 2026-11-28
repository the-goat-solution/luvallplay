// New sessions for the players' app: the same createPlayerSession as the
// web, answered as a token instead of a cookie.
import { PLAYER_SESSION_DAYS, createPlayerSession, sha256 } from "./player-auth";
import { sessionExpiry } from "./repos/sessions";
import { sql } from "./database";

/**
 * `signedInAt`: when the person actually signed in, for a session handed over
 * from another (the cutover's handover): the new session keeps that sign-in
 * time, so it never counts as a fresh sign-in for admin's 12-hour check.
 */
export async function newAppSession(playerId: number, userAgent: string | null, signedInAt?: Date): Promise<{ token: string; expiresAt: string }> {
  const token = await createPlayerSession(playerId, userAgent);
  if (signedInAt) await sql.query(`UPDATE player_sessions SET created_at = LEAST(created_at, $2) WHERE token_hash = $1;`, [sha256(token), signedInAt.toISOString()]);
  const expiresAt = (await sessionExpiry(sha256(token))) ?? new Date(Date.now() + PLAYER_SESSION_DAYS * 86_400_000).toISOString();
  return { token, expiresAt };
}
