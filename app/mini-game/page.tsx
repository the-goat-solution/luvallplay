import type { Metadata } from "next";
import { MiniGame } from "@/components/mini-game/MiniGame";

export const metadata: Metadata = {
  title: "Mini Game — Round Robin | Three Wolves Badminton Club",
  description:
    "Three Wolves doubles round robin: random tiered teams, every game, live standings.",
};

export default function MiniGamePage() {
  return <MiniGame />;
}
