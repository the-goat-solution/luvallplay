import { appRoute } from "@/lib/app-api";
import { getPlayerStats } from "@/lib/stats-db";

// The Player tab's stats: the website's own (lib/stats-db.ts getPlayerStats).
const route = appRoute("player.stats", async ({ player }) => getPlayerStats(player));

export const GET = route.handle;
export const OPTIONS = route.preflight;
