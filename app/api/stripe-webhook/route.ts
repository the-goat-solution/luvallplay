import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { sql } from "@vercel/postgres";
import { getStripe } from "@/lib/stripe";
import { ensureTables, reserveBookingSlot } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    if (pi.metadata?.type === "casual" && pi.metadata.sessionDate) {
      if (process.env.POSTGRES_URL) {
        await ensureTables();
        const ok = await reserveBookingSlot(pi.metadata.sessionDate, {
          firstName: pi.metadata.firstName ?? "",
          lastName: pi.metadata.lastName ?? "",
          email: pi.metadata.email ?? pi.receipt_email ?? "",
          phone: pi.metadata.phone,
          paymentIntentId: pi.id,
        });
        if (!ok) {
          console.error("Could not reserve slot — session full", pi.metadata.sessionDate);
        }
      }
    }

    if (pi.metadata?.type === "donation") {
      if (process.env.POSTGRES_URL) {
        await ensureTables();
        await sql`
          INSERT INTO donations (email, first_name, last_name, amount_cents, frequency, stripe_payment_intent_id, status)
          VALUES (
            ${pi.metadata.email ?? pi.receipt_email ?? ""},
            ${pi.metadata.firstName ?? ""},
            ${pi.metadata.lastName ?? ""},
            ${pi.amount},
            'once',
            ${pi.id},
            'succeeded'
          )
          ON CONFLICT (stripe_payment_intent_id) DO NOTHING;
        `;
      }
    }
  }

  if (event.type === "customer.subscription.updated") {
    const sub = event.data.object as Stripe.Subscription;
    if (process.env.POSTGRES_URL) {
      const item = sub.items.data[0];
      if (item) {
        const periodStart = new Date(item.current_period_start * 1000)
          .toISOString()
          .slice(0, 10);
        const periodEnd = new Date(item.current_period_end * 1000)
          .toISOString()
          .slice(0, 10);
        await sql`
          UPDATE memberships
          SET status = ${sub.status}, period_start = ${periodStart}, period_end = ${periodEnd}, cancel_at_period_end = ${sub.cancel_at_period_end}
          WHERE stripe_subscription_id = ${sub.id};
        `;
      } else {
        await sql`
          UPDATE memberships SET status = ${sub.status}, cancel_at_period_end = ${sub.cancel_at_period_end}
          WHERE stripe_subscription_id = ${sub.id};
        `;
      }
      await sql`
        UPDATE donations SET status = ${sub.status}
        WHERE stripe_subscription_id = ${sub.id};
      `;
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    if (process.env.POSTGRES_URL) {
      await sql`
        UPDATE memberships SET status = 'canceled'
        WHERE stripe_subscription_id = ${sub.id};
      `;
      await sql`
        UPDATE donations SET status = 'canceled'
        WHERE stripe_subscription_id = ${sub.id};
      `;
    }
  }

  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice & {
      subscription?: string | { id: string } | null;
    };
    const subId =
      typeof invoice.subscription === "string"
        ? invoice.subscription
        : invoice.subscription?.id;
    if (subId && process.env.POSTGRES_URL) {
      await sql`
        UPDATE memberships SET status = 'active'
        WHERE stripe_subscription_id = ${subId};
      `;
      await sql`
        UPDATE donations SET status = 'active'
        WHERE stripe_subscription_id = ${subId};
      `;
    }

    if (
      !subId &&
      invoice.metadata?.type === "casual" &&
      invoice.metadata.sessionDate &&
      process.env.POSTGRES_URL
    ) {
      await ensureTables();
      const ok = await reserveBookingSlot(invoice.metadata.sessionDate, {
        firstName: invoice.metadata.firstName ?? "",
        lastName: invoice.metadata.lastName ?? "",
        email: invoice.metadata.email ?? "",
        phone: invoice.metadata.phone || undefined,
        paymentIntentId: `cash-invoice-${invoice.id}`,
      });
      if (!ok) {
        console.error("Could not reserve slot for cash invoice — session full", invoice.id);
      }
    }
  }

  return NextResponse.json({ received: true });
}
