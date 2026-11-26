import { appRoute, fail } from "@/lib/app-api";
import { addPushDevice } from "@/lib/app-push";

// This device receives the person's notifications from now on. Its address
// is stored sealed and never sent back.
const route = appRoute("account.pushDevice", async ({ player, body }) => {
  const result = await addPushDevice(player.id, body);
  if (result.ok) return { ok: true as const };
  return result.code === "unavailable" ? fail(503, "unavailable") : fail(400, "bad_request");
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
