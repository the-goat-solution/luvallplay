import type { Metadata } from "next";
import { MiniGame } from "@/components/mini-game/MiniGame";

// Standalone page: not linked from the main site and kept out of search.
export const metadata: Metadata = {
  title: "Mini Game — Round Robin | Three Wolves",
  description: "Three Wolves doubles round robin: teams, games and live standings.",
  robots: { index: false, follow: false },
};

export default function MiniGamePage() {
  return <MiniGame />;
}
