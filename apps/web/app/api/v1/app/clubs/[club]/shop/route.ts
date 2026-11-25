import { appRoute } from "@/lib/app-api";
import { shopFor } from "@/lib/app-shop";

// The club shop: products in stock, your orders, and whether cash is offered.
const route = appRoute("shop.list", async ({ player }) => shopFor(player));

export const GET = route.handle;
export const OPTIONS = route.preflight;
