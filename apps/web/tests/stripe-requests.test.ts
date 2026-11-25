// Three Wolves' card flows, pinned request by request (Phase 6 Stage B, W1).
//
// Every scenario runs the app's own entry point (a route's POST, or the
// function the profile and the players' app call) against a stand-in for
// Stripe's SDK that records each call. The recording is compared with
// tests/golden/stripe-requests.json, which was written from the code as it
// was BEFORE the card flows moved behind the payments interface
// (lib/payments). So this test proves the move changed nothing Stripe sees:
// the same calls, in the same order, with the same parameters, and the same
// answers to the browser.
//
// To record again after a deliberate change (ask the owner first: this is
// live payments): UPDATE_GOLDEN=1 npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";

process.env.STRIPE_SECRET_KEY = "sk_test_golden";
process.env.STRIPE_PRICE_MONTHLY = "price_fri_monthly";
process.env.STRIPE_PRICE_QUARTERLY = "price_fri_quarterly";
process.env.STRIPE_PRICE_WEDNESDAY_MONTHLY = "price_wed_monthly";
process.env.STRIPE_PRICE_WEDNESDAY_QUARTERLY = "price_wed_quarterly";
process.env.STRIPE_PRODUCT_DONATION = "prod_donation";
delete process.env.POSTGRES_URL;
delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;

const stripeLib = await import("../lib/stripe.ts");
const selfService = await import("../lib/membership-self-service.ts");
const { setPaymentsProvider } = await import("../lib/payments/index.ts");

type Call = { call: string; args: unknown[] };
type Responses = Record<string, unknown | ((...args: never[]) => unknown)>;

/** A stand-in for the Stripe SDK: records every call and answers from `responses`. */
function standIn(responses: Responses): { client: Stripe; calls: Call[] } {
  const calls: Call[] = [];
  const node = (parts: string[]): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then" || typeof prop === "symbol") return undefined;
        return node([...parts, prop]);
      },
      apply(_t, _this, args: unknown[]) {
        const call = parts.join(".");
        calls.push({ call, args });
        if (!(call in responses)) return Promise.reject(new Error(`stand-in: no answer for ${call}`));
        const r = responses[call];
        try {
          return Promise.resolve(typeof r === "function" ? (r as (...a: unknown[]) => unknown)(...args) : r);
        } catch (err) {
          return Promise.reject(err);
        }
      },
    });
  return { client: node([]) as Stripe, calls };
}

// Idempotency keys end with the time; everything else is fixed.
const stable = (v: unknown): unknown => JSON.parse(
  JSON.stringify(v ?? null)
    .replace(/-\d{13}"/g, '-<now>"')
    .replace(/"periodStart":"\d{4}-\d{2}-\d{2}"/g, '"periodStart":"<today>"'),
);

const recorded: Record<string, unknown> = {};

async function scenario(name: string, responses: Responses, run: () => Promise<unknown>) {
  const { client, calls } = standIn(responses);
  stripeLib.setStripeForTests(client);
  setPaymentsProvider(null);
  let outcome: unknown;
  try {
    const result = await run();
    outcome = { result: result instanceof Response ? { status: result.status, body: await result.json() } : result };
  } catch (err) {
    // Without a database the write after Stripe fails: the Stripe calls before it are what's pinned.
    outcome = { threw: err instanceof selfService.SelfServiceError ? `SelfServiceError:${err.code}` : "error" };
  } finally {
    stripeLib.setStripeForTests(null);
    setPaymentsProvider(null);
  }
  recorded[name] = stable({ calls, outcome });
}

const post = (body: unknown) => new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify(body) });

const who = { firstName: "Ana", lastName: "Ngata", email: "ana@example.test", phone: "+64211234567" };
const player = { id: 7, email: "ana@example.test", firstName: "Ana", lastName: "Ngata", phone: "+64211234567", lang: "en", stripeCustomerId: "cus_7" } as never;
const member = (over: Record<string, unknown> = {}) =>
  ({ id: 31, plan: "monthly", day: "friday", status: "active", periodStart: "2026-11-06", periodEnd: "2026-12-03", recurring: true, cancelAtPeriodEnd: false, method: "card", stripeSubscriptionId: "sub_31", continuation: null, ...over }) as never;

const invoiceWithPayment = { payments: { data: [{ payment: { payment_intent: { id: "pi_inv", client_secret: "pi_inv_secret" } } }] } };
const notFound = () => {
  throw new Stripe.errors.StripeInvalidRequestError({ message: "No such coupon", type: "invalid_request_error", statusCode: 404 } as never);
};
const NOW = Math.floor(Date.now() / 1000);
const sub = (over: Record<string, unknown> = {}) => ({
  id: "sub_31",
  status: "active",
  cancel_at_period_end: false,
  trial_end: null,
  schedule: null,
  metadata: { plan: "monthly", day: "friday", email: "ana@example.test" },
  default_payment_method: null,
  items: { data: [{ current_period_end: 1_796_000_000, price: { id: "price_fri_monthly", unit_amount: 6000 } }] },
  discounts: [],
  ...over,
});
const schedule = (over: Record<string, unknown> = {}) => ({
  id: "sub_sched_1",
  status: "active",
  phases: [{ start_date: NOW - 1000, end_date: NOW + 5000, items: [{ price: "price_fri_monthly", quantity: 1 }], trial_end: null, metadata: {} }],
  ...over,
});

test("Three Wolves' Stripe requests are the ones recorded before the payments interface", async () => {
  // ── lib/stripe.ts ────────────────────────────────────────────────────────
  await scenario("one-time membership: new customer", { "customers.list": { data: [] }, "customers.create": { id: "cus_new" }, "paymentIntents.create": { id: "pi_1", client_secret: "pi_1_secret", amount: 6000, currency: "nzd", status: "requires_payment_method", metadata: {} } }, async () => {
    const pi = await stripeLib.createOneTimeMembershipPaymentIntent({ plan: "monthly", day: "friday", ...who });
    return { id: pi.id, client_secret: pi.client_secret };
  });
  await scenario("one-time membership: renewal, known customer, no phone", { "customers.list": { data: [{ id: "cus_7" }] }, "paymentIntents.create": { id: "pi_2", client_secret: "pi_2_secret", amount: 15000, currency: "nzd", status: "requires_payment_method", metadata: {} } }, async () => {
    const pi = await stripeLib.createOneTimeMembershipPaymentIntent({ plan: "quarterly", day: "wednesday", ...who, phone: null, renewalOf: 31 });
    return { id: pi.id, client_secret: pi.client_secret };
  });
  const subscribe: Responses = { "customers.list": { data: [] }, "customers.create": { id: "cus_new" }, "subscriptions.create": { id: "sub_new", latest_invoice: "in_1" }, "invoices.retrieve": invoiceWithPayment, "paymentIntents.update": {} };
  await scenario("auto-renew membership (players' app)", subscribe, () => stripeLib.createMembershipSubscription({ plan: "quarterly", day: "wednesday", ...who }));
  await scenario("auto-renew membership: known customer, invoice as an object", { ...subscribe, "customers.list": { data: [{ id: "cus_7" }] }, "subscriptions.create": { id: "sub_new", latest_invoice: { id: "in_2" } } }, () => stripeLib.createMembershipSubscription({ plan: "monthly", day: "friday", ...who }));
  await scenario("auto-renew membership: no invoice", { ...subscribe, "subscriptions.create": { id: "sub_new", latest_invoice: null } }, () => stripeLib.createMembershipSubscription({ plan: "monthly", day: "friday", ...who }));
  await scenario("one-time membership: Stripe refuses", { "customers.list": { data: [{ id: "cus_7" }] }, "paymentIntents.create": () => { throw new Stripe.errors.StripeInvalidRequestError({ message: "Amount must be at least $0.50 nzd", type: "invalid_request_error", statusCode: 400 } as never); } }, () =>
    stripeLib.createOneTimeMembershipPaymentIntent({ plan: "monthly", day: "friday", ...who }).catch((e: Error) => e.message),
  );
  await scenario("Vision pass checkout", { "checkout.sessions.create": { id: "cs_1", url: "https://checkout.stripe.test/cs_1" } }, () =>
    stripeLib.createVisionCheckout({ kind: "live", amountCents: 500, name: "Live match pass", description: "One live match", email: who.email, passId: 12, playerId: 7, successUrl: "https://app.test/vision?paid=1", cancelUrl: "https://app.test/vision" }),
  );
  await scenario("Vision pass paid?", { "checkout.sessions.retrieve": { payment_status: "paid", metadata: { type: "wolf_vision" } } }, () => stripeLib.visionCheckoutPaid("cs_1"));
  await scenario("Vision pass not paid", { "checkout.sessions.retrieve": { payment_status: "unpaid", metadata: { type: "wolf_vision" } } }, () => stripeLib.visionCheckoutPaid("cs_1"));
  await scenario("admin: cancel at period end", { "subscriptions.update": { id: "sub_31", cancel_at_period_end: true } }, async () => (await stripeLib.cancelSubscriptionAtPeriodEnd("sub_31")).id);
  await scenario("admin: free month, first ever (coupon made)", { "subscriptions.retrieve": sub(), "coupons.retrieve": notFound, "coupons.create": {}, "subscriptions.update": {} }, () => stripeLib.giveFreeNextPeriod("sub_31"));
  await scenario("admin: free month, keeps another discount", { "subscriptions.retrieve": sub({ discounts: [{ id: "di_other", coupon: { id: "welcome" } }, "di_string"] }), "coupons.retrieve": {}, "subscriptions.update": {} }, () => stripeLib.giveFreeNextPeriod("sub_31"));
  await scenario("admin: free month already queued", { "subscriptions.retrieve": sub({ discounts: [{ id: "di_free", coupon: { id: stripeLib.FREE_PERIOD_COUPON_ID } }] }) }, () => stripeLib.giveFreeNextPeriod("sub_31"));
  await scenario("admin: free days (active)", { "subscriptions.retrieve": sub(), "subscriptions.update": {} }, () => stripeLib.addFreeDaysBeforeNextCharge("sub_31", 7));
  await scenario("admin: free days (already trialing)", { "subscriptions.retrieve": sub({ status: "trialing", trial_end: 1_796_500_000 }), "subscriptions.update": {} }, () => stripeLib.addFreeDaysBeforeNextCharge("sub_31", 14));
  await scenario("admin: free days refused when past due", { "subscriptions.retrieve": sub({ status: "past_due" }) }, () => stripeLib.addFreeDaysBeforeNextCharge("sub_31", 7).catch((e: Error) => e.message));

  // ── lib/membership-self-service.ts ───────────────────────────────────────
  const card = { id: "pm_1", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2029 } };
  const charges = { data: [{ status: "succeeded", created: 1_795_000_000, amount: 6000, description: "Subscription update", receipt_url: "https://pay.stripe.test/r1", refunded: false }, { status: "failed", created: 1_794_000_000, amount: 6000, description: null, receipt_url: null, refunded: false }, { status: "succeeded", created: 1_793_000_000, amount: 1000, description: null, receipt_url: null, refunded: true }] };
  await scenario("billing: card on the subscription, a change pending", {
    "customers.retrieve": { id: "cus_7", invoice_settings: { default_payment_method: null } },
    "charges.list": charges,
    "subscriptions.retrieve": sub({ default_payment_method: card, schedule: schedule({ phases: [{ start_date: NOW - 1000, end_date: NOW + 5000, metadata: {} }, { start_date: NOW + 5000, metadata: { plan: "quarterly", day: "wednesday" } }] }) }),
  }, async () => {
    const b = await selfService.getBilling(player, member());
    return { ...b, pendingChange: b.pendingChange ? { ...b.pendingChange, from: "<date>" } : null };
  });
  await scenario("billing: no subscription, first saved card", { "customers.retrieve": { id: "cus_7", invoice_settings: { default_payment_method: null } }, "charges.list": { data: [] }, "paymentMethods.list": { data: [card] } }, () => selfService.getBilling(player, member({ stripeSubscriptionId: null, recurring: false })));
  await scenario("billing: default card on the customer, cancelling", { "customers.retrieve": { id: "cus_7", invoice_settings: { default_payment_method: card } }, "charges.list": { data: [] }, "subscriptions.retrieve": sub({ cancel_at_period_end: true }) }, () => selfService.getBilling(player, member()));
  await scenario("billing: trialing, deleted customer, no card", { "customers.retrieve": { id: "cus_7", deleted: true }, "charges.list": { data: [] }, "subscriptions.retrieve": sub({ status: "trialing", trial_end: 1_796_500_000 }), "paymentMethods.list": { data: [] } }, () => selfService.getBilling(player, member()));
  await scenario("card update page", { "billingPortal.sessions.create": { url: "https://billing.stripe.test/p1" } }, () => selfService.cardUpdatePortalUrl(player, "https://app.test/membership?card=updated"));
  await scenario("customer: found by email (then saved)", { "customers.list": { data: [{ id: "cus_found" }] } }, () => selfService.stripeCustomerFor({ ...(player as object), stripeCustomerId: null } as never));
  await scenario("customer: created", { "customers.list": { data: [] }, "customers.create": { id: "cus_made" } }, () => selfService.stripeCustomerFor({ ...(player as object), stripeCustomerId: null } as never, true));
  await scenario("customer: none, not created", { "customers.list": { data: [] } }, () => selfService.stripeCustomerFor({ ...(player as object), stripeCustomerId: null } as never));
  await scenario("change plan at renewal: first change (schedule made)", { "subscriptions.retrieve": sub(), "subscriptionSchedules.create": { id: "sub_sched_1" }, "subscriptionSchedules.retrieve": schedule({ phases: [{ start_date: 1_795_000_000 - 1, end_date: 4_000_000_000, items: [{ price: { id: "price_fri_monthly" }, quantity: null }], trial_end: 1_795_100_000, metadata: {} }] }), "subscriptionSchedules.update": {} }, () => selfService.scheduleChangeAtRenewal(member(), "quarterly", "friday").then(() => "scheduled"));
  await scenario("change plan at renewal: replaces a pending change", { "subscriptions.retrieve": sub({ schedule: "sub_sched_1" }), "subscriptionSchedules.retrieve": schedule({ phases: [{ start_date: 1_700_000_000, end_date: 1_750_000_000, items: [{ price: "price_old", quantity: 1 }], metadata: {} }, { start_date: 1_750_000_000, end_date: 4_000_000_000, items: [{ price: "price_fri_monthly", quantity: 2 }], metadata: {} }] }), "subscriptionSchedules.update": {} }, () => selfService.scheduleChangeAtRenewal(member({ plan: "quarterly" }), "monthly", "friday").then(() => "scheduled"));
  await scenario("change plan at renewal: back to the current plan (pending change dropped)", { "subscriptions.retrieve": sub({ schedule: { id: "sub_sched_1" } }), "subscriptionSchedules.retrieve": schedule(), "subscriptionSchedules.release": {} }, () => selfService.scheduleChangeAtRenewal(member(), "monthly", "friday"));
  await scenario("change plan at renewal: refused while cancelling", { "subscriptions.retrieve": sub({ cancel_at_period_end: true }) }, () => selfService.scheduleChangeAtRenewal(member(), "quarterly", "friday"));
  await scenario("change plan at renewal: refused when not active", { "subscriptions.retrieve": sub({ status: "canceled" }) }, () => selfService.scheduleChangeAtRenewal(member(), "quarterly", "friday"));
  await scenario("change plan at renewal: refused for a one-time membership", {}, () => selfService.scheduleChangeAtRenewal(member({ recurring: false }), "quarterly", "friday"));
  await scenario("cancel a pending change: schedule already released", { "subscriptions.retrieve": sub({ schedule: "sub_sched_1" }), "subscriptionSchedules.retrieve": schedule({ status: "released" }) }, () => selfService.cancelPendingChange(member()));
  await scenario("cancel a pending change: none pending", { "subscriptions.retrieve": sub() }, () => selfService.cancelPendingChange(member()));
  await scenario("turn off auto-renew", { "subscriptions.retrieve": sub({ schedule: "sub_sched_1", status: "past_due" }), "subscriptionSchedules.retrieve": schedule({ status: "not_started" }), "subscriptionSchedules.release": {}, "subscriptions.update": {} }, () => selfService.cancelAtPeriodEnd(player, member(), "moving", null));
  await scenario("resume auto-renew", { "subscriptions.update": {} }, () => selfService.resumeMembership(member({ cancelAtPeriodEnd: true })));
  await scenario("resume: no subscription", {}, () => selfService.resumeMembership(member({ stripeSubscriptionId: null })));
  await scenario("one-time to auto-renew: save a card", { "setupIntents.create": { id: "seti_1", client_secret: "seti_1_secret" } }, () => selfService.createAutoRenewSetup(player));
  await scenario("one-time to auto-renew: no secret", { "setupIntents.create": { id: "seti_1", client_secret: null } }, () => selfService.createAutoRenewSetup(player));

  // ── The website's routes (no database: capacity checks are skipped) ───────
  const createSubscription = (await import("../app/api/create-subscription/route.ts")).POST;
  const createPaymentIntent = (await import("../app/api/create-payment-intent/route.ts")).POST;
  const createDonationIntent = (await import("../app/api/create-donation-intent/route.ts")).POST;
  const createDonationSubscription = (await import("../app/api/create-donation-subscription/route.ts")).POST;
  const join = { plan: "monthly", day: "friday", ...who };
  await scenario("website: join, auto-renew", subscribe, () => createSubscription(post(join)));
  await scenario("website: join, auto-renew, known customer, no phone", { ...subscribe, "customers.list": { data: [{ id: "cus_7" }] } }, () => createSubscription(post({ ...join, plan: "quarterly", phone: undefined })));
  await scenario("website: join, auto-renew, new customer, no phone", subscribe, () => createSubscription(post({ ...join, phone: undefined })));
  await scenario("website: join, one-time, new customer, no phone", { "customers.list": { data: [] }, "customers.create": { id: "cus_new" }, "paymentIntents.create": { id: "pi_1", client_secret: "pi_1_secret", amount: 6000, currency: "nzd", status: "requires_payment_method", metadata: {} } }, () => createSubscription(post({ ...join, phone: undefined, recurring: false })));
  await scenario("website: join, Stripe refuses", { ...subscribe, "subscriptions.create": () => { throw new Stripe.errors.StripeInvalidRequestError({ message: "No such price: 'price_fri_monthly'", type: "invalid_request_error", statusCode: 400 } as never); } }, () => createSubscription(post(join)));
  await scenario("website: join, auto-renew, invoice never ready", { ...subscribe, "subscriptions.create": { id: "sub_new", latest_invoice: null } }, () => createSubscription(post(join)));
  await scenario("website: join, one-time", { "customers.list": { data: [] }, "customers.create": { id: "cus_new" }, "paymentIntents.create": { id: "pi_1", client_secret: "pi_1_secret", amount: 6000, currency: "nzd", status: "requires_payment_method", metadata: {} } }, () => createSubscription(post({ ...join, recurring: false })));
  await scenario("website: join, one-time, no secret", { "customers.list": { data: [{ id: "cus_7" }] }, "paymentIntents.create": { id: "pi_1", client_secret: null, amount: 6000, currency: "nzd", status: "requires_payment_method", metadata: {} } }, () => createSubscription(post({ ...join, recurring: false })));
  await scenario("website: join, a paused day", {}, () => createSubscription(post({ ...join, day: "wednesday" })));
  await scenario("website: join, bad request", {}, () => createSubscription(post({ ...join, plan: "yearly" })));
  // Two days ahead is inside the booking window whatever day the test runs; the date is replaced in the recording.
  const playDate = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  await scenario("website: casual session", { "paymentIntents.create": { id: "pi_c", client_secret: "pi_c_secret", amount: 1000, currency: "nzd", status: "requires_payment_method", metadata: {} } }, () => createPaymentIntent(post({ sessionDate: playDate, ...who })));
  recorded["website: casual session"] = JSON.parse(JSON.stringify(recorded["website: casual session"]).replaceAll(playDate, "<date>"));
  await scenario("website: one-off donation", { "paymentIntents.create": { id: "pi_d", client_secret: "pi_d_secret", amount: 2500, currency: "nzd", status: "requires_payment_method", metadata: {} } }, () => createDonationIntent(post({ amount: 25, ...who })));
  await scenario("website: monthly donation", subscribe, () => createDonationSubscription(post({ amount: 12.5, ...who })));
  await scenario("website: monthly donation, new customer, no phone", subscribe, () => createDonationSubscription(post({ amount: 20, firstName: "Ana", lastName: "Ngata", email: who.email })));
  await scenario("website: monthly donation, too small", {}, () => createDonationSubscription(post({ amount: 0.5, ...who })));
  await scenario("website: one-off donation, Stripe refuses", { "paymentIntents.create": () => { throw new Stripe.errors.StripeCardError({ message: "Your card was declined.", type: "card_error", statusCode: 402 } as never); } }, () => createDonationIntent(post({ amount: 25, ...who })));
  await scenario("website: monthly donation, known customer, no phone", { ...subscribe, "customers.list": { data: [{ id: "cus_7" }] } }, () => createDonationSubscription(post({ amount: 20, firstName: "Ana", lastName: "Ngata", email: who.email })));

  const file = path.resolve(import.meta.dirname, "golden/stripe-requests.json");
  if (process.env.UPDATE_GOLDEN === "1") {
    fs.writeFileSync(file, `${JSON.stringify(recorded, null, 2)}\n`);
    return;
  }
  const golden = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(recorded).sort(), Object.keys(golden).sort(), "the scenarios recorded");
  for (const name of Object.keys(golden)) assert.deepEqual(recorded[name], golden[name], name);
});
