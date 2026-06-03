import { NextResponse } from "next/server";
import { z } from "zod";
import { CASUAL_PRICE_CENTS } from "@/lib/constants";
import { getAvailableSpots, ensureTables } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import {
  assertSessionBookable,
  checkRateLimit,
  getClientIp,
  verifyTurnstile,
} from "@/lib/security";

const bodySchema = z.object({
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200),
  phone: z.string().max(30).optional(),
  turnstileToken: z.string().optional(),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`pi:${ip}`, 10)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = bodySchema.parse(await request.json());
    const turnstileOk = await verifyTurnstile(body.turnstileToken, ip);
    if (!turnstileOk) {
      return NextResponse.json({ error: "Captcha verification failed" }, { status: 403 });
    }

    assertSessionBookable(body.sessionDate);

    if (process.env.POSTGRES_URL) {
      await ensureTables();
      const spots = await getAvailableSpots(body.sessionDate);
      if (spots <= 0) {
        return NextResponse.json({ error: "Session is full" }, { status: 409 });
      }
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: CASUAL_PRICE_CENTS,
        currency: "nzd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          type: "casual",
          sessionDate: body.sessionDate,
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          phone: body.phone ?? "",
        },
        receipt_email: body.email,
        description: `Casual session — ${body.sessionDate}`,
      },
      { idempotencyKey: `casual-${body.sessionDate}-${body.email}-${Date.now()}` },
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
