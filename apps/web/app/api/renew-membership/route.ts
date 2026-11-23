import { NextResponse } from "next/server";
import { z } from "zod";
import { assignAndReserveMembershipAccessStart, attachStripeIdToMembership, getActiveRenewalOf, getMembershipByRenewalToken } from "@/lib/db";
import {
  createOneTimeMembershipPaymentIntent,
  oneTimeMembershipPriceCents,
} from "@/lib/stripe";
import { checkRateLimit, getClientIp } from "@/lib/security";
import { clubMajor } from "@/lib/money";

const bodySchema = z.object({
  token: z.string().min(10).max(200),
  plan: z.enum(["monthly", "quarterly"]),
});

// Pays for the next period of a one-time membership, from the private link
// in its renewal reminder email (see lib/membership-renewal.ts). The new
// membership starts on the first play day with room after the current one
// ends, and is activated by the Stripe webhook like any one-time signup.
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`renew:${ip}`, 10)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Renewals are unavailable right now." }, { status: 503 });
  }

  try {
    const body = bodySchema.parse(await request.json());

    const current = await getMembershipByRenewalToken(body.token);
    if (!current || current.recurring || !current.periodEnd) {
      return NextResponse.json(
        { error: "This renewal link is invalid or has expired." },
        { status: 404 },
      );
    }
    if (await getActiveRenewalOf(current.id)) {
      return NextResponse.json({ error: "already_renewed" }, { status: 409 });
    }

    const assignment = await assignAndReserveMembershipAccessStart(
      body.plan,
      current.day,
      {
        email: current.email,
        firstName: current.firstName,
        lastName: current.lastName,
        phone: current.phone,
        recurring: false,
      },
      undefined,
      { membershipId: current.id, periodEnd: current.periodEnd },
    );
    if (assignment.blocked) {
      // Another membership for this day already covers the next period —
      // most likely a renewal still waiting on payment, or a fresh signup.
      const error =
        assignment.reason === "already_member" ? "already_renewed" : assignment.reason;
      return NextResponse.json({ error }, { status: 409 });
    }

    const paymentIntent = await createOneTimeMembershipPaymentIntent({
      plan: body.plan,
      day: current.day,
      firstName: current.firstName,
      lastName: current.lastName,
      email: current.email,
      phone: current.phone,
      renewalOf: current.id,
    });
    if (!paymentIntent.client_secret) {
      return NextResponse.json(
        { error: "Failed to initialize renewal payment" },
        { status: 500 },
      );
    }
    await attachStripeIdToMembership(assignment.membershipId, {
      stripePaymentIntentId: paymentIntent.id,
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      periodStart: assignment.periodStart,
      periodEnd: assignment.periodEnd,
      priceNzd: clubMajor(oneTimeMembershipPriceCents(body.plan)),
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    console.error("Membership renewal failed", e);
    return NextResponse.json(
      { error: "Sorry, we couldn't start your renewal. Please try again." },
      { status: 500 },
    );
  }
}
