import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { getStripe } from "@/lib/stripe";
import { getOrder, markOrderPaidByCard } from "@/lib/shop-db";
import { notifyOrderPlaced, notifyOversold } from "@/lib/shop-notify";

// The browser confirms its card payment, then calls this so the order shows
// as paid straight away (the Stripe webhook does the same, whichever is
// first; both are safe to repeat).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const id = Number((await params).id);
  const order = Number.isInteger(id) ? await getOrder(id) : null;
  if (!order || order.playerId !== player.id || !order.stripePaymentIntentId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const pi = await getStripe().paymentIntents.retrieve(order.stripePaymentIntentId);
  if (pi.status !== "succeeded") return NextResponse.json({ error: "not_paid", status: pi.status }, { status: 409 });
  const result = await markOrderPaidByCard(order.id);
  const fresh = await getOrder(order.id);
  if (fresh && result === "paid") await notifyOrderPlaced(fresh);
  if (fresh && result === "oversold") await notifyOversold(fresh);
  return NextResponse.json({ ok: true, order: fresh });
}
