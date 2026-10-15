import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { sql } from "@vercel/postgres";
import { getStripe } from "@/lib/stripe";
import {
  activateMembershipByPaymentIntentId,
  activateMembershipBySubscriptionId,
  applyMembershipRenewal,
  ensureTables,
  listSessionsInRange,
  reserveBookingSlot,
} from "@/lib/db";
import { formatEventTimeRange, getClubToday } from "@/lib/dates";
import {
  sendAdminBookingRaceAlertEmail,
  sendCasualBookingConfirmationEmail,
  sendCasualBookingFullRefundEmail,
  sendMembershipConfirmationEmail,
} from "@/lib/email";
import { MONTHLY_PRICE_CENTS, QUARTERLY_PRICE_CENTS } from "@/lib/constants";

const MEMBERSHIP_PRICE_CENTS: Record<"monthly" | "quarterly", number> = {
  monthly: MONTHLY_PRICE_CENTS,
  quarterly: QUARTERLY_PRICE_CENTS,
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 503 },
    );
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

  // Every event type below eventually touches a column ensureTables() may
  // still need to create (e.g. last_renewal_invoice_id on a fresh deploy) —
  // run it once up front rather than per-branch, so a cold serverless
  // instance handling a webhook before any other route has run doesn't fail.
  if (process.env.POSTGRES_URL) {
    await ensureTables();
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    if (pi.metadata?.type === "casual" && pi.metadata.sessionDate) {
      if (process.env.POSTGRES_URL) {
        await ensureTables();
        const sessionDate = pi.metadata.sessionDate;
        const ok = await reserveBookingSlot(sessionDate, {
          firstName: pi.metadata.firstName ?? "",
          lastName: pi.metadata.lastName ?? "",
          email: pi.metadata.email ?? pi.receipt_email ?? "",
          phone: pi.metadata.phone,
          paymentIntentId: pi.id,
        });
        if (ok) {
          const customerEmail = pi.metadata.email || pi.receipt_email || "";
          if (customerEmail) {
            const [session] = await listSessionsInRange(sessionDate, sessionDate);
            const sessionTime = session?.eventStartTime
              ? formatEventTimeRange(session.eventStartTime, session.eventEndTime)
              : null;
            await sendCasualBookingConfirmationEmail(customerEmail, {
              firstName: pi.metadata.firstName ?? "",
              sessionDate,
              sessionTime,
              sessionLocation: session?.eventLocation ?? null,
            }).catch((err) =>
              console.error("Failed to send casual booking confirmation email", err),
            );
          }
        } else {
          // Race: the session filled between PaymentIntent creation (which
          // only reads capacity) and this webhook's atomic reservation. The
          // customer was already charged for a spot that no longer exists —
          // refund them immediately and make sure a human sees it either
          // way, rather than leaving this as a log line nobody watches.
          console.error("Could not reserve slot — session full", sessionDate);

          const customerEmail = pi.metadata.email || pi.receipt_email || "";
          let refunded = false;
          let errorDetail: string | undefined;
          try {
            await stripe.refunds.create(
              { payment_intent: pi.id },
              { idempotencyKey: `refund-full-${pi.id}` },
            );
            refunded = true;
          } catch (err) {
            errorDetail = err instanceof Error ? err.message : String(err);
            console.error("Automatic refund failed for oversold session", pi.id, err);
          }

          if (customerEmail) {
            await sendCasualBookingFullRefundEmail(customerEmail, {
              firstName: pi.metadata.firstName ?? "",
              sessionDate,
              amountNzd: pi.amount / 100,
            }).catch((err) => console.error("Failed to send refund email", err));
          }

          await sendAdminBookingRaceAlertEmail({
            sessionDate,
            customerEmail: customerEmail || "(unknown)",
            paymentIntentId: pi.id,
            refunded,
            errorDetail,
          }).catch((err) => console.error("Failed to send admin race alert", err));
        }
      }
    }

    if (pi.metadata?.type === "membership" && process.env.POSTGRES_URL) {
      const activated = await activateMembershipByPaymentIntentId(pi.id);
      if (activated?.periodStart && activated.periodEnd) {
        const { dateKey: clubToday } = getClubToday();
        await sendMembershipConfirmationEmail(activated.email, {
          firstName: activated.name,
          plan: activated.plan,
          day: activated.day,
          priceNzd: MEMBERSHIP_PRICE_CENTS[activated.plan] / 100,
          recurring: activated.recurring,
          periodStart: activated.periodStart,
          periodEnd: activated.periodEnd,
          delayed: activated.periodStart > clubToday,
          renewal: pi.metadata.renewal === "true",
        }).catch((err) =>
          console.error("Failed to send membership confirmation email", err),
        );
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
      // period_start/period_end are NOT synced from Stripe's raw billing
      // fields here — they represent the member's access window, which was
      // deliberately assigned to the nearest available play day at signup
      // (see assignAndReserveMembershipAccessStart) and can legitimately
      // differ from Stripe's own billing anchor. Only period_end advances,
      // additively, on renewal — see applyMembershipRenewal.
      await sql`
        UPDATE memberships SET status = ${sub.status}, cancel_at_period_end = ${sub.cancel_at_period_end}
        WHERE stripe_subscription_id = ${sub.id};
      `;
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
      // Guarded activation (status was not already 'active') tells us
      // whether this is the initial signup invoice — a renewal invoice
      // finds the membership already 'active' and returns null, so it
      // never re-triggers the welcome email below.
      const activated = await activateMembershipBySubscriptionId(subId);
      await sql`
        UPDATE donations SET status = 'active'
        WHERE stripe_subscription_id = ${subId};
      `;
      // billing_reason distinguishes a renewal invoice from the initial
      // signup invoice — only renewals should extend the access window.
      // applyMembershipRenewal is idempotent against Stripe's at-least-once
      // webhook delivery via last_renewal_invoice_id.
      if (invoice.billing_reason === "subscription_cycle" && invoice.id) {
        await applyMembershipRenewal(subId, invoice.id);
      } else if (activated?.periodStart && activated.periodEnd) {
        const { dateKey: clubToday } = getClubToday();
        await sendMembershipConfirmationEmail(activated.email, {
          firstName: activated.name,
          plan: activated.plan,
          day: activated.day,
          priceNzd: MEMBERSHIP_PRICE_CENTS[activated.plan] / 100,
          recurring: activated.recurring,
          periodStart: activated.periodStart,
          periodEnd: activated.periodEnd,
          delayed: activated.periodStart > clubToday,
        }).catch((err) =>
          console.error("Failed to send membership confirmation email", err),
        );
      }
    }

    // Backstop for a cash membership invoice (see the "Add cash member"
    // action on the admin Members page): that action already activates the
    // membership and sends the confirmation email synchronously, but this
    // covers it if that request failed after Stripe's call succeeded.
    // activateMembershipByPaymentIntentId is guarded on status != 'active',
    // so this is a no-op if the admin action already ran.
    if (
      !subId &&
      invoice.metadata?.type === "membership" &&
      invoice.id &&
      process.env.POSTGRES_URL
    ) {
      const activated = await activateMembershipByPaymentIntentId(
        `cash-invoice-${invoice.id}`,
      );
      if (activated?.periodStart && activated.periodEnd) {
        const { dateKey: clubToday } = getClubToday();
        await sendMembershipConfirmationEmail(activated.email, {
          firstName: activated.name,
          plan: activated.plan,
          day: activated.day,
          priceNzd: MEMBERSHIP_PRICE_CENTS[activated.plan] / 100,
          recurring: false,
          periodStart: activated.periodStart,
          periodEnd: activated.periodEnd,
          delayed: activated.periodStart > clubToday,
        }).catch((err) =>
          console.error("Failed to send membership confirmation email", err),
        );
      }
    }

    if (
      !subId &&
      invoice.metadata?.type === "casual" &&
      invoice.metadata.sessionDate &&
      process.env.POSTGRES_URL
    ) {
      await ensureTables();
      const sessionDate = invoice.metadata.sessionDate;
      const ok = await reserveBookingSlot(sessionDate, {
        firstName: invoice.metadata.firstName ?? "",
        lastName: invoice.metadata.lastName ?? "",
        email: invoice.metadata.email ?? "",
        phone: invoice.metadata.phone || undefined,
        paymentIntentId: `cash-invoice-${invoice.id}`,
      });
      if (!ok) {
        // Same race as the card-payment path above, but this was paid
        // out-of-band (cash) so there's no Stripe charge to auto-refund —
        // alert the admin to reconcile with the customer directly.
        console.error(
          "Could not reserve slot for cash invoice — session full",
          invoice.id,
        );
        await sendAdminBookingRaceAlertEmail({
          sessionDate,
          customerEmail: invoice.metadata.email || "(unknown)",
          paymentIntentId: `cash-invoice-${invoice.id}`,
          refunded: false,
          cashInvoice: true,
        }).catch((err) => console.error("Failed to send admin race alert", err));
      }
    }
  }

  return NextResponse.json({ received: true });
}
