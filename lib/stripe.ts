import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

export function getPriceId(plan: "monthly" | "quarterly"): string {
  const key =
    plan === "monthly"
      ? "STRIPE_PRICE_MONTHLY"
      : "STRIPE_PRICE_QUARTERLY";
  const id = process.env[key];
  if (!id) throw new Error(`${key} is not configured`);
  return id;
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
