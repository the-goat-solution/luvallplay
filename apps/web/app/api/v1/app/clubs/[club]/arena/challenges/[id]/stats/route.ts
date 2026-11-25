import { appRoute, fail } from "@/lib/app-api";
import { visionChallenge } from "@/lib/app-vision";

// A game's tracked stats from the Arena's feed: its teams and the saved
// totals (the website's GET /api/arena/match-stats, same function).
const route = appRoute("arena.matchStats", async ({ params }) => (await visionChallenge(params.id)) ?? fail(404, "not_found"));

export const GET = route.handle;
export const OPTIONS = route.preflight;
