import { appRoute } from "@/lib/app-api";
import { buyPass, passState, usePass } from "@/lib/app-vision";

// A pass for the tracker, as the website's /api/wolf-vision/pass: the usable
// one (GET; after Checkout it confirms the payment), buying one (POST), and
// starting a session on it (PATCH). Free for everyone during the trial.
const read = appRoute("vision.pass", async ({ player, query }) => passState(player, query));
const buy = appRoute("vision.buy", async ({ player, body, request }) => buyPass(player, body, request), {
  rateKey: (_ip, session) => `wv-pass:${session?.player.id}`,
});
const use = appRoute("vision.use", async ({ player, body }) => usePass(player, body));

export const GET = read.handle;
export const POST = buy.handle;
export const PATCH = use.handle;
export const OPTIONS = read.preflight;
