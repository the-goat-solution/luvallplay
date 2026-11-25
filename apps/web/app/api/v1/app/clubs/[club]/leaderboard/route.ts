import { appRoute } from "@/lib/app-api";
import { pointsBoard } from "@/lib/app-leaderboard";

// The Leaderboard tab: the points board for a source (all, challenges, play
// days, round robin) and a period (month, quarter, year, all time).
const route = appRoute("leaderboard.board", async ({ player, query }) => pointsBoard(player, query));

export const GET = route.handle;
export const OPTIONS = route.preflight;
