import { MatchAnalyzer } from "@/components/match-analyzer/MatchAnalyzer";

// Wolf Vision as a profile tab: on its own (training, any video) or for an
// Arena challenge (?challenge=ID), with the free-trial and pass messages.
// (The old standalone /match-analyzer page redirects here.)
export default async function ProfileWolfVisionPage({ searchParams }: { searchParams: Promise<{ challenge?: string; demo?: string }> }) {
  const { challenge, demo } = await searchParams;
  const id = Number(challenge);
  const sandbox = process.env.VERCEL_ENV !== "production" || demo === "1";
  return <MatchAnalyzer challengeId={Number.isInteger(id) && id > 0 ? id : null} sandbox={sandbox} demo={demo === "1"} embedded />;
}
