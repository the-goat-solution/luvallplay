import { appRoute, fail } from "@/lib/app-api";
import { newWebhook } from "@/lib/app-account";

// A new webhook; its signing secret is in this answer only.
const route = appRoute(
  "integrations.createWebhook",
  async ({ player, body }) => {
    const r = await newWebhook(player.id, body.url, body.events);
    return r.ok ? { secret: r.secret, endpoint: r.endpoint } : fail(r.status, r.code);
  },
  { badRequestCode: "invalid_url" },
);

export const POST = route.handle;
export const OPTIONS = route.preflight;
