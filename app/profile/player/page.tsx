import { getCurrentPlayer } from "@/lib/player-auth";
import { getPlayerStats } from "@/lib/stats-db";
import { listPhotosForPlayer } from "@/lib/photos-db";
import { publicBlobUploadMode } from "@/lib/public-blob";
import { PlayerStatsView } from "@/components/profile/player/PlayerStatsView";
import { RankCard } from "@/components/arena/RankCard";
import { buildArenaState } from "@/lib/arena-state";
import { PhotosPanel } from "@/components/profile/player/PhotosPanel";
import { PT } from "@/components/profile/PT";
import styles from "@/components/profile/profile.module.css";

export default async function PlayerPage() {
  const player = await getCurrentPlayer();
  if (!player) return null;
  // Connected apps (API tokens and webhooks, components/profile/player/
  // ConnectedApps.tsx) are hidden for now; the API itself still works.
  // The rank card is extra: if the Arena can't load, the rest of the tab still works.
  const [stats, photos, arena] = await Promise.all([
    getPlayerStats(player),
    listPhotosForPlayer(player.id),
    buildArenaState({ id: player.id }).catch((err) => {
      console.error("[arena] rank card failed:", err);
      return null;
    }),
  ]);

  return (
    <>
      <h1 className={styles.pageTitle}>
        <PT k="pl_title" />
      </h1>
      <div className={styles.stack}>
        {arena?.me && <RankCard me={arena.me} />}
        <PlayerStatsView stats={stats} leaderboardVisible={player.leaderboardVisible} />
        <PhotosPanel photos={photos} playerId={player.id} uploadMode={publicBlobUploadMode()} />
      </div>
    </>
  );
}
