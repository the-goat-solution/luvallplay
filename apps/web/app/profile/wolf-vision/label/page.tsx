import { visionName } from "@/lib/club-terms";
import type { Metadata } from "next";
import { LabelTool } from "@/components/match-analyzer/LabelTool";

// Wolf Vision labelling set: mark every hit (time and hitter) on a match video.
// The labels train and measure the AI-enhanced tracker. Kept out of search.
export const metadata: Metadata = {
  title: `${visionName()} labelling | Three Wolves`,
  robots: { index: false, follow: false },
};

export default function LabelPage() {
  return <LabelTool />;
}
