import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@vercel/postgres";
import { getStripe, getPriceId, getInvoicePaymentClientSecret } from "@/lib/stripe";
import { checkRateLimit, getClientIp } from "@/lib/security";
import { ensureTables } from "@/lib/db";

const bodySchema = z.object({
  plan: z.enum(["monthly", "quarterly"]),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200),
  phone: z.string().max(30).optional(),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`sub:${ip}`, 10)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = bodySchema.parse(await request.json());
    const stripe = getStripe();
    const priceId = getPriceId(body.plan);

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
        metadata: { plan: body.plan },
      }));

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
      },
      metadata: {
        plan: body.plan,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
      },
    });

    const invoiceId =
      typeof subscription.latest_invoice === "string"
        ? subscription.latest_invoice
        : subscription.latest_invoice?.id;

    const clientSecret = invoiceId
      ? await getInvoicePaymentClientSecret(stripe, invoiceId)
      : null;

    if (!clientSecret) {
      return NextResponse.json(
        { error: "Failed to initialize subscription payment" },
        { status: 500 },
      );
    }

    if (process.env.POSTGRES_URL) {
      await ensureTables();
      const item = subscription.items.data[0];
      const periodStart = new Date(
        (item?.current_period_start ?? subscription.created) * 1000,
      )
        .toISOString()
        .slice(0, 10);
      const periodEnd = item
        ? new Date(item.current_period_end * 1000).toISOString().slice(0, 10)
        : periodStart;
      await sql`
        INSERT INTO memberships (email, plan, first_name, last_name, phone, period_start, period_end, stripe_subscription_id, status)
        VALUES (
          ${body.email},
          ${body.plan},
          ${body.firstName},
          ${body.lastName},
          ${body.phone ?? null},
          ${periodStart},
          ${periodEnd},
          ${subscription.id},
          'pending'
        )
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
