import Stripe from "stripe";
import { fetchPricingPlans } from "@/lib/sanity-queries";
import { combinePlanId } from "@/lib/pricing-plans";
import {
  MONTHLY_PRICE_CENTS,
  QUARTERLY_PRICE_CENTS,
  type MembershipDay,
  type MembershipTier,
} from "@/lib/constants";
import { assertStripeKeyAllowed } from "@/lib/side-effects.ts";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  // A live key is refused outside production; test keys work anywhere.
  assertStripeKeyAllowed(secret);
  if (!stripe) {
    stripe = new Stripe(secret);
  }
  return stripe;
}

/** Client secret for Payment Element — supports Basil (confirmation_secret) and legacy invoices. */
export function getSubscriptionPaymentClientSecret(
  subscription: Stripe.Subscription,
): string | null {
  const invoice = subscription.latest_invoice;
  if (!invoice || typeof invoice === "string") return null;

  const confirmation = invoice.confirmation_secret;
  if (confirmation && typeof confirmation === "object") {
    const secret = confirmation.client_secret;
    if (typeof secret === "string" && secret) return secret;
  }

  // Legacy API versions (pre-Basil) exposed payment_intent on invoices.
  const paymentIntent = (
    invoice as Stripe.Invoice & {
      payment_intent?: Stripe.PaymentIntent | string | null;
    }
  ).payment_intent;
  if (paymentIntent && typeof paymentIntent === "object") {
    const secret = paymentIntent.client_secret;
    if (typeof secret === "string" && secret) return secret;
  }

  return null;
}

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

export async function resolvePriceId(
  plan: MembershipTier,
  day: MembershipDay,
): Promise<string> {
  const envKey = PRICE_ENV_KEYS[day][plan];
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;

  const planId = combinePlanId(day, plan);
  const plans = await fetchPricingPlans();
  const fromCms = plans
    ?.find((p) => p.planId === planId)
    ?.stripePriceId?.trim();
  if (fromCms) return fromCms;

  throw new Error(`${envKey} is not configured`);
}

export function getDonationProductId(): string {
  const id = process.env.STRIPE_PRODUCT_DONATION;
  if (!id) throw new Error("STRIPE_PRODUCT_DONATION is not configured");
  return id;
}

// Cancels at the end of the current billing period rather than
// immediately, so a member keeps the access they already paid for.
export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
}

// The invoice's payment (and its PaymentIntent) attach a moment after the
// invoice itself is created, so an immediate retrieve can race and find
// `payments.data` still empty — poll briefly until it shows up.
export async function getInvoicePaymentIntent(
  stripeClient: Stripe,
  invoiceId: string,
): Promise<{ id: string; clientSecret: string } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const invoice = await stripeClient.invoices.retrieve(invoiceId, {
      expand: ["payments.data.payment.payment_intent"],
    });
    const paymentIntent = invoice.payments?.data[0]?.payment?.payment_intent;
    if (typeof paymentIntent === "object" && paymentIntent?.client_secret) {
      return { id: paymentIntent.id, clientSecret: paymentIntent.client_secret };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

// One shared 100%-off, single-use coupon for every "free month" an admin
// grants (competition prizes, goodwill). A fixed id means it's created once
// and found again on every later grant, rather than littering the Stripe
// dashboard with a fresh coupon per member.
export const FREE_PERIOD_COUPON_ID = "three-wolves-free-period";

async function ensureFreePeriodCoupon(stripeClient: Stripe): Promise<void> {
  try {
    await stripeClient.coupons.retrieve(FREE_PERIOD_COUPON_ID);
  } catch (e) {
    if (!(e instanceof Stripe.errors.StripeError) || e.statusCode !== 404) {
      throw e;
    }
    await stripeClient.coupons.create({
      id: FREE_PERIOD_COUPON_ID,
      name: "Free month (admin granted)",
      percent_off: 100,
      duration: "once",
    });
  }
}

// Makes the subscription's next renewal invoice $0 without cancelling or
// pausing it. Stripe still issues that invoice and marks it paid, so the
// webhook's renewal path (invoice.payment_succeeded → applyMembershipRenewal)
// extends the member's access exactly as a paid renewal would, and the
// subscription stays 'active' throughout — unlike pausing collection (voids
// the invoice, so access never advances) or a trial (flips status to
// 'trialing', dropping the member off the active roster).
export async function giveFreeNextPeriod(
  subscriptionId: string,
): Promise<{ alreadyQueued: boolean }> {
  const stripeClient = getStripe();
  const subscription = await stripeClient.subscriptions.retrieve(
    subscriptionId,
    { expand: ["discounts"] },
  );
  const existing = (subscription.discounts ?? []).filter(
    (d): d is Stripe.Discount => typeof d === "object" && d !== null,
  );
  // A "once" coupon is consumed by the next invoice, so one still attached
  // means a free month is already queued — a second would be swallowed by
  // that same invoice rather than give them another month.
  if (existing.some((d) => d.coupon?.id === FREE_PERIOD_COUPON_ID)) {
    return { alreadyQueued: true };
  }

  await ensureFreePeriodCoupon(stripeClient);
  await stripeClient.subscriptions.update(subscriptionId, {
    // Setting `discounts` replaces the whole list — carry any existing
    // discounts over so granting a free month doesn't strip another one.
    discounts: [
      ...existing.map((d) => ({ discount: d.id })),
      { coupon: FREE_PERIOD_COUPON_ID },
    ],
  });
  return { alreadyQueued: false };
}

// Adds `days` free at the end of a subscription's current period without
// changing what it costs afterwards — used for quarterly members, where a
// 100%-off "once" coupon (see giveFreeNextPeriod) would make a whole quarter
// free. Moving trial_end pushes the next charge out by `days`; Stripe shows
// the subscription as 'trialing' until then (the webhook still treats it as
// an active membership), and normal billing resumes on the new date. Repeat
// grants stack. Returns the date billing resumes (unix seconds).
export async function addFreeDaysBeforeNextCharge(
  subscriptionId: string,
  days: number,
): Promise<number> {
  const stripeClient = getStripe();
  const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
  if (subscription.status !== "active" && subscription.status !== "trialing") {
    throw new Error(`This subscription is ${subscription.status}, so it can't be extended.`);
  }
  const nextCharge =
    subscription.status === "trialing" && subscription.trial_end
      ? subscription.trial_end
      : subscription.items.data[0]?.current_period_end;
  if (!nextCharge) throw new Error("Couldn't find this subscription's next billing date.");

  const resumesAt = nextCharge + days * 86400;
  await stripeClient.subscriptions.update(subscriptionId, {
    trial_end: resumesAt,
    proration_behavior: "none",
  });
  return resumesAt;
}

const ONE_TIME_TIER_LABEL: Record<MembershipTier, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
};
const ONE_TIME_DAY_LABEL: Record<MembershipDay, string> = {
  friday: "Friday",
  wednesday: "Wednesday",
};

export function oneTimeMembershipPriceCents(plan: MembershipTier): number {
  return plan === "monthly" ? MONTHLY_PRICE_CENTS : QUARTERLY_PRICE_CENTS;
}

// A single (non-recurring) membership payment — used for new one-time
// signups and for renewing one. The webhook activates the matching
// membership row by this PaymentIntent's id once it succeeds.
export async function createOneTimeMembershipPaymentIntent(input: {
  plan: MembershipTier;
  day: MembershipDay;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  renewalOf?: number;
}): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  const customers = await stripe.customers.list({ email: input.email, limit: 1 });
  const customer =
    customers.data[0] ??
    (await stripe.customers.create({
      email: input.email,
      name: `${input.firstName} ${input.lastName}`,
      phone: input.phone ?? undefined,
      metadata: { plan: input.plan, day: input.day },
    }));

  const label = `${ONE_TIME_TIER_LABEL[input.plan]} Membership (${ONE_TIME_DAY_LABEL[input.day]})`;
  return stripe.paymentIntents.create(
    {
      amount: oneTimeMembershipPriceCents(input.plan),
      currency: "nzd",
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      receipt_email: input.email,
      description: `Three Wolves — ${label} — ${input.renewalOf ? "renewal" : "one-time"}`,
      metadata: {
        type: "membership",
        plan: input.plan,
        day: input.day,
        recurring: "false",
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone ?? "",
        ...(input.renewalOf
          ? { renewal: "true", renewalOf: String(input.renewalOf) }
          : {}),
      },
    },
    {
      idempotencyKey: `membership-onetime-${input.plan}-${input.email}-${Date.now()}`,
    },
  );
}
