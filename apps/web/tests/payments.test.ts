// Phase 3 step 8: one Payments interface, several providers (build plan
// §6.5; test plan §3.16 "every provider passes one shared contract suite
// (create, refund, webhook verification, replay twice and out of order,
// reconcile, capability flags)").

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import {
  PaymentError,
  applyPaymentEvent,
  checkoutOf,
  customersOf,
  subscriptionsOf,
  initialPaymentState,
  requireCapability,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentProvider,
} from "@luvallplay/core/payments";
import { CARD_CAPABILITIES, QR_CAPABILITIES, fakeProvider } from "../lib/payments/fake-provider.ts";
import { stripeProvider } from "../lib/payments/stripe-provider.ts";
import { payments, setPaymentsProvider } from "../lib/payments/index.ts";

/** What a test needs from a provider's sandbox: make a payment succeed, and get the signed webhooks it would send. */
type Sandbox = {
  provider: PaymentProvider;
  pay(paymentId: string): Promise<{ body: string; headers: Record<string, string> }>;
  webhook(type: PaymentEventType, paymentId: string, extra?: { refunded?: number }): Promise<{ body: string; headers: Record<string, string> }>;
};

const rejects = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof PaymentError, `expected a PaymentError, got ${String(err)}`);
    assert.equal(err.code, code);
    return true;
  });

/** The suite every provider passes. A new provider (MoMo, VietQR) calls this with its own sandbox. */
export function paymentContract(name: string, make: () => Sandbox) {
  describe(`payments contract: ${name}`, () => {
    const currency = () => make().provider.capabilities.currencies[0];
    const input = (key: string, amount = 1000) => ({ amount, currency: currency(), description: "Casual session", metadata: { type: "casual", sessionDate: "2026-11-27" }, idempotencyKey: key });

    test("capability flags are all declared", () => {
      const { provider } = make();
      for (const k of ["clientConfirmation", "qr", "recurring", "refunds", "partialRefunds", "webhooks", "payoutStatus", "customers", "hostedCheckout"] as const) assert.equal(typeof provider.capabilities[k], "boolean", k);
      assert.ok(provider.capabilities.currencies.length > 0);
      assert.ok(provider.capabilities.clientConfirmation || provider.capabilities.qr, "a payer must have some way to pay");
      assert.ok(!provider.capabilities.partialRefunds || provider.capabilities.refunds);
      assert.equal(provider.configured(), true);
      provider.assertReady();
    });

    test("customers, subscriptions and the hosted page are there exactly when the capability says so", async () => {
      const { provider } = make();
      for (const [capability, part, of] of [["customers", provider.customers, customersOf], ["recurring", provider.subscriptions, subscriptionsOf], ["hostedCheckout", provider.checkout, checkoutOf]] as const) {
        assert.equal(Boolean(part), provider.capabilities[capability], capability);
        if (provider.capabilities[capability]) assert.equal(of(provider), part);
        else assert.throws(() => of(provider), (e: unknown) => e instanceof PaymentError && e.code === "unsupported", `${capability}: refused, not a missing property`);
      }
      // Subscriptions hang off a customer.
      assert.ok(!provider.capabilities.recurring || provider.capabilities.customers);
    });

    test("create: a pending payment in minor units, with what the payer needs to finish", async () => {
      const { provider } = make();
      const p = await provider.createPayment(input("k1"));
      assert.equal(p.status, "pending");
      assert.equal(p.amount, 1000);
      assert.equal(p.refunded, 0);
      assert.equal(p.currency, currency());
      assert.equal(p.provider, provider.id);
      assert.deepEqual(p.metadata, { type: "casual", sessionDate: "2026-11-27" });
      if (provider.capabilities.clientConfirmation) assert.ok(p.clientSecret);
      if (provider.capabilities.qr) assert.ok(p.qrPayload);
      assert.deepEqual({ ...(await provider.getPayment(p.id)), clientSecret: undefined, qrPayload: undefined }, { ...p, clientSecret: undefined, qrPayload: undefined });
    });

    test("create: the same idempotency key never makes a second payment", async () => {
      const { provider } = make();
      const a = await provider.createPayment(input("same"));
      const b = await provider.createPayment(input("same"));
      const c = await provider.createPayment(input("other"));
      assert.equal(a.id, b.id);
      assert.notEqual(a.id, c.id);
    });

    test("create: bad amounts and currencies the provider doesn't take are refused", async () => {
      const { provider } = make();
      await rejects(provider.createPayment(input("z", 0)), "bad_request");
      await rejects(provider.createPayment(input("z", -5)), "bad_request");
      await rejects(provider.createPayment(input("z", 10.5)), "bad_request");
      await rejects(provider.createPayment({ ...input("z"), currency: "XXX" }), "currency_not_supported");
      await rejects(provider.createPayment({ ...input(""), idempotencyKey: "" }), "bad_request");
      await rejects(provider.getPayment("no-such-payment"), "not_found");
    });

    test("refund: full, partial, never more than was paid, and idempotent", async (t) => {
      const sandbox = make();
      const { provider } = sandbox;
      if (!provider.capabilities.refunds) {
        const p = await provider.createPayment(input("r0"));
        await rejects(provider.refund({ paymentId: p.id, idempotencyKey: "r" }), "unsupported");
        t.diagnostic("no refunds through this provider");
        return;
      }
      const p = await provider.createPayment(input("r1"));
      await sandbox.pay(p.id);
      await rejects(provider.refund({ paymentId: p.id, amount: 1001, idempotencyKey: "too-much" }), "refund_exceeds_payment");
      await rejects(provider.refund({ paymentId: p.id, amount: 0, idempotencyKey: "zero" }), "bad_request");
      if (provider.capabilities.partialRefunds) {
        const part = await provider.refund({ paymentId: p.id, amount: 400, idempotencyKey: "part" });
        assert.equal(part.amount, 400);
        assert.equal(part.currency, currency());
        const again = await provider.refund({ paymentId: p.id, amount: 400, idempotencyKey: "part" });
        assert.equal(again.id, part.id, "the same key is the same refund");
        const after = await provider.getPayment(p.id);
        assert.equal(after.refunded, 400);
        assert.equal(after.status, "partially_refunded");
        await rejects(provider.refund({ paymentId: p.id, amount: 601, idempotencyKey: "over" }), "refund_exceeds_payment");
      }
      const rest = await provider.refund({ paymentId: p.id, idempotencyKey: "rest" });
      assert.equal(rest.amount, provider.capabilities.partialRefunds ? 600 : 1000);
      const done = await provider.getPayment(p.id);
      assert.equal(done.refunded, 1000);
      assert.equal(done.status, "refunded");
      // Nothing is left to refund.
      await rejects(provider.refund({ paymentId: p.id, idempotencyKey: "nothing-left" }), "bad_request");
      await rejects(provider.refund({ paymentId: p.id, amount: 1, idempotencyKey: "one-more" }), "refund_exceeds_payment");
    });

    test("webhooks: a real signature is accepted; a forged, altered or unsigned one is refused", async (t) => {
      const sandbox = make();
      const { provider } = sandbox;
      if (!provider.capabilities.webhooks) {
        await rejects(provider.verifyWebhook({ body: "{}", headers: {} }), "unsupported");
        t.diagnostic("this provider sends no webhooks");
        return;
      }
      const p = await provider.createPayment(input("w1"));
      const hook = await sandbox.pay(p.id);
      const event = await provider.verifyWebhook(hook);
      assert.equal(event.type, "payment.succeeded");
      assert.equal(event.paymentId, p.id);
      assert.equal(event.amount, 1000);
      assert.equal(event.currency, currency());
      assert.equal(event.provider, provider.id);
      assert.deepEqual(event.metadata, { type: "casual", sessionDate: "2026-11-27" });
      assert.ok(event.id);
      assert.ok(event.occurredAt > 0);
      // Altered body, same signature.
      await rejects(provider.verifyWebhook({ body: hook.body.replace("1000", "1"), headers: hook.headers }), "bad_signature");
      // No signature at all.
      await rejects(provider.verifyWebhook({ body: hook.body, headers: {} }), "bad_signature");
      // A signature that isn't ours.
      const forged = Object.fromEntries(Object.entries(hook.headers).map(([k, v]) => [k, v.replace(/[0-9a-f]{8}$/, "00000000")]));
      await rejects(provider.verifyWebhook({ body: hook.body, headers: forged }), "bad_signature");
    });

    test("webhooks: replayed twice and out of order, the result is the same", async (t) => {
      const sandbox = make();
      const { provider } = sandbox;
      if (!provider.capabilities.webhooks || !provider.capabilities.refunds) {
        t.diagnostic("needs webhooks and refunds");
        return;
      }
      const p = await provider.createPayment(input("o1"));
      const paid = await provider.verifyWebhook(await sandbox.pay(p.id));
      await provider.refund({ paymentId: p.id, idempotencyKey: "o1-refund" });
      const refunded = await provider.verifyWebhook(await sandbox.webhook("payment.refunded", p.id, { refunded: 1000 }));
      const fold = (events: PaymentEvent[]) => {
        const s = events.reduce(applyPaymentEvent, initialPaymentState(1000));
        return { status: s.status, refunded: s.refunded };
      };
      const want = { status: "refunded", refunded: 1000 };
      assert.deepEqual(fold([paid, refunded]), want, "in order");
      assert.deepEqual(fold([refunded, paid]), want, "out of order");
      assert.deepEqual(fold([paid, paid, refunded, refunded]), want, "each delivered twice");
      assert.deepEqual(fold([refunded, paid, refunded, paid]), want, "twice and out of order");
      assert.deepEqual(fold([paid]), { status: "succeeded", refunded: 0 });
    });

    test("reconcile: the payments that succeeded in a time range", async () => {
      const sandbox = make();
      const { provider } = sandbox;
      const a = await provider.createPayment(input("c1"));
      await provider.createPayment(input("c2")); // never paid
      await sandbox.pay(a.id);
      const now = Date.now();
      const listed = await provider.listSucceeded({ from: now - 3_600_000, to: now + 3_600_000 });
      assert.deepEqual(listed.map((x) => x.id), [a.id]);
      assert.equal(listed[0].amount, 1000);
      assert.deepEqual(await provider.listSucceeded({ from: now - 7_200_000, to: now - 3_600_000 }), []);
    });

    test("payout status, where the provider reports it", async (t) => {
      const { provider } = make();
      if (!provider.capabilities.payoutStatus) {
        await rejects(provider.payoutStatus(), "unsupported");
        t.diagnostic("this provider doesn't report payouts");
        return;
      }
      const s = await provider.payoutStatus();
      assert.equal(typeof s.available, "number");
      assert.equal(typeof s.pending, "number");
      assert.ok(provider.capabilities.currencies.includes(s.currency));
    });
  });
}

// ── Subscriptions, as every recurring provider must behave ──────────────────
// (Stripe's own requests for these are pinned in tests/stripe-requests.test.ts.)

test("subscriptions: start, change at renewal, stop and carry on, a free renewal, a later first charge", async () => {
  let clock = 1_800_000_000_000;
  const WEEK = 7 * 86_400_000;
  const provider = fakeProvider({ now: () => clock });
  const customers = customersOf(provider);
  const subscriptions = subscriptionsOf(provider);

  assert.equal(await customers.find("ana@example.test"), null);
  const customerId = await customers.create({ email: "Ana@example.test", name: "Ana Ngata" });
  assert.equal(await customers.find("ana@example.test"), customerId, "found again by email, whatever its case");

  const started = await subscriptions.start({ customerId, price: { priceId: "monthly" }, metadata: { plan: "monthly", day: "friday" }, receiptEmail: "ana@example.test" });
  assert.ok(started.clientSecret, "the first payment is confirmed in the browser");
  let sub = await subscriptions.get(started.subscriptionId);
  assert.deepEqual({ status: sub.status, cancel: sub.cancelAtPeriodEnd, next: sub.nextChargeAt, change: sub.changeRef }, { status: "active", cancel: false, next: clock + 4 * WEEK, change: null });

  // A change waits for the renewal, shows as pending, and can be replaced or dropped.
  const { startsAt } = await subscriptions.scheduleChange(sub, { price: { priceId: "quarterly" }, weeks: 12, metadata: { plan: "quarterly" } });
  assert.equal(startsAt, sub.nextChargeAt);
  sub = await subscriptions.get(sub.id, { billing: true });
  assert.ok(sub.changeRef);
  assert.deepEqual(sub.pendingChange, { startsAt, metadata: { plan: "quarterly" } });
  assert.equal(sub.metadata.plan, "monthly", "nothing changes before the renewal");
  await subscriptions.clearScheduledChange(sub);
  assert.equal((await subscriptions.get(sub.id, { billing: true })).pendingChange, null);
  await subscriptions.clearScheduledChange(await subscriptions.get(sub.id)); // none waiting: nothing happens
  await subscriptions.scheduleChange(await subscriptions.get(sub.id), { price: { priceId: "quarterly" }, weeks: 12, metadata: { plan: "quarterly" } });
  clock += 4 * WEEK;
  provider.advanceTo(clock);
  sub = await subscriptions.get(sub.id);
  assert.deepEqual({ plan: sub.metadata.plan, day: sub.metadata.day, next: sub.nextChargeAt, change: sub.changeRef }, { plan: "quarterly", day: "friday", next: clock + 12 * WEEK, change: null }, "the change began at the renewal and its metadata was added");

  // A free renewal is queued once.
  assert.deepEqual(await subscriptions.skipNextCharge(sub.id), { alreadyQueued: false });
  assert.deepEqual(await subscriptions.skipNextCharge(sub.id), { alreadyQueued: true });

  // Free days push the next charge out, and stack.
  const next = sub.nextChargeAt!;
  assert.equal(await subscriptions.postponeNextCharge(sub.id, 28), next + 28 * 86_400_000);
  assert.equal(await subscriptions.postponeNextCharge(sub.id, 7), next + 35 * 86_400_000);

  // Stopping keeps the paid period; carrying on undoes it; stopped for good at the period's end.
  await subscriptions.setCancelAtPeriodEnd(sub.id, true);
  assert.equal((await subscriptions.get(sub.id)).cancelAtPeriodEnd, true);
  await subscriptions.setCancelAtPeriodEnd(sub.id, false);
  assert.equal((await subscriptions.get(sub.id)).cancelAtPeriodEnd, false);
  await subscriptions.setCancelAtPeriodEnd(sub.id, true);
  provider.advanceTo(next + 36 * 86_400_000);
  sub = await subscriptions.get(sub.id);
  assert.deepEqual({ status: sub.status, next: sub.nextChargeAt }, { status: "canceled", next: null });
  await rejects(subscriptions.postponeNextCharge(sub.id, 7), "bad_request");
  await rejects(subscriptions.get("no-such-subscription"), "not_found");

  // A card saved now, first charged later.
  const setup = await customers.createCardSetup({ customerId, metadata: { type: "membership_autorenew" } });
  assert.ok(setup.clientSecret);
  const saved = await customers.getCardSetup(setup.id);
  assert.deepEqual({ ok: saved.succeeded, customer: saved.customerId }, { ok: true, customer: customerId });
  const later = await subscriptions.startLater({ customerId, price: { priceId: "monthly" }, paymentMethodId: saved.paymentMethodId!, firstChargeAt: clock + WEEK, metadata: {} });
  assert.deepEqual({ status: (await subscriptions.get(later.subscriptionId)).status, next: (await subscriptions.get(later.subscriptionId)).nextChargeAt }, { status: "trialing", next: clock + WEEK });
});

test("a hosted payment page: made unpaid, paid by the payer, and refused in a currency the provider doesn't take", async () => {
  const provider = fakeProvider();
  const checkout = checkoutOf(provider);
  const page = await checkout.create({ amount: 500, currency: "NZD", name: "Live match pass", description: "One match", email: "ana@example.test", metadata: { type: "wolf_vision" }, successUrl: "https://app.test/ok", cancelUrl: "https://app.test/back" });
  assert.ok(page.url);
  assert.deepEqual(await checkout.get(page.id), { paid: false, metadata: { type: "wolf_vision" } });
  provider.pay(page.id);
  assert.equal((await checkout.get(page.id)).paid, true);
  await rejects(checkout.create({ amount: 500, currency: "VND", name: "x", description: "x", email: "a@example.test", metadata: {}, successUrl: "https://app.test", cancelUrl: "https://app.test" }), "currency_not_supported");
});

test("a provider with no recurring charges: joining with auto-renew is refused before anything is reserved or charged", async () => {
  const qr = fakeProvider({ id: "vietqr", capabilities: QR_CAPABILITIES });
  setPaymentsProvider(qr);
  try {
    const { createMembershipSubscription } = await import("../lib/payments/membership.ts");
    await rejects(createMembershipSubscription({ plan: "monthly", day: "friday", firstName: "Ana", lastName: "Ngata", email: "ana@example.test", phone: null }), "unsupported");
    assert.equal(qr.payments.size, 0);
  } finally {
    setPaymentsProvider(null);
  }
});

// ── The providers ───────────────────────────────────────────────────────────

paymentContract("fake card provider", () => {
  const provider = fakeProvider();
  return { provider, pay: async (id) => provider.pay(id), webhook: async (type, id, extra) => provider.webhook(type, id, extra) };
});

paymentContract("fake QR provider (no cards, no recurring, no refunds, no webhooks)", () => {
  const provider = fakeProvider({ id: "fake-qr", capabilities: QR_CAPABILITIES });
  return {
    provider,
    pay: async (id) => {
      provider.payments.get(id)!.status = "succeeded";
      return { body: "", headers: {} };
    },
    webhook: async () => ({ body: "", headers: {} }),
  };
});

/** A stand-in for Stripe's API that keeps state, with Stripe's own webhook signing. */
function stripeSandbox(): Sandbox {
  const SECRET = "whsec_contract_test";
  const real = new Stripe("sk_test_contract");
  type PI = { id: string; amount: number; currency: string; status: string; metadata: Record<string, string>; client_secret: string; created: number; latest_charge: { amount_refunded: number } };
  const intents = new Map<string, PI>();
  const keys = new Map<string, string>();
  const refundKeys = new Map<string, { id: string; amount: number; currency: string; status: string }>();
  let n = 0;
  const missing = (id: string) => Object.assign(new Error(`No such payment_intent: '${id}'`), { code: "resource_missing", statusCode: 404 });
  const client = {
    paymentIntents: {
      create: async (params: { amount: number; currency: string; metadata: Record<string, string> }, opts: { idempotencyKey: string }) => {
        const seen = keys.get(opts.idempotencyKey);
        if (seen) return intents.get(seen)!;
        const id = `pi_${++n}`;
        const pi: PI = { id, amount: params.amount, currency: params.currency, status: "requires_payment_method", metadata: params.metadata, client_secret: `${id}_secret`, created: Math.floor(Date.now() / 1000), latest_charge: { amount_refunded: 0 } };
        intents.set(id, pi);
        keys.set(opts.idempotencyKey, id);
        return pi;
      },
      retrieve: async (id: string) => {
        const pi = intents.get(id);
        if (!pi) throw missing(id);
        return pi;
      },
      list: (params: { created: { gte: number; lt: number } }) => ({
        async *[Symbol.asyncIterator]() {
          for (const pi of intents.values()) if (pi.created >= params.created.gte && pi.created < params.created.lt) yield pi;
        },
      }),
    },
    refunds: {
      create: async (params: { payment_intent: string; amount: number }, opts: { idempotencyKey: string }) => {
        const seen = refundKeys.get(opts.idempotencyKey);
        if (seen) return seen;
        const pi = intents.get(params.payment_intent)!;
        pi.latest_charge.amount_refunded += params.amount;
        const r = { id: `re_${++n}`, amount: params.amount, currency: pi.currency, status: "succeeded" };
        refundKeys.set(opts.idempotencyKey, r);
        return r;
      },
    },
    balance: { retrieve: async () => ({ available: [{ amount: 5000, currency: "nzd" }], pending: [{ amount: 1000, currency: "nzd" }] }) },
    payouts: { list: async () => ({ data: [{ arrival_date: 1_795_000_000 }] }) },
    webhooks: real.webhooks,
  };
  const provider = stripeProvider(() => client as unknown as Stripe, () => SECRET, () => true);
  const signed = (type: string, object: Record<string, unknown>) => {
    const body = JSON.stringify({ id: `evt_${++n}`, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object } });
    return { body, headers: { "stripe-signature": real.webhooks.generateTestHeaderString({ payload: body, secret: SECRET }) } };
  };
  // A refund on an idempotent replay must not be applied twice by the stand-in.
  const refundOnce = provider.refund.bind(provider);
  const done = new Map<string, Awaited<ReturnType<typeof refundOnce>>>();
  provider.refund = async (input) => {
    const hit = done.get(input.idempotencyKey);
    if (hit) return hit;
    const r = await refundOnce(input);
    done.set(input.idempotencyKey, r);
    return r;
  };
  return {
    provider,
    pay: async (id) => {
      const pi = intents.get(id)!;
      pi.status = "succeeded";
      return signed("payment_intent.succeeded", { id, object: "payment_intent", amount: pi.amount, currency: pi.currency, metadata: pi.metadata });
    },
    webhook: async (type, id, extra) => {
      const pi = intents.get(id)!;
      if (type === "payment.refunded") return signed("charge.refunded", { id: `ch_${id}`, object: "charge", payment_intent: id, amount: pi.amount, amount_refunded: extra?.refunded ?? pi.amount, currency: pi.currency, metadata: pi.metadata });
      return signed("payment_intent.succeeded", { id, object: "payment_intent", amount: pi.amount, currency: pi.currency, metadata: pi.metadata });
    },
  };
}

paymentContract("Stripe (stand-in API, real webhook signatures)", stripeSandbox);

// ── Beyond the contract ─────────────────────────────────────────────────────

test("Stripe: the request is exactly what the routes used to send", async () => {
  const calls: unknown[][] = [];
  const client = { paymentIntents: { create: async (...args: unknown[]) => (calls.push(args), { id: "pi_1", amount: 1000, currency: "nzd", status: "requires_payment_method", metadata: {}, client_secret: "s" }) } };
  const provider = stripeProvider(() => client as unknown as Stripe, () => "whsec", () => true);
  await provider.createPayment({ amount: 1000, currency: "NZD", description: "Casual session — 2026-11-27", metadata: { type: "casual" }, idempotencyKey: "casual-1", receiptEmail: "player@example.test" });
  await provider.createPayment({ amount: 2500, currency: "NZD", description: "Shop", metadata: { type: "shop" }, idempotencyKey: "shop-order-9", receiptEmail: "player@example.test", customerId: "cus_1" });
  assert.deepEqual(calls, [
    [{ amount: 1000, currency: "nzd", automatic_payment_methods: { enabled: true }, metadata: { type: "casual" }, receipt_email: "player@example.test", description: "Casual session — 2026-11-27" }, { idempotencyKey: "casual-1" }],
    [{ amount: 2500, currency: "nzd", customer: "cus_1", automatic_payment_methods: { enabled: true }, metadata: { type: "shop" }, receipt_email: "player@example.test", description: "Shop" }, { idempotencyKey: "shop-order-9" }],
  ]);
});

test("Stripe: one-time to auto-renew is exactly what the profile used to send", async () => {
  // lib/membership-self-service.ts → confirmAutoRenewFromOneTime needs the
  // database, so its two Stripe calls are pinned here, written out from the
  // code as it was before the payments interface.
  const calls: { call: string; args: unknown[] }[] = [];
  const client = {
    setupIntents: { retrieve: async (...args: unknown[]) => (calls.push({ call: "setupIntents.retrieve", args }), { status: "succeeded", customer: { id: "cus_7" }, payment_method: "pm_1" }) },
    subscriptions: { create: async (...args: unknown[]) => (calls.push({ call: "subscriptions.create", args }), { id: "sub_later" }) },
  };
  const provider = stripeProvider(() => client as unknown as Stripe, () => "whsec", () => true);
  assert.deepEqual(await customersOf(provider).getCardSetup("seti_1"), { succeeded: true, customerId: "cus_7", paymentMethodId: "pm_1" });
  const metadata = { plan: "quarterly", day: "friday", firstName: "Ana", lastName: "Ngata", email: "ana@example.test", renewalOf: "31" };
  const started = await subscriptionsOf(provider).startLater({ customerId: "cus_7", price: { priceId: "price_fri_quarterly" }, paymentMethodId: "pm_1", firstChargeAt: 1_796_000_000_000, description: "Three Wolves — Quarterly Membership (Friday)", metadata });
  assert.deepEqual(started, { subscriptionId: "sub_later" });
  assert.deepEqual(calls, [
    { call: "setupIntents.retrieve", args: ["seti_1"] },
    {
      call: "subscriptions.create",
      args: [
        {
          customer: "cus_7",
          items: [{ price: "price_fri_quarterly" }],
          default_payment_method: "pm_1",
          trial_end: 1_796_000_000,
          trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
          description: "Three Wolves — Quarterly Membership (Friday)",
          metadata,
        },
      ],
    },
  ]);
  // A card that didn't save, or was saved without a customer.
  const unsaved = stripeProvider(() => ({ setupIntents: { retrieve: async () => ({ status: "requires_payment_method", customer: null, payment_method: null }) } }) as unknown as Stripe, () => "whsec", () => true);
  assert.deepEqual(await customersOf(unsaved).getCardSetup("seti_2"), { succeeded: false, customerId: null, paymentMethodId: null });
});

test("Stripe: provider events map onto the shared event types", async () => {
  const real = new Stripe("sk_test_contract");
  const provider = stripeProvider(() => real, () => "whsec_x", () => true);
  const send = (type: string, object: Record<string, unknown>) => {
    const body = JSON.stringify({ id: `evt_${type}`, object: "event", type, created: 1_795_000_000, data: { object } });
    return provider.verifyWebhook({ body, headers: { "stripe-signature": real.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_x" }) } });
  };
  const map: [string, PaymentEventType][] = [
    ["payment_intent.succeeded", "payment.succeeded"], ["payment_intent.payment_failed", "payment.failed"], ["payment_intent.canceled", "payment.canceled"],
    ["charge.refunded", "payment.refunded"], ["invoice.paid", "subscription.renewed"], ["invoice.payment_failed", "subscription.payment_failed"],
    ["customer.subscription.updated", "subscription.updated"], ["customer.subscription.deleted", "subscription.canceled"], ["customer.created", "other"],
  ];
  for (const [stripeType, type] of map) {
    const e = await send(stripeType, { id: "obj_1", amount: 1000, amount_refunded: 400, currency: "nzd", payment_intent: "pi_9", metadata: {} });
    assert.equal(e.type, type, stripeType);
    assert.equal(e.providerType, stripeType);
    assert.equal(e.occurredAt, 1_795_000_000_000);
    assert.equal((e.raw as { type: string }).type, stripeType, "handlers still get Stripe's own event");
  }
  const refund = await send("charge.refunded", { id: "ch_1", amount: 1000, amount_refunded: 400, currency: "nzd", payment_intent: "pi_9", metadata: {} });
  assert.deepEqual({ paymentId: refund.paymentId, refunded: refund.refunded, currency: refund.currency }, { paymentId: "pi_9", refunded: 400, currency: "NZD" });
  // No signing secret: refused before anything is parsed.
  await rejects(stripeProvider(() => real, () => undefined, () => true).verifyWebhook({ body: "{}", headers: { "stripe-signature": "x" } }), "not_configured");
});

test("events fold the same way in every order, and a status never goes backwards", () => {
  const ev = (id: string, type: PaymentEventType, occurredAt: number, refunded?: number) => ({ id, type, occurredAt, refunded });
  const all = [ev("e1", "payment.succeeded", 10), ev("e2", "payment.refunded", 20, 400), ev("e3", "payment.refunded", 30, 1000), ev("e4", "payment.failed", 5)];
  const permutations = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])));
  for (const order of permutations(all)) {
    const twice = order.flatMap((e) => [e, e]);
    const s = twice.reduce(applyPaymentEvent, initialPaymentState(1000));
    assert.deepEqual({ status: s.status, refunded: s.refunded, lastEventAt: s.lastEventAt, seen: s.seen.length }, { status: "refunded", refunded: 1000, lastEventAt: 30, seen: 4 }, order.map((e) => e.id).join(","));
  }
  // A partial refund alone; a refund larger than the payment is capped.
  assert.equal([ev("a", "payment.refunded", 1, 400)].reduce(applyPaymentEvent, initialPaymentState(1000)).status, "partially_refunded");
  assert.equal([ev("a", "payment.refunded", 1, 5000)].reduce(applyPaymentEvent, initialPaymentState(1000)).refunded, 1000);
  // A late "failed" doesn't undo a success.
  assert.equal([ev("a", "payment.succeeded", 2), ev("b", "payment.failed", 1)].reduce(applyPaymentEvent, initialPaymentState(1000)).status, "succeeded");
});

test("screens adapt to capabilities: recurring only where the provider can charge again", () => {
  requireCapability(fakeProvider({ capabilities: CARD_CAPABILITIES }), "recurring");
  assert.throws(() => requireCapability(fakeProvider({ id: "vietqr", capabilities: QR_CAPABILITIES }), "recurring"), (e: unknown) => e instanceof PaymentError && e.code === "unsupported");
  assert.throws(() => requireCapability(fakeProvider({ id: "vietqr", capabilities: QR_CAPABILITIES }), "refunds"));
});

test("the provider is chosen by PAYMENTS_PROVIDER, and an unknown one stops", () => {
  const was = process.env.PAYMENTS_PROVIDER;
  try {
    setPaymentsProvider(null);
    delete process.env.PAYMENTS_PROVIDER;
    assert.equal(payments().id, "stripe");
    setPaymentsProvider(null);
    process.env.PAYMENTS_PROVIDER = "momo";
    assert.throws(() => payments(), /PAYMENTS_PROVIDER/);
    const fake = fakeProvider();
    setPaymentsProvider(fake);
    assert.equal(payments(), fake);
  } finally {
    if (was === undefined) delete process.env.PAYMENTS_PROVIDER;
    else process.env.PAYMENTS_PROVIDER = was;
    setPaymentsProvider(null);
  }
});

test("only the listed files talk to Stripe directly", () => {
  const root = path.resolve(import.meta.dirname, "..");
  // One-off payments, memberships, monthly donations, Vision passes and the
  // webhook's signature check use the interface. These still use Stripe's own
  // API (why: lib/payments/index.ts). The list only shrinks: a file moves
  // onto the interface, and comes off it.
  const ALLOWED = new Set([
    // Other lanes' files, moving in small "[lane W]" pull requests:
    "app/admin/(console)/players/page.tsx",
    "app/admin/(console)/shop/page.tsx",
    "app/api/admin/retry-payment/route.ts",
    "app/api/profile/shop/order/[id]/confirm/route.ts",
    "app/api/stripe-webhook/route.ts",
    "app/api/wolf-vision/pass/route.ts",
    "lib/finance-stripe.ts",
    "lib/membership-status.ts",
    "lib/offline-payment-stripe.ts",
    "lib/setup-check.ts",
    "lib/stripe-sync.ts",
    // The provider itself, and the one place the SDK client is made:
    "lib/payments/stripe-client.ts",
    "lib/payments/stripe-provider.ts",
  ]);
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name) && /getStripe\(|from "stripe"/.test(fs.readFileSync(path.join(root, rel), "utf8"))) found.push(rel);
    }
  };
  for (const dir of ["app", "lib", "components"]) walk(dir);
  assert.deepEqual(found.filter((f) => !ALLOWED.has(f)), [], "a new direct use of Stripe: use payments() from lib/payments");
  assert.deepEqual([...ALLOWED].filter((f) => !found.includes(f)), [], "no longer uses Stripe directly: remove it from the list");
});
