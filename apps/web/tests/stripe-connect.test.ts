// Stripe Connect in test mode (Phase 6 Stage B, W1; build plan §6.5).
//
// A club's payments run on its own Stripe account, reached through the
// platform's key ("direct charges"). These tests prove the three rules:
//   1. the connected account is on EVERY request (it rides on the client);
//   2. the platform's fee is 0 unless set, and at 0 nothing about a fee is sent;
//   3. it is off unless configured, and never works with a live key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { subscriptionsOf, checkoutOf, PaymentError } from "@luvallplay/core/payments";
import { applicationFeeBps, connectSettings, connectedAccount, getPlatformStripe, getStripe } from "../lib/payments/stripe-client.ts";
import { stripeProvider } from "../lib/payments/stripe-provider.ts";

const TEST = { STRIPE_SECRET_KEY: "sk_test_connect" };
const account = (client: Stripe) => (client as unknown as { getApiField(name: string): unknown }).getApiField("stripeAccount");

test("off by default: without STRIPE_CONNECT_ACCOUNT the client is the key's own account, as before", () => {
  assert.equal(connectedAccount({}), null);
  assert.deepEqual(connectSettings({ STRIPE_CONNECT_FEE_BPS: "250" }), { account: null, feeBps: 0 }, "a fee means nothing without an account");
  assert.equal(account(getStripe(TEST)), null);
  assert.equal(getStripe(TEST), getStripe(TEST), "one client per key");
});

test("the connected account is on the client, so on every request", async () => {
  const client = getStripe({ ...TEST, STRIPE_CONNECT_ACCOUNT: "acct_1TestClub" });
  assert.equal(account(client), "acct_1TestClub");
  assert.notEqual(client, getStripe(TEST), "a club's client is never the platform's");
  assert.notEqual(client, getStripe({ ...TEST, STRIPE_CONNECT_ACCOUNT: "acct_2OtherClub" }), "nor another club's");
  assert.equal(account(getPlatformStripe({ ...TEST, STRIPE_CONNECT_ACCOUNT: "acct_1TestClub" })), null, "the platform's own client names no account");

  // The header itself, on a real request through the SDK (to a local stand-in, not Stripe).
  const seen: Record<string, string | undefined>[] = [];
  const http = Stripe.createFetchHttpClient(async (_url, init) => {
    seen.push(Object.fromEntries([...new Headers(init?.headers as HeadersInit)].map(([k, v]) => [k.toLowerCase(), v])));
    return new Response(JSON.stringify({ id: "pi_1", object: "payment_intent" }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } });
  });
  const onAccount = new Stripe("sk_test_connect", { stripeAccount: "acct_1TestClub", httpClient: http });
  await onAccount.paymentIntents.retrieve("pi_1");
  await onAccount.customers.list({ email: "a@example.test" });
  assert.deepEqual(seen.map((h) => h["stripe-account"]), ["acct_1TestClub", "acct_1TestClub"]);
});

test("test mode only: a connected account with a live key is refused, even on production", () => {
  for (const key of ["sk_live_x", "rk_live_x"]) {
    assert.throws(() => getStripe({ STRIPE_SECRET_KEY: key, STRIPE_CONNECT_ACCOUNT: "acct_1TestClub", VERCEL_ENV: "production" }), /test mode only/);
  }
  // A live key without Connect on production is today's Three Wolves: untouched.
  assert.equal(account(getStripe({ STRIPE_SECRET_KEY: "sk_live_x", VERCEL_ENV: "production" })), null);
  assert.throws(() => getStripe({ STRIPE_SECRET_KEY: "sk_live_x", VERCEL_ENV: "preview" }), /only used on the production deployment/);
});

test("settings that aren't what they should be stop the app instead of guessing", () => {
  for (const bad of ["acct", "cus_123456", "acct_", "acct_12 34", "https://dashboard.stripe.com/acct_123456"]) {
    assert.throws(() => connectedAccount({ STRIPE_CONNECT_ACCOUNT: bad }), /STRIPE_CONNECT_ACCOUNT/, bad);
  }
  for (const bad of ["-1", "2.5", "ten", "10001"]) assert.throws(() => applicationFeeBps({ STRIPE_CONNECT_FEE_BPS: bad }), /STRIPE_CONNECT_FEE_BPS/, bad);
  assert.equal(applicationFeeBps({}), 0);
  assert.equal(applicationFeeBps({ STRIPE_CONNECT_FEE_BPS: "0" }), 0);
  assert.equal(applicationFeeBps({ STRIPE_CONNECT_FEE_BPS: " 150 " }), 150);
});

/** A provider on a stand-in client that records what each create call was sent. */
function recording(connect: { account: string | null; feeBps: number }) {
  const sent: Record<string, Record<string, unknown>> = {};
  const client = {
    paymentIntents: { create: async (p: Record<string, unknown>) => ((sent.payment = p), { id: "pi_1", amount: p.amount, currency: "nzd", status: "requires_payment_method", metadata: {}, client_secret: "s" }), update: async () => ({}) },
    subscriptions: { create: async (p: Record<string, unknown>) => ((sent[p.trial_end ? "later" : "subscription"] = p), { id: "sub_1", latest_invoice: null }) },
    checkout: { sessions: { create: async (p: Record<string, unknown>) => ((sent.checkout = p), { id: "cs_1", url: "https://checkout.test" }) } },
  };
  const provider = stripeProvider(() => client as unknown as Stripe, () => "whsec", () => true, { connect: () => connect });
  return { provider, sent };
}

async function everyCharge(provider: ReturnType<typeof recording>["provider"]) {
  await provider.createPayment({ amount: 1000, currency: "NZD", description: "Casual session", metadata: {}, idempotencyKey: "k" });
  await subscriptionsOf(provider).start({ customerId: "cus_1", price: { priceId: "price_1" }, metadata: {}, receiptEmail: "a@example.test" });
  await subscriptionsOf(provider).startLater({ customerId: "cus_1", price: { priceId: "price_1" }, paymentMethodId: "pm_1", firstChargeAt: 1_800_000_000_000, metadata: {} });
  await checkoutOf(provider).create({ amount: 500, currency: "NZD", name: "Pass", description: "One match", email: "a@example.test", metadata: {}, successUrl: "https://a.test", cancelUrl: "https://a.test" });
}

test("the fee is 0% unless set: on a connected account, nothing about a fee is sent", async () => {
  for (const connect of [{ account: "acct_1TestClub", feeBps: 0 }, { account: null, feeBps: 0 }, { account: null, feeBps: 250 }]) {
    const { provider, sent } = recording(connect);
    await everyCharge(provider);
    for (const [name, params] of Object.entries(sent)) {
      assert.ok(!("application_fee_amount" in params) && !("application_fee_percent" in params) && !("payment_intent_data" in params), `${name} with ${JSON.stringify(connect)}`);
    }
    assert.deepEqual(Object.keys(sent).sort(), ["checkout", "later", "payment", "subscription"]);
  }
});

test("a fee, when one is set, is on every kind of charge, in whole minor units", async () => {
  const { provider, sent } = recording({ account: "acct_1TestClub", feeBps: 250 });
  await everyCharge(provider);
  assert.equal(sent.payment.application_fee_amount, 25);
  assert.equal(sent.subscription.application_fee_percent, 2.5);
  assert.equal(sent.later.application_fee_percent, 2.5);
  assert.deepEqual(sent.checkout.payment_intent_data, { application_fee_amount: 13 }, "2.5% of 500, rounded to a whole cent");
  // A fee that rounds to nothing isn't sent (Stripe refuses 0).
  const tiny = recording({ account: "acct_1TestClub", feeBps: 1 });
  await tiny.provider.createPayment({ amount: 10, currency: "NZD", description: "x", metadata: {}, idempotencyKey: "k" });
  assert.ok(!("application_fee_amount" in tiny.sent.payment));
});

test("webhooks: the account's own endpoint and the platform's Connect endpoint are both accepted, and the event says whose it is", async () => {
  const real = new Stripe("sk_test_connect");
  const provider = stripeProvider(() => real, () => "whsec_own", () => true, { connectWebhookSecret: () => "whsec_connect" });
  const signed = (secret: string, extra: Record<string, unknown>) => {
    const body = JSON.stringify({ id: "evt_1", object: "event", type: "payment_intent.succeeded", created: 1_795_000_000, data: { object: { id: "pi_1", amount: 1000, currency: "nzd", metadata: {} } }, ...extra });
    return { body, headers: { "stripe-signature": real.webhooks.generateTestHeaderString({ payload: body, secret }) } };
  };
  const own = await provider.verifyWebhook(signed("whsec_own", {}));
  assert.equal(own.account, undefined);
  const connected = await provider.verifyWebhook(signed("whsec_connect", { account: "acct_1TestClub" }));
  assert.equal(connected.account, "acct_1TestClub");
  assert.equal(connected.type, "payment.succeeded");
  await assert.rejects(provider.verifyWebhook(signed("whsec_someone_else", { account: "acct_1TestClub" })), (e: unknown) => e instanceof PaymentError && e.code === "bad_signature");
  // With no Connect secret set, only the account's own endpoint is accepted.
  const plain = stripeProvider(() => real, () => "whsec_own", () => true);
  await assert.rejects(plain.verifyWebhook(signed("whsec_connect", {})), (e: unknown) => e instanceof PaymentError && e.code === "bad_signature");
});

test("no call to Stripe can skip the account: the SDK client is made in one file, and nothing passes its own stripeAccount", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const makers: string[] = [];
  const perCall: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const src = fs.readFileSync(path.join(root, rel), "utf8");
        if (/new Stripe\(/.test(src)) makers.push(rel);
        if (/stripeAccount\s*:/.test(src) && rel !== "lib/payments/stripe-client.ts") perCall.push(rel);
      }
    }
  };
  for (const dir of ["app", "lib", "components"]) walk(dir);
  assert.deepEqual(makers, ["lib/payments/stripe-client.ts"]);
  assert.deepEqual(perCall, [], "the account rides on the client (lib/payments/stripe-client.ts), never on one call");
});
