import type { Metadata } from "next";
import { MatchAnalyzer } from "@/components/match-analyzer/MatchAnalyzer";

// Opened from a live Arena challenge (?challenge=ID) by a court assistant, or
// on its own for a friendly game. Kept out of search.
export const metadata: Metadata = {
  title: "Match Analyzer | Three Wolves",
  description: "AI doubles match stats: player tracking, rally counts, shot speed and court map.",
  robots: { index: false, follow: false },
};

export default async function MatchAnalyzerPage({ searchParams }: { searchParams: Promise<{ challenge?: string }> }) {
  const { challenge } = await searchParams;
  const id = Number(challenge);
  return <MatchAnalyzer challengeId={Number.isInteger(id) && id > 0 ? id : null} />;
}
