import type { Metadata } from "next";
import { CasualPlay } from "@/components/casual-play/CasualPlay";

// Standalone page for the venue screen and players' phones: not linked from
// the main site and kept out of search, like /mini-game.
export const metadata: Metadata = {
  title: "Casual Play — Court Board | Three Wolves",
  description: "Three Wolves casual play: live courts, who's up next and the waiting queue.",
  robots: { index: false, follow: false },
};

export default function CasualPlayPage() {
  return <CasualPlay />;
}
