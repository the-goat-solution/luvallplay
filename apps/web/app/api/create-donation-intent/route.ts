import { NextResponse } from "next/server";
import { z } from "zod";
import { clubConfig } from "@/lib/club";
import { getStripe } from "@/lib/stripe";
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
  if (!checkRateLimit(`don:${ip}`, 10)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = bodySchema.parse(await request.json());
    const amountCents = Math.round(body.amount * 100);
    // The club's donation limits (Phase 3 step 4: settings, not constants).
    const { minAmount, maxAmount } = (await clubConfig()).donations;
    if (amountCents < minAmount || amountCents > maxAmount) {
      return NextResponse.json(
        {
          error: `Amount must be between $${minAmount / 100} and $${maxAmount / 100} NZD`,
        },
        { status: 400 },
      );
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "nzd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          type: "donation",
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          phone: body.phone ?? "",
        },
        receipt_email: body.email,
        description: "Donation — Three Wolves Badminton Club",
      },
      {
        idempotencyKey: `donation-${body.email}-${amountCents}-${Date.now()}`,
      },
    );

    if (!paymentIntent.client_secret) {
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    const status = message.includes("STRIPE") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
