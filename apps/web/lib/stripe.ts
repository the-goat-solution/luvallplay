// Stripe's client, Three Wolves' price ids, and the club's card flows that
// aren't a plain one-off payment. Every call to Stripe from here goes through
// the payments interface (lib/payments → payments()). The SDK client the
// Stripe provider is built on is made in lib/payments/stripe-client.ts.
import { CLUB_CURRENCY } from "./constants";
import { checkoutOf, payments, subscriptionsOf } from "./payments";

export { getStripe, setStripeForTests } from "./payments/stripe-client";

// Prices, joining and renewing (one membership path for the website and the
// app) live in lib/payments/membership.ts; they keep their names here for the
// callers outside this lane.
export { createMembershipSubscription, createOneTimeMembershipPaymentIntent, oneTimeMembershipPriceCents, resolvePriceId } from "./payments/membership";

export function getDonationProductId(): string {
  const id = process.env.STRIPE_PRODUCT_DONATION;
  if (!id) throw new Error("STRIPE_PRODUCT_DONATION is not configured");
  return id;
}

// Cancels at the end of the current billing period rather than
// immediately, so a member keeps the access they already paid for.
export async function cancelSubscriptionAtPeriodEnd(subscriptionId: string): Promise<{ id: string }> {
  await subscriptionsOf(payments()).setCancelAtPeriodEnd(subscriptionId, true);
  return { id: subscriptionId };
}

export { FREE_PERIOD_COUPON_ID } from "./payments";

// Makes the subscription's next renewal invoice $0 without cancelling or
// pausing it (why that way: lib/payments/stripe-provider.ts → skipNextCharge).
export async function giveFreeNextPeriod(subscriptionId: string): Promise<{ alreadyQueued: boolean }> {
  return subscriptionsOf(payments()).skipNextCharge(subscriptionId);
}

// Adds `days` free at the end of a subscription's current period without
// changing what it costs afterwards — used for quarterly members, where a
// free renewal (giveFreeNextPeriod) would make a whole quarter free. Repeat
// grants stack. Returns the date billing resumes (unix seconds).
export async function addFreeDaysBeforeNextCharge(subscriptionId: string, days: number): Promise<number> {
  return (await subscriptionsOf(payments()).postponeNextCharge(subscriptionId, days)) / 1000;
}

/** A tracker pass's payment page (the players' app; the website's pass route has its own). */
export async function createVisionCheckout(input: {
  kind: "live" | "upload";
  amountCents: number;
  name: string;
  description: string;
  email: string;
  passId: number;
  playerId: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string | null }> {
  return checkoutOf(payments()).create({
    amount: input.amountCents,
    currency: CLUB_CURRENCY,
    name: input.name,
    description: input.description,
    email: input.email,
    metadata: { type: "wolf_vision", kind: input.kind, passId: String(input.passId), playerId: String(input.playerId) },
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
}

/** Whether a tracker pass's payment page was paid. */
export async function visionCheckoutPaid(sessionId: string): Promise<boolean> {
  const cs = await checkoutOf(payments()).get(sessionId);
  return cs.paid && cs.metadata.type === "wolf_vision";
}
