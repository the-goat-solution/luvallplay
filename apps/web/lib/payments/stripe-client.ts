// The Stripe SDK client: the one place it is made (Phase 6 Stage B, W1).
// Everything that talks to Stripe gets its client here, so the key check
// (and, with Stripe Connect, the club's connected account) can't be skipped.
import Stripe from "stripe";
import { assertStripeKeyAllowed } from "../side-effects.ts";

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

/** For tests: use this client instead of one made from the key (null: from the key again). */
export function setStripeForTests(client: Stripe | null): void {
  stripe = client;
}
