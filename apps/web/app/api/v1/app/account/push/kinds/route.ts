import { appRoute, fail } from "@/lib/app-api";
import { setPushKinds } from "@/lib/app-push";

// Turns kinds of notification on or off; kinds not named stay as they are.
const route = appRoute("account.pushKinds", async ({ player, body }) => {
  const result = await setPushKinds(player.id, body);
  return result.ok ? { ok: true as const, kinds: result.prefs } : fail(400, "bad_request");
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
