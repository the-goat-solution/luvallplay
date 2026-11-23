import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getStripe,
  getInvoicePaymentIntent,
  resolvePriceId,
  createOneTimeMembershipPaymentIntent,
} from "@/lib/stripe";
import { checkRateLimit, getClientIp, verifyTurnstile } from "@/lib/security";
import { assignAndReserveMembershipAccessStart, attachStripeIdToMembership, type MembershipAssignment } from "@/lib/db";
import { getClubToday } from "@/lib/dates";
import { isDayPaused } from "@/lib/day-requests";
import { getPlayerFromRequest } from "@/lib/player-auth";

const bodySchema = z.object({
  plan: z.enum(["monthly", "quarterly"]),
  day: z.enum(["friday", "wednesday"]),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200),
  phone: z.string().max(30).default(""),
  recurring: z.boolean().optional().default(true),
  turnstileToken: z.string().optional(),
});

const TIER_LABEL = { monthly: "Monthly", quarterly: "Quarterly" } as const;
const DAY_LABEL = { friday: "Friday", wednesday: "Wednesday" } as const;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`sub:${ip}`, 10)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = bodySchema.parse(await request.json());
    // Joining as a member needs a Three Wolves account: the membership is
    // then managed from the profile. The account's email is the one used,
    // whatever the form sent. A signed-in player has already proven they're
    // a person, so the bot check is skipped.
    const player = process.env.POSTGRES_URL ? await getPlayerFromRequest(request) : null;
    if (process.env.POSTGRES_URL && !player) {
      return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
    }
    if (player) {
      body.email = player.email;
      body.firstName = body.firstName.trim() || player.firstName;
      body.lastName = body.lastName.trim() || player.lastName;
      body.phone = body.phone.trim() || player.phone || "";
    }
    const turnstileOk = player ? true : await verifyTurnstile(body.turnstileToken, ip);
    if (!turnstileOk) {
      return NextResponse.json(
        { error: "Captcha verification failed" },
        { status: 403 },
      );
    }

    if (await isDayPaused(body.day)) {
      return NextResponse.json(
        { error: "day_paused", day: body.day },
        { status: 409 },
      );
    }

    const stripe = getStripe();

    // Reserve the membership's access-start date — and therefore capacity —
    // before touching Stripe at all, so a full play day never gets oversold
    // and nobody is charged for a signup that turns out to be impossible.
    // When there's no DB configured (local dev without POSTGRES_URL), skip
    // this entirely; there's no capacity data to check against.
    let assignment: (MembershipAssignment & { blocked: false }) | null = null;
    if (process.env.POSTGRES_URL) {
      const result = await assignAndReserveMembershipAccessStart(
        body.plan,
        body.day,
        {
          email: body.email,
          firstName: body.firstName,
          lastName: body.lastName,
          phone: body.phone || null,
          recurring: body.recurring,
        },
      );
      if (result.blocked) {
        return NextResponse.json(
          { error: result.reason, day: body.day },
          { status: 409 },
        );
      }
      assignment = result;
    }
    const periodStart =
      assignment?.periodStart ?? getClubToday().dateKey;

    if (!body.recurring) {
      const paymentIntent = await createOneTimeMembershipPaymentIntent({
        plan: body.plan,
        day: body.day,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
      });

      if (!paymentIntent.client_secret) {
        return NextResponse.json(
          { error: "Failed to initialize membership payment" },
          { status: 500 },
        );
      }

      if (assignment) {
        await attachStripeIdToMembership(assignment.membershipId, {
          stripePaymentIntentId: paymentIntent.id,
        });
      }

      return NextResponse.json({
        clientSecret: paymentIntent.client_secret,
        periodStart,
      });
    }

    const priceId = await resolvePriceId(body.plan, body.day);

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
        metadata: { plan: body.plan, day: body.day },
      }));

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
      },
      description: `Three Wolves — ${TIER_LABEL[body.plan]} Membership (${DAY_LABEL[body.day]})`,
      metadata: {
        plan: body.plan,
        day: body.day,
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
        { error: "Failed to initialize subscription payment" },
        { status: 500 },
      );
    }
    const clientSecret = invoicePaymentIntent.clientSecret;

    // Setting receipt_email always sends a payment receipt once this invoice's
    // payment succeeds, regardless of the account's dashboard email settings —
    // without this, new members paid but received no confirmation email.
    await stripe.paymentIntents.update(invoicePaymentIntent.id, {
      receipt_email: body.email,
    });

    if (assignment) {
      await attachStripeIdToMembership(assignment.membershipId, {
        stripeSubscriptionId: subscription.id,
      });
    }

    return NextResponse.json({
      clientSecret,
      subscriptionId: subscription.id,
      periodStart,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
