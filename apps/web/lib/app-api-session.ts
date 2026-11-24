// New sessions for the players' app: the same createPlayerSession as the
// web, answered as a token instead of a cookie.
import { PLAYER_SESSION_DAYS, createPlayerSession, sha256 } from "./player-auth";
import { sessionExpiry } from "./repos/sessions";

export async function newAppSession(playerId: number, userAgent: string | null): Promise<{ token: string; expiresAt: string }> {
  const token = await createPlayerSession(playerId, userAgent);
  const expiresAt = (await sessionExpiry(sha256(token))) ?? new Date(Date.now() + PLAYER_SESSION_DAYS * 86_400_000).toISOString();
  return { token, expiresAt };
}
