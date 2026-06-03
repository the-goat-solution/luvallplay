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
