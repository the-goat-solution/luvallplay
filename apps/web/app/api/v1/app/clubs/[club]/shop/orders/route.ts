import { appRoute, fail } from "@/lib/app-api";
import { placeOrder } from "@/lib/app-shop";

// Order one item: by card (a payment to confirm in the browser) or reserved for cash.
const route = appRoute(
  "shop.order",
  async ({ player, body }) => {
    const r = await placeOrder(player, body.variantId, body.method);
    return r.ok ? { order: r.order, clientSecret: r.clientSecret, playDay: r.playDay } : fail(r.status, r.code);
  },
  { rateKey: (_ip, session) => `shop:${session?.player.id}` },
);

export const POST = route.handle;
export const OPTIONS = route.preflight;
