import { and, eq, lt, sql } from "drizzle-orm";
import { orm, schema } from "../database.ts";

const { player_sessions } = schema;

/**
 * Slides a session's expiry forward, at most once per `refreshAfterMs`, so
 * most requests write nothing. The same rule lib/player-auth.ts applies to
 * the web's cookie; this is its twin for sessions used with a bearer token.
 */
export async function slideSession(tokenHash: string, days: number, refreshAfterMs: number): Promise<void> {
  await orm()
    .update(player_sessions)
    .set({ last_seen_at: sql`NOW()`, expires_at: sql`NOW() + (${days} * INTERVAL '1 day')` })
    .where(and(eq(player_sessions.token_hash, tokenHash), lt(player_sessions.last_seen_at, sql`NOW() - (${refreshAfterMs} * INTERVAL '1 millisecond')`)));
}

/** When a session ends if it is never used again (ISO), or null when it doesn't exist. */
export async function sessionExpiry(tokenHash: string): Promise<string | null> {
  const rows = await orm()
    .select({ expiresAt: sql<string>`to_char(${player_sessions.expires_at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` })
    .from(player_sessions)
    .where(eq(player_sessions.token_hash, tokenHash))
    .limit(1);
  return rows[0]?.expiresAt ?? null;
}
