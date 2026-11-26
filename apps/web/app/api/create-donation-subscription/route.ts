import { NextResponse } from "next/server";
import { z } from "zod";
import { insertMonthlyDonation } from "@/lib/repos/donations";
import { clubConfig } from "@/lib/club";
import { customersOf, payments, subscriptionsOf } from "@/lib/payments";
import { getDonationProductId } from "@/lib/stripe";
import { checkRateLimit, getClientIp } from "@/lib/security";
import { formatMoney, roundToMinor } from "@/lib/money";

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
    const club = await clubConfig();
    const amountCents = roundToMinor(body.amount, club.currency);
    // The club's donation limits (Phase 3 step 4: settings, not constants).
    const { minAmount, maxAmount } = club.donations;
    if (amountCents < minAmount || amountCents > maxAmount) {
      return NextResponse.json(
        {
          error: `Amount must be between ${formatMoney(minAmount, club.currency, { trimZeros: true })} and ${formatMoney(maxAmount, club.currency, { trimZeros: true, code: true })}`,
        },
        { status: 400 },
      );
    }

    // Through the Payments interface (lib/payments): a monthly donation
    // needs a provider that can charge again by itself.
    const provider = payments();
    const subscriptions = subscriptionsOf(provider);
    const customers = customersOf(provider);
    provider.assertReady();
    const productId = getDonationProductId();

    const customerId =
      (await customers.find(body.email)) ??
      (await customers.create({
        email: body.email,
        name: `${body.firstName} ${body.lastName}`,
        phone: body.phone,
        metadata: { type: "donation" },
      }));

    const subscription = await subscriptions.start({
      customerId,
      price: { amount: amountCents, currency: club.currency, productId, every: "month" },
      metadata: {
        type: "donation",
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
      },
      receiptEmail: body.email,
    });

    if (!subscription.clientSecret) {
      return NextResponse.json(
        { error: "Failed to initialize donation payment" },
        { status: 500 },
      );
    }
    const clientSecret = subscription.clientSecret;

    if (process.env.POSTGRES_URL) {
      await insertMonthlyDonation({ email: body.email, firstName: body.firstName, lastName: body.lastName, amountCents, stripeSubscriptionId: subscription.subscriptionId });
    }

    return NextResponse.json({
      clientSecret,
      subscriptionId: subscription.subscriptionId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
