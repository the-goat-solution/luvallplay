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
// One-off payments (casual play, donations, shop orders), memberships and
// their self-service changes, monthly donations and Vision passes all go
// through this interface (Phase 6 Stage B, W1; membership.ts is the one
// membership path for the website and the app). Still on Stripe's own API,
// and listed in tests/payments.test.ts so a new direct use can't slip in:
// offline (cash and bank) invoices, the ledger sync, the webhook's handlers,
// and four admin and profile files owned by other lanes.
import type { PaymentProvider } from "@luvallplay/core/payments";
import { connectSettings, getStripe } from "./stripe-client.ts";
import { stripeProvider } from "./stripe-provider.ts";
import { meteredPayments } from "../usage-hooks.ts";

export * from "@luvallplay/core/payments";

// One shared 100%-off, single-use coupon for every "free month" an admin
// grants (competition prizes, goodwill). Three Wolves' id, already in its
// Stripe account; a fixed id means it's made once and found again.
export const FREE_PERIOD_COUPON_ID = "three-wolves-free-period";

let current: PaymentProvider | null = null;

export function payments(): PaymentProvider {
  if (current) return current;
  const v = process.env.PAYMENTS_PROVIDER?.trim().toLowerCase();
  if (v && v !== "stripe") throw new Error(`PAYMENTS_PROVIDER is "${process.env.PAYMENTS_PROVIDER}": expected "stripe".`);
  // Each payment started is counted for the club (lib/usage-hooks.ts).
  current = meteredPayments(
    stripeProvider(getStripe, () => process.env.STRIPE_WEBHOOK_SECRET, () => Boolean(process.env.STRIPE_SECRET_KEY?.trim()), {
      freePeriodCouponId: FREE_PERIOD_COUPON_ID,
      portalConfigurationId: () => process.env.STRIPE_PORTAL_CONFIGURATION_ID,
      // Stripe Connect, test mode (off unless STRIPE_CONNECT_ACCOUNT is set).
      connect: () => connectSettings(),
      connectWebhookSecret: () => process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    }),
  );
  return current;
}

/** For tests: use this provider (or pass null to choose from the environment again). */
export function setPaymentsProvider(provider: PaymentProvider | null): void {
  current = provider;
}
