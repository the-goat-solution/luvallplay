import type { Metadata, Viewport } from "next";
import { Navigation } from "@/components/Navigation";
import { ArenaView } from "@/components/arena/ArenaView";
import { getCurrentPlayer } from "@/lib/player-auth";
import { buildArenaState, type ArenaState } from "@/lib/arena-state";

export const metadata: Metadata = {
  title: "The Arena — Three Wolves Badminton Club",
  description: "Pair challenges at Three Wolves: team up, throw down, climb from a Plastic Shuttle to a Diamond Racket.",
};

export const viewport: Viewport = { themeColor: "#08131f", viewportFit: "cover" };
export const dynamic = "force-dynamic";

const EMPTY: ArenaState = {
  now: new Date(0).toISOString(),
  signedIn: false,
  sandbox: false,
  minGameMinutes: 8,
  me: null,
  counts: { up: 0, live: 0, week: 0 },
  crown: null,
  packLeader: null,
  champion: null,
  hot: null,
  live: [],
  open: [],
  mine: [],
  feed: [],
};

export default async function ChallengesPage() {
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const player = hasDb ? await getCurrentPlayer() : null;
  const state = hasDb ? await buildArenaState(player ? { id: player.id } : null) : EMPTY;
  return (
    <>
      <Navigation />
      <ArenaView initial={state} />
    </>
  );
}
