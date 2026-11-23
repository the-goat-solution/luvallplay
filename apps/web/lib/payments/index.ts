// The payment provider this deployment uses (build plan §6.5; Phase 3 step 8).
//
// PAYMENTS_PROVIDER chooses it:
//
//   stripe  (default) Stripe, for New Zealand and Australia.
//
// Any other value throws: a club's money must never go to a provider nobody
// chose. MoMo and VietQR arrive with the Vietnam launch; each must pass the
// shared contract suite (tests/payments.test.ts → paymentContract).
//
// One-off payments (casual play, donations, shop orders, Vision passes) are
// created through this interface. Still on Stripe's own API until their
// module is touched, and listed in tests/payments.test.ts so a new direct use
// can't slip in: subscriptions and their self-service changes, offline
// (cash and bank) invoices, the ledger sync and the webhook's handlers.
import type { PaymentProvider } from "@luvallplay/core/payments";
import { getStripe } from "../stripe.ts";
import { stripeProvider } from "./stripe-provider.ts";

export * from "@luvallplay/core/payments";

let current: PaymentProvider | null = null;

export function payments(): PaymentProvider {
  if (current) return current;
  const v = process.env.PAYMENTS_PROVIDER?.trim().toLowerCase();
  if (v && v !== "stripe") throw new Error(`PAYMENTS_PROVIDER is "${process.env.PAYMENTS_PROVIDER}": expected "stripe".`);
  current = stripeProvider(getStripe, () => process.env.STRIPE_WEBHOOK_SECRET, () => Boolean(process.env.STRIPE_SECRET_KEY?.trim()));
  return current;
}

/** For tests: use this provider (or pass null to choose from the environment again). */
export function setPaymentsProvider(provider: PaymentProvider | null): void {
  current = provider;
}
