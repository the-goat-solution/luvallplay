import type { Metadata } from "next";
import { MatchAnalyzer, type AnalyzerViewer } from "@/components/match-analyzer/MatchAnalyzer";
import { getCurrentPlayer } from "@/lib/player-auth";
import { canUseFromProfile, priceFor } from "@/lib/wolf-vision-db";

// Wolf Vision. Opened from a live Arena challenge (?challenge=ID) on the phone
// that films the game, or from a player's profile (?own=1) for their own
// games once the club switches it on for them. The test scenario (simulated
// game) is offered on preview deployments and locally, or with ?demo=1. Kept
// out of search.
export const metadata: Metadata = {
  title: "Wolf Vision | Three Wolves",
  description: "AI doubles tracking: automatic hits, player tracking, rally stats.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MatchAnalyzerPage({ searchParams }: { searchParams: Promise<{ challenge?: string; demo?: string; own?: string }> }) {
  const { challenge, demo, own } = await searchParams;
  const id = Number(challenge);
  const challengeId = Number.isInteger(id) && id > 0 ? id : null;
  const sandbox = process.env.VERCEL_ENV !== "production" || demo === "1";
  let viewer: AnalyzerViewer | null = null;
  if (process.env.POSTGRES_URL) {
    const player = await getCurrentPlayer().catch(() => null);
    if (player) {
      const [ownAccess, live, upload] = await Promise.all([
        canUseFromProfile(player).catch(() => false),
        priceFor(player, "live").catch(() => 0),
        priceFor(player, "upload").catch(() => 0),
      ]);
      viewer = {
        id: player.id,
        name: player.displayName || `${player.firstName} ${player.lastName}`.trim(),
        firstName: player.firstName,
        avatarUrl: player.avatarUrl,
        ownAccess,
        prices: { live, upload },
      };
    }
  }
  return (
    <MatchAnalyzer
      challengeId={challengeId}
      personal={!challengeId && own === "1"}
      viewer={viewer}
      sandbox={sandbox}
      demo={demo === "1"}
    />
  );
}
