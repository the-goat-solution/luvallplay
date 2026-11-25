// An in-memory payment provider, for tests (Phase 3 step 8). It keeps real
// state, signs its webhooks with HMAC-SHA256, and its capabilities can be
// set, so one fake stands in for "a card provider" and for "a QR provider
// with no recurring charges" (VietQR, §6.5).
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PaymentError,
  assertValidPayment,
  type Checkout,
  type CreatePaymentInput,
  type Customers,
  type Payment,
  type PaymentCapabilities,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentProvider,
  type Refund,
  type Subscription,
  type Subscriptions,
} from "@luvallplay/core/payments";

export const CARD_CAPABILITIES: PaymentCapabilities = {
  clientConfirmation: true, qr: false, recurring: true, refunds: true, partialRefunds: true, webhooks: true, payoutStatus: true, customers: true, hostedCheckout: true, currencies: ["NZD", "AUD"],
};
/** A bank-transfer QR provider: no cards, no recurring charges, no refunds through the provider. */
export const QR_CAPABILITIES: PaymentCapabilities = {
  clientConfirmation: false, qr: true, recurring: false, refunds: false, partialRefunds: false, webhooks: false, payoutStatus: false, customers: false, hostedCheckout: false, currencies: ["VND"],
};

export type FakeProvider = PaymentProvider & {
  /** What the payer did: marks the payment succeeded and returns the signed webhook the provider would send. */
  pay(paymentId: string): { body: string; headers: Record<string, string> };
  /** The signed webhook for any event (to replay, reorder, or forge). */
  webhook(type: PaymentEventType, paymentId: string, extra?: { refunded?: number; eventId?: string; occurredAt?: number }): { body: string; headers: Record<string, string> };
  payments: Map<string, Payment>;
  /** Time passes: every subscription whose next charge is due is charged (or ends, when it was set to stop). */
  advanceTo(at: number): void;
};

export function fakeProvider(options: { id?: string; capabilities?: PaymentCapabilities; secret?: string; now?: () => number } = {}): FakeProvider {
  const id = options.id ?? "fake";
  const capabilities = options.capabilities ?? CARD_CAPABILITIES;
  const secret = options.secret ?? "whsec_fake";
  const now = options.now ?? Date.now;
  const payments = new Map<string, Payment>();
  const byKey = new Map<string, string>();
  const refunds = new Map<string, Refund>();
  const createdAt = new Map<string, number>();
  let n = 0;
  const sign = (body: string) => createHmac("sha256", secret).update(body).digest("hex");

  const get = (paymentId: string): Payment => {
    const p = payments.get(paymentId);
    if (!p) throw new PaymentError("not_found", `No payment ${paymentId}`);
    return p;
  };

  // ── Customers, subscriptions and a hosted page, when the capabilities say so ──
  const WEEK = 7 * 86_400_000;
  const customerByEmail = new Map<string, string>();
  const setups = new Map<string, { customerId: string; succeeded: boolean }>();
  type Sub = Subscription & { weeks: number; price: string; change: { price: string; weeks: number; metadata: Record<string, string> } | null; freeNext: boolean };
  const subs = new Map<string, Sub>();
  const pages = new Map<string, { paid: boolean; metadata: Record<string, string> }>();
  const sub = (subId: string): Sub => {
    const s = subs.get(subId);
    if (!s) throw new PaymentError("not_found", `No subscription ${subId}`);
    return s;
  };
  const view = (s: Sub, billing?: boolean): Subscription => ({
    id: s.id,
    status: s.status,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    nextChargeAt: s.nextChargeAt,
    amount: s.amount,
    metadata: { ...s.metadata },
    changeRef: s.change ? `${s.id}_change` : null,
    ...(billing ? { paymentMethod: { card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 } }, pendingChange: s.change && s.nextChargeAt ? { startsAt: s.nextChargeAt, metadata: { ...s.change.metadata } } : null } : {}),
  });
  const priceRef = (price: { priceId: string } | { amount: number }) => ("priceId" in price ? price.priceId : `amount_${price.amount}`);

  const customers: Customers = {
    async find(email) {
      return customerByEmail.get(email.toLowerCase()) ?? null;
    },
    async create(input) {
      const customerId = `${id}_cus_${++n}`;
      customerByEmail.set(input.email.toLowerCase(), customerId);
      return customerId;
    },
    async billing() {
      return { paymentMethod: null, receipts: [] };
    },
    async savedCard() {
      return null;
    },
    async cardUpdateUrl({ customerId, returnUrl }) {
      return `https://pay.example.test/${customerId}/card?back=${encodeURIComponent(returnUrl)}`;
    },
    async createCardSetup({ customerId }) {
      const setupId = `${id}_setup_${++n}`;
      setups.set(setupId, { customerId, succeeded: true });
      return { id: setupId, clientSecret: `${setupId}_secret` };
    },
    async getCardSetup(setupId) {
      const s = setups.get(setupId);
      if (!s) throw new PaymentError("not_found", `No card setup ${setupId}`);
      return { succeeded: s.succeeded, customerId: s.customerId, paymentMethodId: `${setupId}_pm` };
    },
  };

  const subscriptions: Subscriptions = {
    async start(input) {
      const subId = `${id}_sub_${++n}`;
      subs.set(subId, { id: subId, status: "active", cancelAtPeriodEnd: false, nextChargeAt: now() + 4 * WEEK, amount: "amount" in input.price ? input.price.amount : null, metadata: { ...input.metadata }, changeRef: null, weeks: 4, price: priceRef(input.price), change: null, freeNext: false });
      return { subscriptionId: subId, clientSecret: `${subId}_secret` };
    },
    async startLater(input) {
      const subId = `${id}_sub_${++n}`;
      subs.set(subId, { id: subId, status: "trialing", cancelAtPeriodEnd: false, nextChargeAt: input.firstChargeAt, amount: null, metadata: { ...input.metadata }, changeRef: null, weeks: 4, price: priceRef(input.price), change: null, freeNext: false });
      return { subscriptionId: subId };
    },
    async get(subId, opts) {
      return view(sub(subId), opts?.billing);
    },
    async setCancelAtPeriodEnd(subId, cancel) {
      sub(subId).cancelAtPeriodEnd = cancel;
    },
    async scheduleChange(subscription, change) {
      const s = sub(subscription.id);
      s.change = { price: change.price.priceId, weeks: change.weeks, metadata: { ...change.metadata } };
      return { startsAt: s.nextChargeAt ?? now() };
    },
    async clearScheduledChange(subscription) {
      sub(subscription.id).change = null;
    },
    async skipNextCharge(subId) {
      const s = sub(subId);
      if (s.freeNext) return { alreadyQueued: true };
      s.freeNext = true;
      return { alreadyQueued: false };
    },
    async postponeNextCharge(subId, days) {
      const s = sub(subId);
      if (s.status !== "active" && s.status !== "trialing") throw new PaymentError("bad_request", `This subscription is ${s.status}, so it can't be extended.`);
      s.nextChargeAt = (s.nextChargeAt ?? now()) + days * 86_400_000;
      s.status = "trialing";
      return s.nextChargeAt;
    },
  };

  const checkout: Checkout = {
    async create(input) {
      assertValidPayment(provider, { amount: input.amount, currency: input.currency, description: input.description, metadata: input.metadata, idempotencyKey: "checkout" });
      const pageId = `${id}_page_${++n}`;
      pages.set(pageId, { paid: false, metadata: { ...input.metadata } });
      return { id: pageId, url: `https://pay.example.test/${pageId}` };
    },
    async get(pageId) {
      const page = pages.get(pageId);
      if (!page) throw new PaymentError("not_found", `No payment page ${pageId}`);
      return { ...page };
    },
  };

  const provider: FakeProvider = {
    id,
    capabilities,
    payments,
    configured: () => true,
    assertReady: () => {},
    ...(capabilities.customers ? { customers } : {}),
    ...(capabilities.recurring ? { subscriptions } : {}),
    ...(capabilities.hostedCheckout ? { checkout } : {}),

    advanceTo(at) {
      for (const s of subs.values()) {
        while (s.status !== "canceled" && s.nextChargeAt !== null && s.nextChargeAt <= at) {
          if (s.cancelAtPeriodEnd) {
            s.status = "canceled";
            s.nextChargeAt = null;
            break;
          }
          if (s.change) {
            s.price = s.change.price;
            s.weeks = s.change.weeks;
            s.metadata = { ...s.metadata, ...s.change.metadata };
            s.change = null;
          }
          s.freeNext = false;
          s.status = "active";
          s.nextChargeAt += s.weeks * WEEK;
        }
      }
    },

    async createPayment(input: CreatePaymentInput): Promise<Payment> {
      assertValidPayment(provider, input);
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return { ...get(existing) };
      const paymentId = `${id}_pay_${++n}`;
      const payment: Payment = {
        id: paymentId,
        provider: id,
        status: "pending",
        amount: input.amount,
        refunded: 0,
        currency: input.currency.toUpperCase(),
        metadata: { ...input.metadata },
        ...(capabilities.clientConfirmation ? { clientSecret: `${paymentId}_secret` } : {}),
        ...(capabilities.qr ? { qrPayload: `QR|${input.currency.toUpperCase()}|${input.amount}|${paymentId}` } : {}),
      };
      payments.set(paymentId, payment);
      byKey.set(input.idempotencyKey, paymentId);
      createdAt.set(paymentId, now());
      return { ...payment };
    },

    async getPayment(paymentId) {
      return { ...get(paymentId) };
    },

    async refund(input) {
      if (!capabilities.refunds) throw new PaymentError("unsupported", `${id} doesn't support refunds`);
      const done = refunds.get(input.idempotencyKey);
      if (done) return { ...done };
      const p = get(input.paymentId);
      if (p.status !== "succeeded" && p.status !== "partially_refunded" && p.status !== "refunded") throw new PaymentError("bad_request", "Only a paid payment can be refunded");
      const left = p.amount - p.refunded;
      const amount = input.amount ?? left;
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new PaymentError("bad_request", "The refund must be a positive whole number of minor units");
      if (amount > left) throw new PaymentError("refund_exceeds_payment", "The refund is more than what's left of the payment");
      if (amount < left && !capabilities.partialRefunds) throw new PaymentError("unsupported", `${id} doesn't support partial refunds`);
      p.refunded += amount;
      p.status = p.refunded >= p.amount ? "refunded" : "partially_refunded";
      const refund: Refund = { id: `${id}_re_${++n}`, paymentId: p.id, amount, currency: p.currency, status: "succeeded" };
      refunds.set(input.idempotencyKey, refund);
      return { ...refund };
    },

    async verifyWebhook(request) {
      if (!capabilities.webhooks) throw new PaymentError("unsupported", `${id} doesn't send webhooks`);
      const given = request.headers["x-fake-signature"];
      if (!given) throw new PaymentError("bad_signature", "Missing signature");
      const want = Buffer.from(sign(request.body));
      const got = Buffer.from(given);
      if (want.length !== got.length || !timingSafeEqual(want, got)) throw new PaymentError("bad_signature", "Invalid signature");
      const e = JSON.parse(request.body) as PaymentEvent;
      return { ...e, provider: id, raw: e };
    },

    async listSucceeded(range) {
      return [...payments.values()]
        .filter((p) => p.status === "succeeded" || p.status === "partially_refunded" || p.status === "refunded")
        .filter((p) => {
          const at = createdAt.get(p.id) ?? 0;
          return at >= range.from && at < range.to;
        })
        .map((p) => ({ ...p }));
    },

    async payoutStatus() {
      if (!capabilities.payoutStatus) throw new PaymentError("unsupported", `${id} doesn't report payouts`);
      const paid = [...payments.values()].reduce((t, p) => t + (p.status === "pending" ? 0 : p.amount - p.refunded), 0);
      return { available: paid, pending: 0, currency: capabilities.currencies[0], lastPayoutAt: null };
    },

    webhook(type, paymentId, extra = {}) {
      const p = get(paymentId);
      const event: Omit<PaymentEvent, "raw"> = {
        id: extra.eventId ?? `${id}_evt_${++n}`,
        provider: id,
        type,
        providerType: type,
        paymentId,
        amount: p.amount,
        ...(extra.refunded !== undefined ? { refunded: extra.refunded } : {}),
        currency: p.currency,
        metadata: p.metadata,
        occurredAt: extra.occurredAt ?? now(),
      };
      const body = JSON.stringify(event);
      return { body, headers: { "x-fake-signature": sign(body) } };
    },

    pay(paymentId) {
      // A hosted page is paid by its own id.
      const page = pages.get(paymentId);
      if (page) {
        page.paid = true;
        return { body: "", headers: {} };
      }
      const p = get(paymentId);
      if (p.status === "pending" || p.status === "processing") p.status = "succeeded";
      return provider.webhook("payment.succeeded", paymentId);
    },
  };
  return provider;
}
