import { getCurrentPlayer } from "@/lib/player-auth";
import { getPlayerStats } from "@/lib/stats-db";
import { listPhotosForPlayer } from "@/lib/photos-db";
import { publicBlobUploadMode } from "@/lib/public-blob";
import { PlayerStatsView } from "@/components/profile/player/PlayerStatsView";
import { PhotosPanel } from "@/components/profile/player/PhotosPanel";
import { PT } from "@/components/profile/PT";
import styles from "@/components/profile/profile.module.css";

export default async function PlayerPage() {
  const player = await getCurrentPlayer();
  if (!player) return null;
  // Connected apps (API tokens and webhooks, components/profile/player/
  // ConnectedApps.tsx) are hidden for now; the API itself still works.
  const [stats, photos] = await Promise.all([getPlayerStats(player), listPhotosForPlayer(player.id)]);

  return (
    <>
      <h1 className={styles.pageTitle}>
        <PT k="pl_title" />
      </h1>
      <div className={styles.stack}>
        <PlayerStatsView stats={stats} leaderboardVisible={player.leaderboardVisible} />
        <PhotosPanel photos={photos} playerId={player.id} uploadMode={publicBlobUploadMode()} />
      </div>
    </>
  );
}
