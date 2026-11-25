import { appRoute } from "@/lib/app-api";
import { revokeApiToken } from "@/lib/webhooks";

// Disconnect an access key (only the person's own; anyone else's id does nothing).
const route = appRoute("integrations.revokeToken", async ({ player, params }) => {
  await revokeApiToken(player.id, params.id);
  return { ok: true as const };
});

export const DELETE = route.handle;
export const OPTIONS = route.preflight;
