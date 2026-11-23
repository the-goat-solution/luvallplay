import { MatchAnalyzer } from "@/components/match-analyzer/MatchAnalyzer";
import { getCurrentPlayer } from "@/lib/player-auth";

// Wolf Vision as a profile tab: on its own (training, any video) or for an
// Arena challenge (?challenge=ID), with the free-trial and pass messages.
// (The old standalone /match-analyzer page redirects here.) On its own, the
// signed-in player is Wolf 1.
export default async function ProfileWolfVisionPage({ searchParams }: { searchParams: Promise<{ challenge?: string; demo?: string }> }) {
  const { challenge, demo } = await searchParams;
  const id = Number(challenge);
  const sandbox = process.env.VERCEL_ENV !== "production" || demo === "1";
  const player = await getCurrentPlayer();
  const me = player
    ? { id: player.id, name: player.displayName?.trim() || `${player.firstName} ${player.lastName}`.trim() || player.email.split("@")[0], avatarUrl: player.avatarUrl ?? null }
    : null;
  return <MatchAnalyzer challengeId={Number.isInteger(id) && id > 0 ? id : null} sandbox={sandbox} demo={demo === "1"} embedded me={me} />;
}
