import { appRoute } from "@/lib/app-api";
import { sharedModel, trainModel } from "@/lib/app-vision";

// The shared hit checker (GET) and a session's fine-tuned weights (POST:
// numbers only, never video), as the website's /api/wolf-vision/model.
const read = appRoute("vision.model", async () => sharedModel());
const train = appRoute("vision.train", async ({ player, body }) => trainModel(player, body), {
  rateKey: (_ip, session) => `wv-train:${session?.player.id}`,
});

export const GET = read.handle;
export const POST = train.handle;
export const OPTIONS = read.preflight;
