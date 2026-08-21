import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@vercel/postgres";
import { DONATION_MIN_CENTS, DONATION_MAX_CENTS } from "@/lib/constants";
import { getStripe, getDonationProductId } from "@/lib/stripe";
import { checkRateLimit, getClientIp } from "@/lib/security";
import { ensureTables } from "@/lib/db";

const bodySchema = z.object({
  amount: z.number().positive(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200),
  phone: z.string().max(30).optional(),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`dons:${ip}`, 10)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = bodySchema.parse(await request.json());
    const amountCents = Math.round(body.amount * 100);
    if (amountCents < DONATION_MIN_CENTS || amountCents > DONATION_MAX_CENTS) {
      return NextResponse.json(
        {
          error: `Amount must be between $${DONATION_MIN_CENTS / 100} and $${DONATION_MAX_CENTS / 100} NZD`,
        },
        { status: 400 },
      );
    }

    const stripe = getStripe();
    const productId = getDonationProductId();

    const customers = await stripe.customers.list({
      email: body.email,
      limit: 1,
    });
    const customer =
      customers.data[0] ??
      (await stripe.customers.create({
        email: body.email,
        name: `${body.firstName} ${body.lastName}`,
        phone: body.phone,
        metadata: { type: "donation" },
      }));

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price_data: {
            currency: "nzd",
            product: productId,
            unit_amount: amountCents,
            recurring: { interval: "month" },
          },
        },
      ],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
      },
      expand: ["latest_invoice.payment_intent"],
      metadata: {
        type: "donation",
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
      },
    });

    const invoice = subscription.latest_invoice;
    const paymentIntent =
      typeof invoice === "object" && invoice && "payment_intent" in invoice
        ? invoice.payment_intent
        : null;

    const clientSecret =
      typeof paymentIntent === "object" &&
      paymentIntent &&
      "client_secret" in paymentIntent
        ? (paymentIntent.client_secret as string)
        : null;

    if (!clientSecret) {
      return NextResponse.json(
        { error: "Failed to initialize donation payment" },
        { status: 500 },
      );
    }

    if (process.env.POSTGRES_URL) {
      await ensureTables();
      await sql`
        INSERT INTO donations (email, first_name, last_name, amount_cents, frequency, stripe_subscription_id, status)
        VALUES (${body.email}, ${body.firstName}, ${body.lastName}, ${amountCents}, 'monthly', ${subscription.id}, 'pending')
        ON CONFLICT (stripe_subscription_id) DO NOTHING;
      `;
    }

    return NextResponse.json({
      clientSecret,
      subscriptionId: subscription.id,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
