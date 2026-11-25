// The players' app shop (/api/v1/app/clubs/{club}/shop): the website's
// Me → Club shop, from the same functions as app/api/profile/shop/order/**,
// with the same payment description, metadata, idempotency key and emails.
import { CLUB_CURRENCY } from "./constants";
import { enabledModules } from "./club-modules";
import { sql } from "./database";
import { stripeCustomerFor } from "./membership-self-service";
import { payments } from "./payments";
import type { Player } from "./player-db";
import {
  ShopError,
  attachPaymentIntent,
  cancelOrder,
  cashHoldUntil,
  createOrder,
  getOrder,
  listOrdersForPlayer,
  listShopProductsForPlayer,
  markOrderPaidByCard,
  type Order,
} from "./shop-db";
import { notifyOrderPlaced, notifyOversold } from "./shop-notify";
import { getStripe } from "./stripe";

type Fail = { ok: false; status: number; code: string };

/** What the app shows of an order (no email, name or payment id). */
export function orderView(o: Order) {
  return {
    id: o.id,
    status: o.status,
    method: o.method,
    totalCents: o.totalCents,
    holdExpiresAt: o.holdExpiresAt,
    paidAt: o.paidAt,
    collectedAt: o.collectedAt,
    createdAt: o.createdAt,
    items: o.items.map((i) => ({ label: i.label, qty: i.qty, unitPriceCents: i.unitPriceCents })),
  };
}

export async function shopFor(player: Player) {
  const [products, orders, modules] = await Promise.all([listShopProductsForPlayer(), listOrdersForPlayer(player.id), enabledModules(sql)]);
  return {
    products: products.map((p) => ({
      ...p,
      variants: p.variants.map((v) => ({ id: v.id, fit: v.fit, size: v.size, available: v.available })),
    })),
    orders: orders.map(orderView),
    cash: modules.has("payments-to-check"),
  };
}

/** One item: card (a payment for the browser to confirm, held 15 minutes) or cash (held to the end of the next play day). */
export async function placeOrder(player: Player, variantId: number, method: "card" | "cash") {
  if (method === "cash" && !(await enabledModules(sql)).has("payments-to-check")) return { ok: false, status: 409, code: "cash_unavailable" } satisfies Fail;
  const name = `${player.firstName} ${player.lastName}`.trim();
  try {
    const hold = method === "cash" ? await cashHoldUntil(player.email) : { until: new Date(), playDay: null };
    const order = await createOrder({ playerId: player.id, email: player.email, name, variantId, method, cashHoldUntil: hold.until });
    if (method === "cash") {
      await notifyOrderPlaced(order);
      return { ok: true as const, order: orderView(order), clientSecret: null, playDay: hold.playDay };
    }
    try {
      const customer = await stripeCustomerFor(player, true);
      const items = order.items.map((i) => i.label).join(", ");
      const payment = await payments().createPayment({
        amount: order.totalCents,
        currency: CLUB_CURRENCY,
        customerId: customer ?? undefined,
        receiptEmail: player.email,
        description: `Three Wolves shop — ${items}`,
        metadata: { type: "shop", orderId: String(order.id), items: items.slice(0, 450), email: player.email, firstName: player.firstName, lastName: player.lastName },
        idempotencyKey: `shop-order-${order.id}`,
      });
      await attachPaymentIntent(order.id, payment.id);
      return { ok: true as const, order: orderView(order), clientSecret: payment.clientSecret ?? null, playDay: null };
    } catch (err) {
      await cancelOrder(order.id).catch(() => {});
      throw err;
    }
  } catch (err) {
    if (err instanceof ShopError) return { ok: false, status: 409, code: err.code } satisfies Fail;
    throw err;
  }
}

/** After the browser confirmed the card payment: paid at once (the webhook does the same, whichever is first). */
export async function confirmOrder(player: Player, id: number) {
  const order = await getOrder(id);
  if (!order || order.playerId !== player.id || !order.stripePaymentIntentId) return { ok: false, status: 404, code: "not_found" } satisfies Fail;
  const pi = await getStripe().paymentIntents.retrieve(order.stripePaymentIntentId);
  if (pi.status !== "succeeded") return { ok: false, status: 409, code: "not_paid" } satisfies Fail;
  const result = await markOrderPaidByCard(order.id);
  const fresh = await getOrder(order.id);
  if (fresh && result === "paid") await notifyOrderPlaced(fresh);
  if (fresh && result === "oversold") await notifyOversold(fresh);
  return { ok: true as const, order: orderView(fresh ?? order) };
}

/** A cash reservation, or a card checkout left unpaid: the item goes back on the shelf. */
export async function cancelMyOrder(player: Player, id: number) {
  return (await cancelOrder(id, player.id)) ? ({ ok: true } as const) : ({ ok: false, status: 404, code: "not_found" } satisfies Fail);
}
