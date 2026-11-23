import { NextResponse } from "next/server";
import { clubCurrencyLower } from "@/lib/money";
import { z } from "zod";
import { getAvailableSpots, isRegistrationLocked } from "@/lib/db";
import { isSessionDatePaused } from "@/lib/day-requests";
import { getWeekdayForDate } from "@/lib/dates";
import { CASUAL_PRICE_CENTS, WEEKDAY_LABEL } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";
import { getPlayerFromRequest } from "@/lib/player-auth";
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
    // Casual play stays bookable without an account. A signed-in player
    // books under their account email and skips the bot check.
    const player = process.env.POSTGRES_URL ? await getPlayerFromRequest(request).catch(() => null) : null;
    if (player) body.email = player.email;
    const turnstileOk = player ? true : await verifyTurnstile(body.turnstileToken, ip);
    if (!turnstileOk) {
      return NextResponse.json({ error: "Captcha verification failed" }, { status: 403 });
    }

    if (process.env.POSTGRES_URL) {
    }

    await assertSessionBookable(body.sessionDate);

    if (await isSessionDatePaused(body.sessionDate)) {
      const dayLabel = WEEKDAY_LABEL[getWeekdayForDate(body.sessionDate)];
      return NextResponse.json(
        { error: `${dayLabel} sessions are temporarily paused` },
        { status: 409 },
      );
    }

    if (process.env.POSTGRES_URL) {
      if (await isRegistrationLocked(body.sessionDate)) {
        return NextResponse.json(
          { error: "Registration for this session is closed" },
          { status: 409 },
        );
      }
      const spots = await getAvailableSpots(body.sessionDate);
      if (spots <= 0) {
        return NextResponse.json({ error: "Session is full" }, { status: 409 });
      }
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: CASUAL_PRICE_CENTS,
        currency: clubCurrencyLower(),
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
