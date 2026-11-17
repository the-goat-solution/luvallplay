import { sql } from "@vercel/postgres";
import { countArenaActions } from "./arena-db";

// Little red counters on the profile tabs. Each source is optional: a
// feature whose tables don't exist yet simply contributes nothing.
export async function getProfileBadges(playerId: number): Promise<Partial<Record<"account" | "membership" | "player" | "arena", number>>> {
  const badges: Partial<Record<"account" | "membership" | "player" | "arena", number>> = {};
  try {
    const { rows } = await sql`
      SELECT count(*)::int AS n FROM message_threads
      WHERE player_id = ${playerId} AND unread_for_player = TRUE;
    `;
    badges.account = (rows[0]?.n as number) ?? 0;
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") console.error("[profile] badge query failed:", err);
  }
  try {
    badges.arena = await countArenaActions(playerId);
  } catch (err) {
    console.error("[profile] arena badge failed:", err);
  }
  return badges;
}
