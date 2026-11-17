import { ArenaView } from "@/components/arena/ArenaView";
import { getCurrentPlayer } from "@/lib/player-auth";
import { buildArenaState } from "@/lib/arena-state";

// The Arena as a profile tab: pair challenges, codes, scores and the board.
export default async function ProfileArenaPage() {
  const player = await getCurrentPlayer();
  if (!player) return null;
  const state = await buildArenaState({ id: player.id });
  return <ArenaView initial={state} embedded />;
}
