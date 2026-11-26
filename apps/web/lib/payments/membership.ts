// Paying for a membership: the one path the website and the players' app
// share (Phase 6 Stage B, W1). Before this, app/api/create-subscription and
// lib/app-membership.ts each built the same Stripe requests by hand and had
// started to drift (audit, 25 Nov 2026).
//
// Through the payments interface: a club whose provider can't charge again
// by itself (capabilities.recurring false) gets PaymentError("unsupported")
// from the auto-renew path, and its screens offer one-time memberships with
// renewal reminders instead.
//
// tests/stripe-requests.test.ts pins what Stripe is sent, request by request.
import { clubClock } from "../club";
import { CLUB_CURRENCY, MONTHLY_PRICE_CENTS, QUARTERLY_PRICE_CENTS, type MembershipDay, type MembershipTier } from "../constants";
import { getPricingPlans } from "../business-config";
import { getClubToday } from "../dates";
import { isDayPaused } from "../day-requests";
import { assignAndReserveMembershipAccessStart, attachStripeIdToMembership } from "../db";
import { combinePlanId } from "../pricing-plans";
import { customersOf, payments, subscriptionsOf } from "./index";

// Env var name for each (day, tier) pair. Friday keeps the original env var
// names so the already-deployed Friday configuration needs no changes —
// only Wednesday needs new Vercel env vars added.
const PRICE_ENV_KEYS: Record<MembershipDay, Record<MembershipTier, string>> = {
  friday: {
    monthly: "STRIPE_PRICE_MONTHLY",
    quarterly: "STRIPE_PRICE_QUARTERLY",
  },
  wednesday: {
    monthly: "STRIPE_PRICE_WEDNESDAY_MONTHLY",
    quarterly: "STRIPE_PRICE_WEDNESDAY_QUARTERLY",
  },
};

/** The provider's price for an auto-renewing plan on a day. */
export async function resolvePriceId(plan: MembershipTier, day: MembershipDay): Promise<string> {
  const envKey = PRICE_ENV_KEYS[day][plan];
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;

  const planId = combinePlanId(day, plan);
  const plans = await getPricingPlans();
  const fromCms = plans?.find((p) => p.planId === planId)?.stripePriceId?.trim();
  if (fromCms) return fromCms;

  throw new Error(`${envKey} is not configured`);
}

export function oneTimeMembershipPriceCents(plan: MembershipTier): number {
  return plan === "monthly" ? MONTHLY_PRICE_CENTS : QUARTERLY_PRICE_CENTS;
}

const TIER_LABEL: Record<MembershipTier, string> = { monthly: "Monthly", quarterly: "Quarterly" };
const DAY_LABEL: Record<MembershipDay, string> = { friday: "Friday", wednesday: "Wednesday" };

/** What the payer's statement and receipt say. The one place it is written. */
export function membershipDescription(plan: MembershipTier, day: MembershipDay, kind?: "one-time" | "renewal"): string {
  const label = `Three Wolves — ${TIER_LABEL[plan]} Membership (${DAY_LABEL[day]})`;
  return kind ? `${label} — ${kind}` : label;
}

export type MembershipPayer = { firstName: string; lastName: string; email: string; phone: string | null };

/** The provider's customer for this payer: the one it has for the email, or a new one. */
async function customerFor(payer: MembershipPayer, plan: MembershipTier, day: MembershipDay): Promise<string> {
  const customers = customersOf(payments());
  return (
    (await customers.find(payer.email)) ??
    (await customers.create({ email: payer.email, name: `${payer.firstName} ${payer.lastName}`, phone: payer.phone ?? undefined, metadata: { plan, day } }))
  );
}

/**
 * A single (non-recurring) membership payment: new one-time signups, and
 * renewing one. The webhook activates the matching membership row by this
 * payment's id once it succeeds.
 */
export async function createOneTimeMembershipPayment(input: MembershipPayer & { plan: MembershipTier; day: MembershipDay; renewalOf?: number }): Promise<{ id: string; clientSecret: string | null }> {
  const customerId = await customerFor(input, input.plan, input.day);
  const payment = await payments().createPayment({
    amount: oneTimeMembershipPriceCents(input.plan),
    currency: CLUB_CURRENCY,
    customerId,
    receiptEmail: input.email,
    description: membershipDescription(input.plan, input.day, input.renewalOf ? "renewal" : "one-time"),
    metadata: {
      type: "membership",
      plan: input.plan,
      day: input.day,
      recurring: "false",
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone ?? "",
      ...(input.renewalOf ? { renewal: "true", renewalOf: String(input.renewalOf) } : {}),
    },
    idempotencyKey: `membership-onetime-${input.plan}-${input.email}-${Date.now()}`,
  });
  return { id: payment.id, clientSecret: payment.clientSecret ?? null };
}

/** The same payment under its old name and shape, for app/api/renew-membership. */
export async function createOneTimeMembershipPaymentIntent(input: MembershipPayer & { plan: MembershipTier; day: MembershipDay; renewalOf?: number }): Promise<{ id: string; client_secret: string | null }> {
  const payment = await createOneTimeMembershipPayment(input);
  return { id: payment.id, client_secret: payment.clientSecret };
}

/**
 * A new auto-renewing membership: find or create the customer, subscribe
 * with the first invoice left to pay in the browser, and send its receipt.
 * Returns that invoice's payment to confirm, or null when there is none.
 */
export async function createMembershipSubscription(input: MembershipPayer & { plan: MembershipTier; day: MembershipDay }): Promise<{ subscriptionId: string; clientSecret: string } | null> {
  const subscriptions = subscriptionsOf(payments());
  const priceId = await resolvePriceId(input.plan, input.day);
  const customerId = await customerFor(input, input.plan, input.day);
  const started = await subscriptions.start({
    customerId,
    price: { priceId },
    description: membershipDescription(input.plan, input.day),
    metadata: { plan: input.plan, day: input.day, firstName: input.firstName, lastName: input.lastName, email: input.email },
    receiptEmail: input.email,
  });
  return started.clientSecret ? { subscriptionId: started.subscriptionId, clientSecret: started.clientSecret } : null;
}

export type JoinResult =
  | { ok: true; clientSecret: string; periodStart: string; subscriptionId?: string }
  /** A play day that's paused, or no room (the reason is lib/db.ts's). */
  | { ok: false; reason: string; kind: "day_paused" | "blocked" }
  /** The provider had no payment for the browser to confirm. */
  | { ok: false; reason: "no_payment"; kind: "no_payment"; recurring: boolean };

/**
 * Joining as a member, for the website (app/api/create-subscription) and the
 * players' app (lib/app-membership.ts): the paused-day check, then the
 * membership's access-start date and therefore capacity are reserved BEFORE
 * the provider is touched, so a full play day is never oversold and nobody is
 * charged for a signup that turns out to be impossible; then the payment,
 * whose id is saved on the reserved row.
 *
 * Without a database (local development) there's no capacity to check and
 * nothing to save: the payment is still started.
 */
export async function joinMembership(payer: MembershipPayer, choice: { plan: MembershipTier; day: MembershipDay; recurring: boolean }): Promise<JoinResult> {
  if (await isDayPaused(choice.day)) return { ok: false, reason: "day_paused", kind: "day_paused" };
  // No credentials (or a live key outside production) stops here, with nothing reserved.
  payments().assertReady();

  const hasDb = Boolean(process.env.POSTGRES_URL);
  let membershipId: number | null = null;
  let periodStart: string | null = null;
  if (hasDb) {
    const result = await assignAndReserveMembershipAccessStart(choice.plan, choice.day, { email: payer.email, firstName: payer.firstName, lastName: payer.lastName, phone: payer.phone || null, recurring: choice.recurring });
    if (result.blocked) return { ok: false, reason: result.reason, kind: "blocked" };
    membershipId = result.membershipId;
    periodStart = result.periodStart;
  }
  const start = periodStart ?? getClubToday(new Date(), await clubClock()).dateKey;

  if (!choice.recurring) {
    const payment = await createOneTimeMembershipPayment({ ...payer, plan: choice.plan, day: choice.day });
    if (!payment.clientSecret) return { ok: false, reason: "no_payment", kind: "no_payment", recurring: false };
    if (membershipId !== null) await attachStripeIdToMembership(membershipId, { stripePaymentIntentId: payment.id });
    return { ok: true, clientSecret: payment.clientSecret, periodStart: start };
  }

  const sub = await createMembershipSubscription({ ...payer, plan: choice.plan, day: choice.day });
  if (!sub) return { ok: false, reason: "no_payment", kind: "no_payment", recurring: true };
  if (membershipId !== null) await attachStripeIdToMembership(membershipId, { stripeSubscriptionId: sub.subscriptionId });
  return { ok: true, clientSecret: sub.clientSecret, subscriptionId: sub.subscriptionId, periodStart: start };
}

/** A casual session's payment, for the website (app/api/create-payment-intent) and the app; the webhook books the spot once it's paid. */
export async function createCasualPayment(input: { sessionDate: string; firstName: string; lastName: string; email: string; phone: string; amount: number }) {
  return payments().createPayment({
    amount: input.amount,
    currency: CLUB_CURRENCY,
    metadata: { type: "casual", sessionDate: input.sessionDate, firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone },
    receiptEmail: input.email,
    description: `Casual session — ${input.sessionDate}`,
    idempotencyKey: `casual-${input.sessionDate}-${input.email}-${Date.now()}`,
  });
}
