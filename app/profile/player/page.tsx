import { getCurrentPlayer } from "@/lib/player-auth";
import { getPlayerStats } from "@/lib/stats-db";
import { listPhotosForPlayer } from "@/lib/photos-db";
import { listApiTokens, listWebhookEndpoints } from "@/lib/webhooks";
import { publicBlobConfigured } from "@/lib/public-blob";
import { getSiteUrl } from "@/lib/email-layout";
import { PlayerStatsView } from "@/components/profile/player/PlayerStatsView";
import { PhotosPanel } from "@/components/profile/player/PhotosPanel";
import { ConnectedApps } from "@/components/profile/player/ConnectedApps";
import { PT } from "@/components/profile/PT";
import styles from "@/components/profile/profile.module.css";

export default async function PlayerPage() {
  const player = await getCurrentPlayer();
  if (!player) return null;
  const [stats, photos, tokens, webhooks] = await Promise.all([
    getPlayerStats(player),
    listPhotosForPlayer(player.id),
    listApiTokens(player.id),
    listWebhookEndpoints(player.id),
  ]);

  return (
    <>
      <h1 className={styles.pageTitle}>
        <PT k="pl_title" />
      </h1>
      <div className={styles.stack}>
        <PlayerStatsView stats={stats} leaderboardVisible={player.leaderboardVisible} />
        <PhotosPanel photos={photos} playerId={player.id} enabled={publicBlobConfigured()} />
        <ConnectedApps tokens={tokens} webhooks={webhooks} siteUrl={getSiteUrl()} />
      </div>
    </>
  );
}
