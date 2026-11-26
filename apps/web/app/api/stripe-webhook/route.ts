import { clubClock } from "@/lib/club";
import { getOrder, markOrderPaidByCard } from "@/lib/shop-db";
import { payments } from "@/lib/payments";
import { offlineMethodFromSource, offlinePaymentRef } from "@/lib/offline-payment";
import { notifyOrderPlaced, notifyOversold } from "@/lib/shop-notify";
import { syncPlanFromSubscriptionMetadata } from "@/lib/membership-self-service";
import { linkMemberAccount } from "@/lib/player-db";
import { NextResponse } from "next/server";
import { markPassPaid } from "@/lib/wolf-vision-db";
import type Stripe from "stripe";
import { insertOneTimeDonation, setDonationStatusBySubscription } from "@/lib/repos/donations";
import { setMembershipStatusBySubscription } from "@/lib/repos/memberships";
import { getStripe } from "@/lib/stripe";
import { markStripeEventHandled, stripeEventHandled } from "@/lib/stripe-events";
import { activateMembershipByPaymentIntentId, activateMembershipBySubscriptionId, applyMembershipRenewal, listMemberMiniGameDates, listSessionsInRange, reserveBookingSlotOnce } from "@/lib/db";
import { formatEventTimeRange, getClubToday } from "@/lib/dates";
import {
  sendAdminBookingRaceAlertEmail,
  sendCasualBookingConfirmationEmail,
  sendCasualBookingFullRefundEmail,
  sendMembershipConfirmationEmail,
} from "@/lib/email";
import { MONTHLY_PRICE_CENTS, QUARTERLY_PRICE_CENTS } from "@/lib/constants";
import { clubMajor } from "@/lib/money";
import { JUNIOR_PAYMENT, settleJuniorPayment } from "@/lib/juniors/payments";
import { sql } from "@/lib/database";

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

  // The signature is checked by the provider behind the Payments interface
  // (lib/payments); the handlers below still read Stripe's own event.
  let event: Stripe.Event;
  try {
    event = (await payments().verifyWebhook({ body, headers: { "stripe-signature": signature } })).raw as Stripe.Event;
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Delivered before and handled to the end: nothing to do twice (lib/stripe-events.ts).
  if (process.env.POSTGRES_URL && (await stripeEventHandled(event.id))) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    if (pi.metadata?.type === "casual" && pi.metadata.sessionDate) {
      if (process.env.POSTGRES_URL) {
        const sessionDate = pi.metadata.sessionDate;
        // "already": this payment has its booking (Stripe delivers events at
        // least once). Nothing to count, confirm or refund a second time.
        const slot = await reserveBookingSlotOnce(sessionDate, {
          firstName: pi.metadata.firstName ?? "",
          lastName: pi.metadata.lastName ?? "",
          email: pi.metadata.email ?? pi.receipt_email ?? "",
          phone: pi.metadata.phone,
          paymentIntentId: pi.id,
        });
        if (slot === "reserved") {
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
        } else if (slot === "full") {
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
              amountNzd: clubMajor(pi.amount),
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

    // A child's place (Juniors, hidden in production): lib/juniors books it or refunds it.
    if (pi.metadata?.type === JUNIOR_PAYMENT && process.env.POSTGRES_URL) {
      const settled = await settleJuniorPayment(sql, pi);
      if (settled.outcome === "refunded" || settled.outcome === "refund_failed") {
        await sendAdminBookingRaceAlertEmail({
          sessionDate: settled.sessionDate,
          customerEmail: settled.guardianEmail || "(unknown)",
          paymentIntentId: pi.id,
          refunded: settled.outcome === "refunded",
          errorDetail: `Junior booking not made (${settled.why}).${settled.error ? ` ${settled.error}` : ""}`,
        }).catch((err) => console.error("Failed to send admin alert for a junior payment", err));
      }
    }

    if (pi.metadata?.type === "membership" && process.env.POSTGRES_URL) {
      const activated = await activateMembershipByPaymentIntentId(pi.id);
      if (activated) {
        await linkMemberAccount(activated.email, {
          firstName: activated.firstName,
          lastName: activated.lastName,
          phone: activated.phone,
          stripeCustomerId: typeof pi.customer === "string" ? pi.customer : (pi.customer?.id ?? null),
        });
      }
      if (activated?.periodStart && activated.periodEnd) {
        const { dateKey: clubToday } = getClubToday(new Date(), await clubClock());
        await sendMembershipConfirmationEmail(activated.email, {
          firstName: activated.name,
          plan: activated.plan,
          day: activated.day,
          priceNzd: clubMajor(MEMBERSHIP_PRICE_CENTS[activated.plan]),
          recurring: activated.recurring,
          periodStart: activated.periodStart,
          periodEnd: activated.periodEnd,
          delayed: activated.periodStart > clubToday,
          miniGameDates: await listMemberMiniGameDates(
            activated.day,
            activated.periodStart,
            activated.periodEnd,
          ).catch(() => []),
          renewal: pi.metadata.renewal === "true",
        }).catch((err) =>
          console.error("Failed to send membership confirmation email", err),
        );
      }
    }

    if (pi.metadata?.type === "shop" && pi.metadata.orderId && process.env.POSTGRES_URL) {
      const orderId = Number(pi.metadata.orderId);
      const result = await markOrderPaidByCard(orderId);
      const order = await getOrder(orderId);
      if (order && result === "paid") await notifyOrderPlaced(order);
      if (order && result === "oversold") await notifyOversold(order);
    }

    if (pi.metadata?.type === "donation") {
      if (process.env.POSTGRES_URL) {
        await insertOneTimeDonation({
          email: pi.metadata.email ?? pi.receipt_email ?? "",
          firstName: pi.metadata.firstName ?? "",
          lastName: pi.metadata.lastName ?? "",
          amountCents: pi.amount,
          stripePaymentIntentId: pi.id,
        });
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
      // The only trials this club uses are admin-given free months on
      // quarterly subscriptions (addFreeDaysBeforeNextCharge) — the member
      // is still a member while billing is deferred.
      const membershipStatus = sub.status === "trialing" ? "active" : sub.status;
      // A plan/day change scheduled from the profile (lib/membership-
      // self-service.ts) lands here as new subscription metadata.
      await syncPlanFromSubscriptionMetadata(sub.id, sub.metadata);
      await setMembershipStatusBySubscription(sub.id, membershipStatus, sub.cancel_at_period_end);
      await setDonationStatusBySubscription(sub.id, sub.status);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    if (process.env.POSTGRES_URL) {
      await setMembershipStatusBySubscription(sub.id, "canceled");
      await setDonationStatusBySubscription(sub.id, "canceled");
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
      if (activated) {
        await linkMemberAccount(activated.email, {
          firstName: activated.firstName,
          lastName: activated.lastName,
          phone: activated.phone,
          stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null),
        });
      }
      await setDonationStatusBySubscription(subId, "active");
      // billing_reason distinguishes a renewal invoice from the initial
      // signup invoice — only renewals should extend the access window.
      // applyMembershipRenewal is idempotent against Stripe's at-least-once
      // webhook delivery via last_renewal_invoice_id.
      if (invoice.billing_reason === "subscription_cycle" && invoice.id) {
        // If this renewal starts a scheduled plan change, switch the plan
        // first so the renewal adds the new cycle length.
        await syncPlanFromSubscriptionMetadata(
          subId,
          invoice.parent?.subscription_details?.metadata as Record<string, string> | undefined,
        );
        await applyMembershipRenewal(subId, invoice.id);
      } else if (activated?.periodStart && activated.periodEnd && activated.periodEnd >= activated.periodStart) {
        const { dateKey: clubToday } = getClubToday(new Date(), await clubClock());
        await sendMembershipConfirmationEmail(activated.email, {
          firstName: activated.name,
          plan: activated.plan,
          day: activated.day,
          priceNzd: clubMajor(MEMBERSHIP_PRICE_CENTS[activated.plan]),
          recurring: activated.recurring,
          periodStart: activated.periodStart,
          periodEnd: activated.periodEnd,
          delayed: activated.periodStart > clubToday,
          miniGameDates: await listMemberMiniGameDates(
            activated.day,
            activated.periodStart,
            activated.periodEnd,
          ).catch(() => []),
        }).catch((err) =>
          console.error("Failed to send membership confirmation email", err),
        );
      }
    }

    // Backstop for an offline (cash / bank transfer) membership invoice (see
    // the "Add offline payment member" action on the admin Members page):
    // that action already activates the
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
        offlinePaymentRef(offlineMethodFromSource(invoice.metadata.source) ?? "cash", invoice.id),
      );
      if (activated) {
        await linkMemberAccount(activated.email, {
          firstName: activated.firstName,
          lastName: activated.lastName,
          phone: activated.phone,
        }, "admin");
      }
      if (activated?.periodStart && activated.periodEnd) {
        const { dateKey: clubToday } = getClubToday(new Date(), await clubClock());
        await sendMembershipConfirmationEmail(activated.email, {
          firstName: activated.name,
          plan: activated.plan,
          day: activated.day,
          priceNzd: clubMajor(MEMBERSHIP_PRICE_CENTS[activated.plan]),
          recurring: false,
          periodStart: activated.periodStart,
          periodEnd: activated.periodEnd,
          delayed: activated.periodStart > clubToday,
          miniGameDates: await listMemberMiniGameDates(
            activated.day,
            activated.periodStart,
            activated.periodEnd,
          ).catch(() => []),
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
      const sessionDate = invoice.metadata.sessionDate;
      const offlineRef = offlinePaymentRef(
        offlineMethodFromSource(invoice.metadata.source) ?? "cash",
        invoice.id!,
      );
      const slot = await reserveBookingSlotOnce(sessionDate, {
        firstName: invoice.metadata.firstName ?? "",
        lastName: invoice.metadata.lastName ?? "",
        email: invoice.metadata.email ?? "",
        phone: invoice.metadata.phone || undefined,
        paymentIntentId: offlineRef,
      });
      if (slot === "full") {
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
          paymentIntentId: offlineRef,
          refunded: false,
          cashInvoice: true,
        }).catch((err) => console.error("Failed to send admin race alert", err));
      }
    }
  }

  // Wolf Vision passes (Stripe Checkout). The return page also confirms the payment, so
  // this only matters when the buyer closes the tab before coming back.
  if (event.type === "checkout.session.completed") {
    const cs = event.data.object as Stripe.Checkout.Session;
    if (cs.metadata?.type === "wolf_vision" && cs.payment_status === "paid" && process.env.POSTGRES_URL) {
      await markPassPaid(cs.id).catch((err) => console.error("[wolf-vision] mark paid failed", err));
    }
  }

  if (process.env.POSTGRES_URL) await markStripeEventHandled(event.id, event.type);
  return NextResponse.json({ received: true });
}
