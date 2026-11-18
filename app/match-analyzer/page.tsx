import type { Metadata } from "next";
import { MatchAnalyzer } from "@/components/match-analyzer/MatchAnalyzer";

// Wolf Vision. Opened from a live Arena challenge (?challenge=ID) on the phone
// that films the game, or on its own. The test scenario (simulated game) is
// offered on preview deployments and locally, or with ?demo=1. Kept out of search.
export const metadata: Metadata = {
  title: "Wolf Vision | Three Wolves",
  description: "AI doubles tracking for the Arena: automatic hits, player tracking, rally stats.",
  robots: { index: false, follow: false },
};

export default async function MatchAnalyzerPage({ searchParams }: { searchParams: Promise<{ challenge?: string; demo?: string }> }) {
  const { challenge, demo } = await searchParams;
  const id = Number(challenge);
  const sandbox = process.env.VERCEL_ENV !== "production" || demo === "1";
  return <MatchAnalyzer challengeId={Number.isInteger(id) && id > 0 ? id : null} sandbox={sandbox} demo={demo === "1"} />;
}
