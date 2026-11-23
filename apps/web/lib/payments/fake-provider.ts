// An in-memory payment provider, for tests (Phase 3 step 8). It keeps real
// state, signs its webhooks with HMAC-SHA256, and its capabilities can be
// set, so one fake stands in for "a card provider" and for "a QR provider
// with no recurring charges" (VietQR, §6.5).
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PaymentError,
  assertValidPayment,
  type CreatePaymentInput,
  type Payment,
  type PaymentCapabilities,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentProvider,
  type Refund,
} from "@luvallplay/core/payments";

export const CARD_CAPABILITIES: PaymentCapabilities = {
  clientConfirmation: true, qr: false, recurring: true, refunds: true, partialRefunds: true, webhooks: true, payoutStatus: true, currencies: ["NZD", "AUD"],
};
/** A bank-transfer QR provider: no cards, no recurring charges, no refunds through the provider. */
export const QR_CAPABILITIES: PaymentCapabilities = {
  clientConfirmation: false, qr: true, recurring: false, refunds: false, partialRefunds: false, webhooks: false, payoutStatus: false, currencies: ["VND"],
};

export type FakeProvider = PaymentProvider & {
  /** What the payer did: marks the payment succeeded and returns the signed webhook the provider would send. */
  pay(paymentId: string): { body: string; headers: Record<string, string> };
  /** The signed webhook for any event (to replay, reorder, or forge). */
  webhook(type: PaymentEventType, paymentId: string, extra?: { refunded?: number; eventId?: string; occurredAt?: number }): { body: string; headers: Record<string, string> };
  payments: Map<string, Payment>;
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

  const provider: FakeProvider = {
    id,
    capabilities,
    payments,
    configured: () => true,

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
      const p = get(paymentId);
      if (p.status === "pending" || p.status === "processing") p.status = "succeeded";
      return provider.webhook("payment.succeeded", paymentId);
    },
  };
  return provider;
}
