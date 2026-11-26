// The `shop.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const shopEndpoints = defineEndpoints("shop", {
  // The club shop: products and your orders; an order paid by card (a
  // payment to confirm in the browser, held 15 minutes) or reserved for cash
  // at your next play day. Refusals are 409 with a code: sold_out,
  // not_found, invalid, inactive, cash_unavailable; confirm before the
  // payment succeeded is 409 not_paid.
  "shop.list": {
    method: "GET", path: "/clubs/{club}/shop", auth: "session", scope: "club", module: "shop",
    params: S.clubParams, response: S.shopResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "shop.order": {
    method: "POST", path: "/clubs/{club}/shop/orders", auth: "session", scope: "club", module: "shop",
    params: S.clubParams, body: S.shopOrderRequest, response: S.shopOrderResponse,
    rateLimit: { limit: 15, windowMs: 60 * MIN },
  },
  "shop.confirm": {
    method: "POST", path: "/clubs/{club}/shop/orders/{id}/confirm", auth: "session", scope: "club", module: "shop",
    params: S.orderParams, body: S.emptyRequest, response: S.orderResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  "shop.cancel": {
    method: "POST", path: "/clubs/{club}/shop/orders/{id}/cancel", auth: "session", scope: "club", module: "shop",
    params: S.orderParams, body: S.emptyRequest, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
});
