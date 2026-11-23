import { NextResponse } from "next/server";
import { z } from "zod";
import { insertMonthlyDonation } from "@/lib/repos/donations";
import { DONATION_MIN_CENTS, DONATION_MAX_CENTS } from "@/lib/constants";
import { getStripe, getDonationProductId, getInvoicePaymentIntent } from "@/lib/stripe";
import { checkRateLimit, getClientIp } from "@/lib/security";

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
      metadata: {
        type: "donation",
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
      },
    });

    const invoiceId =
      typeof subscription.latest_invoice === "string"
        ? subscription.latest_invoice
        : subscription.latest_invoice?.id;

    const invoicePaymentIntent = invoiceId
      ? await getInvoicePaymentIntent(stripe, invoiceId)
      : null;

    if (!invoicePaymentIntent) {
      return NextResponse.json(
        { error: "Failed to initialize donation payment" },
        { status: 500 },
      );
    }
    const clientSecret = invoicePaymentIntent.clientSecret;

    await stripe.paymentIntents.update(invoicePaymentIntent.id, {
      receipt_email: body.email,
    });

    if (process.env.POSTGRES_URL) {
      await insertMonthlyDonation({ email: body.email, firstName: body.firstName, lastName: body.lastName, amountCents, stripeSubscriptionId: subscription.id });
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
