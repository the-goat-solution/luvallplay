import { appRoute } from "@/lib/app-api";
import { share } from "@/lib/app-vision";

// A session that isn't a challenge: its stats by email to the players added
// by email (lib/wolf-vision-share.ts, as the website's /api/wolf-vision/share,
// with the same limit per sender).
const route = appRoute("vision.share", async ({ player, body }) => share(player, body), {
  rateKey: (_ip, session) => `wv-share:${session?.player.id}`,
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
