import { getCurrentPlayer } from "@/lib/player-auth";
import { getPlayerStats } from "@/lib/stats-db";
import { PlayerStatsView } from "@/components/profile/player/PlayerStatsView";
import { RankCard } from "@/components/arena/RankCard";
import { RankLadder } from "@/components/arena/RankLadder";
import { buildArenaState } from "@/lib/arena-state";
import { enabledModules } from "@/lib/club-modules";
import { sql } from "@/lib/database";
import { PT } from "@/components/profile/PT";
import styles from "@/components/profile/profile.module.css";

// Player: everything about your game in one place. Your rank (Wolf Points,
// kit bag, achievements), your play stats and leaderboard ranks, then the
// whole rank ladder (what used to be the Arena's Ranks segment).

export default async function PlayerPage() {
  const player = await getCurrentPlayer();
  if (!player) return null;
  // Connected apps (API tokens and webhooks, components/profile/player/
  // ConnectedApps.tsx) are hidden for now; the API itself still works.
  // The rank card is extra: if the Arena can't load, the rest of the tab still works.
  const on = await enabledModules(sql);
  const [stats, arena] = await Promise.all([
    getPlayerStats(player),
    on.has("arena")
      ? buildArenaState({ id: player.id }).catch((err) => {
          console.error("[arena] rank card failed:", err);
          return null;
        })
      : Promise.resolve(null),
  ]);

  return (
    <>
      <h1 className={styles.pageTitle}>
        <PT k="pl_title" />
      </h1>
      <div className={styles.stack}>
        {arena?.me && <RankCard me={arena.me} />}
        <PlayerStatsView stats={stats} leaderboardVisible={player.leaderboardVisible} />
        {arena && <RankLadder me={arena.me} />}
      </div>
    </>
  );
}
