import { and, eq, isNull, sql } from "drizzle-orm";
import { orm, schema } from "../database.ts";
import { DISPLAY_NAME_SQL } from "../stats-periods.ts";

const { players } = schema;

/** First time the "add to home screen" guide was shown (kept once set). */
export async function markInstallHintShown(playerId: number): Promise<void> {
  await orm()
    .update(players)
    .set({ install_hint_shown_at: sql`coalesce(${players.install_hint_shown_at}, NOW())` })
    .where(eq(players.id, playerId));
}

/** The app was installed or opened from the home screen; the guide counts as shown too. */
export async function markInstalled(playerId: number): Promise<void> {
  await orm()
    .update(players)
    .set({
      installed_at: sql`coalesce(${players.installed_at}, NOW())`,
      install_hint_shown_at: sql`coalesce(${players.install_hint_shown_at}, NOW())`,
    })
    .where(eq(players.id, playerId));
}

/** The welcome card was dismissed (kept once set). */
export async function markWelcomeDismissed(playerId: number): Promise<void> {
  await orm()
    .update(players)
    .set({ welcome_card_dismissed_at: sql`coalesce(${players.welcome_card_dismissed_at}, NOW())` })
    .where(eq(players.id, playerId));
}

/** One-click opt-out link from an email: hides that player from the leaderboard. */
export async function hideFromLeaderboardByToken(token: string): Promise<void> {
  await orm().update(players).set({ leaderboard_visible: false }).where(eq(players.leaderboard_optout_token, token));
}

export type PickerPlayer = { id: number; name: string; avatarUrl: string | null };

/** Registered players with a name, for pickers (Wolf Vision set-up). No emails. */
export async function listPlayersForPicker(limit = 2000): Promise<PickerPlayer[]> {
  // The display-name rule is shared SQL (lib/stats-periods.ts) and refers to
  // the table as "p".
  const name = sql<string>`${sql.raw(DISPLAY_NAME_SQL)}`;
  const p = orm()
    .select({ id: sql<number>`p.id`, name, avatarUrl: sql<string | null>`p.avatar_url` })
    .from(sql`${players} p`)
    .where(and(isNull(sql`p.deleted_at`), sql`(trim(p.first_name) <> '' OR trim(coalesce(p.display_name, '')) <> '')`))
    .orderBy(sql`lower(${name})`)
    .limit(limit);
  const rows = await p;
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name), avatarUrl: r.avatarUrl ?? null }));
}
