import { appRoute } from "@/lib/app-api";
import { dropPushDevice } from "@/lib/app-push";

// This device stops receiving. The same answer whether or not it was
// registered, and only ever the signed-in person's own device.
const route = appRoute("account.pushRemoveDevice", async ({ player, body }) => {
  await dropPushDevice(player.id, body.token);
  return { ok: true as const };
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
