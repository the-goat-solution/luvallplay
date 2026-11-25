import { appRoute, fail } from "@/lib/app-api";
import { cancelMyOrder } from "@/lib/app-shop";

// Cancel a cash reservation or an unpaid card checkout.
const route = appRoute("shop.cancel", async ({ player, params }) => {
  const r = await cancelMyOrder(player, params.id);
  return r.ok ? { ok: true as const } : fail(r.status, r.code);
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
