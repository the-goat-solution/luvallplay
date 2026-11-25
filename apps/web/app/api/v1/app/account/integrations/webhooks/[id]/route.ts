import { appRoute } from "@/lib/app-api";
import { deleteWebhookEndpoint } from "@/lib/webhooks";

// Remove a webhook (only the person's own).
const route = appRoute("integrations.deleteWebhook", async ({ player, params }) => {
  await deleteWebhookEndpoint(player.id, params.id);
  return { ok: true as const };
});

export const DELETE = route.handle;
export const OPTIONS = route.preflight;
