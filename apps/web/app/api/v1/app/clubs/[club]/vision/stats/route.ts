import { appRoute } from "@/lib/app-api";
import { heartbeat, saveStats } from "@/lib/app-vision";

// A challenge's tracked stats, as the website's /api/arena/match-stats: the
// final totals (POST) and the tracking phone's heartbeat (PUT), with the
// same rate-limit buckets.
const save = appRoute("vision.save", async ({ player, body }) => saveStats(player, body), {
  rateKey: (_ip, session) => `match-stats:${session?.player.id}`,
});
const beat = appRoute("vision.beat", async ({ player, body }) => heartbeat(player, body), {
  rateKey: (_ip, session) => `match-live:${session?.player.id}`,
});

export const POST = save.handle;
export const PUT = beat.handle;
export const OPTIONS = save.preflight;
