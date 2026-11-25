import { appRoute } from "@/lib/app-api";
import { saveLabels } from "@/lib/app-vision";

// The labelling set: hits marked by hand on a match video (time and who hit).
const route = appRoute(
  "vision.labels",
  async ({ player, body }) => ({ ok: true as const, id: await saveLabels(player.id, body) }),
  { rateKey: (_ip, session) => `wv-labels:${session?.player.id}` },
);

export const POST = route.handle;
export const OPTIONS = route.preflight;
