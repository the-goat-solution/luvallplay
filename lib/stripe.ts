import Stripe from "stripe";
import { fetchPricingPlans } from "@/lib/sanity-queries";
import { combinePlanId } from "@/lib/pricing-plans";
import type { MembershipDay, MembershipTier } from "@/lib/constants";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
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
