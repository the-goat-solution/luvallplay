import { appRoute, fail } from "@/lib/app-api";
import { newAccessKey } from "@/lib/app-account";

// A new personal access key; the key is in this answer only.
const route = appRoute("integrations.createToken", async ({ player, body }) => {
  const r = await newAccessKey(player.id, body.name, body.scopes);
  return r.ok ? { token: r.token, record: r.record } : fail(r.status, r.code);
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
