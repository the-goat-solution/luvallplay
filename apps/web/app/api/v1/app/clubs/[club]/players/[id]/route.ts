import { appRoute, fail } from "@/lib/app-api";
import { playerCard } from "@/lib/app-leaderboard";

// One player's card: rank, points, recent form and what "Challenge" can do.
// Someone who hides from the leaderboard isn't found (except by themselves).
const route = appRoute("leaderboard.player", async ({ player, params }) => {
  const card = await playerCard(player.id, params.id);
  return card ? { card } : fail(404, "not_found");
});

export const GET = route.handle;
export const OPTIONS = route.preflight;
