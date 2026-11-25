import { appRoute, fail } from "@/lib/app-api";
import { confirmOrder } from "@/lib/app-shop";

// The browser confirmed the card payment: show the order as paid now.
const route = appRoute("shop.confirm", async ({ player, params }) => {
  const r = await confirmOrder(player, params.id);
  return r.ok ? { order: r.order } : fail(r.status, r.code);
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
