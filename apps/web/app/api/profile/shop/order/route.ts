import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import { getStripe } from "@/lib/stripe";
import { stripeCustomerFor } from "@/lib/membership-self-service";
import { ShopError, attachPaymentIntent, cancelOrder, cashHoldUntil, createOrder } from "@/lib/shop-db";
import { notifyOrderPlaced } from "@/lib/shop-notify";

const bodySchema = z.object({
  variantId: z.number().int().positive(),
  method: z.enum(["card", "cash"]),
});

// One item per order (pick fit + size, pay). Card: a PaymentIntent for the
// browser to confirm; the shirt is held 15 minutes meanwhile. Cash: held to
// the end of the player's next play day.
export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!checkRateLimit(`shop:${player.id}`, 15, 60 * 60_000)) {
    return NextResponse.json({ error: "too_many" }, { status: 429 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const name = `${player.firstName} ${player.lastName}`.trim();
  try {
    const hold = body.method === "cash" ? await cashHoldUntil(player.email) : { until: new Date(), playDay: null };
    const order = await createOrder({
      playerId: player.id,
      email: player.email,
      name,
      variantId: body.variantId,
      method: body.method,
      cashHoldUntil: hold.until,
    });
    if (body.method === "cash") {
      await notifyOrderPlaced(order);
      return NextResponse.json({ ok: true, order, playDay: hold.playDay });
    }
    try {
      const customer = await stripeCustomerFor(player, true);
      const items = order.items.map((i) => i.label).join(", ");
      const pi = await getStripe().paymentIntents.create(
        {
          amount: order.totalCents,
          currency: "nzd",
          customer: customer ?? undefined,
          automatic_payment_methods: { enabled: true },
          receipt_email: player.email,
          description: `Three Wolves shop — ${items}`,
          metadata: { type: "shop", orderId: String(order.id), items: items.slice(0, 450), email: player.email, firstName: player.firstName, lastName: player.lastName },
        },
        { idempotencyKey: `shop-order-${order.id}` },
      );
      await attachPaymentIntent(order.id, pi.id);
      return NextResponse.json({ ok: true, order, clientSecret: pi.client_secret });
    } catch (err) {
      await cancelOrder(order.id).catch(() => {});
      throw err;
    }
  } catch (err) {
    if (err instanceof ShopError) return NextResponse.json({ error: err.code }, { status: 409 });
    console.error("[shop] order failed:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
