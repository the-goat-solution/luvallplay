import { redirect } from "next/navigation";
import { ArenaView } from "@/components/arena/ArenaView";
import { getCurrentPlayer } from "@/lib/player-auth";
import { buildArenaState } from "@/lib/arena-state";

// The Arena tab: pair challenges, codes, scores and the feed. The
// leaderboard has its own tab (/profile/leaderboard) and the rank ladder
// lives on the Player tab; old ?tab= links are sent there.

export default async function ProfileArenaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const player = await getCurrentPlayer();
  if (!player) return null;
  const { tab, ...rest } = await searchParams;
  if (tab === "leaderboard") {
    const qs = new URLSearchParams(Object.entries(rest).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
    redirect(`/profile/leaderboard${qs ? `?${qs}` : ""}`);
  }
  if (tab === "ranks") redirect("/profile/player");
  const state = await buildArenaState({ id: player.id });
  return <ArenaView initial={state} embedded />;
}
