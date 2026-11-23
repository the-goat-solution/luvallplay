// Stripe behind the Payments interface (build plan §6.5; Phase 3 step 8).
// The first provider. It passes the shared contract suite
// (tests/payments.test.ts) against a stand-in for Stripe's API, with real
// webhook signatures.
import type Stripe from "stripe";
import {
  PaymentError,
  assertValidPayment,
  type CreatePaymentInput,
  type Payment,
  type PaymentCapabilities,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentProvider,
  type PaymentStatus,
  type PayoutStatus,
  type Refund,
  type RefundInput,
} from "@luvallplay/core/payments";

const CAPABILITIES: PaymentCapabilities = {
  clientConfirmation: true,
  qr: false,
  recurring: true,
  refunds: true,
  partialRefunds: true,
  webhooks: true,
  payoutStatus: true,
  // Where Luvallplay uses Stripe (§6.5): New Zealand and Australia.
  currencies: ["NZD", "AUD"],
};

function statusOf(pi: Stripe.PaymentIntent, refunded: number): PaymentStatus {
  if (refunded > 0) return refunded >= pi.amount ? "refunded" : "partially_refunded";
  switch (pi.status) {
    case "succeeded":
      return "succeeded";
    case "processing":
      return "processing";
    case "canceled":
      return "canceled";
    default:
      return "pending";
  }
}

function refundedOf(pi: Stripe.PaymentIntent): number {
  const charge = pi.latest_charge;
  return charge && typeof charge === "object" ? (charge.amount_refunded ?? 0) : 0;
}

function toPayment(pi: Stripe.PaymentIntent): Payment {
  const refunded = refundedOf(pi);
  return {
    id: pi.id,
    provider: "stripe",
    status: statusOf(pi, refunded),
    amount: pi.amount,
    refunded,
    currency: pi.currency.toUpperCase(),
    metadata: { ...(pi.metadata ?? {}) },
    clientSecret: pi.client_secret ?? undefined,
  };
}

const EVENT_TYPES: Record<string, PaymentEventType> = {
  "payment_intent.succeeded": "payment.succeeded",
  "payment_intent.payment_failed": "payment.failed",
  "payment_intent.canceled": "payment.canceled",
  "charge.refunded": "payment.refunded",
  "invoice.paid": "subscription.renewed",
  "invoice.payment_succeeded": "subscription.renewed",
  "invoice.payment_failed": "subscription.payment_failed",
  "customer.subscription.updated": "subscription.updated",
  "customer.subscription.deleted": "subscription.canceled",
};

function toEvent(event: Stripe.Event): PaymentEvent {
  const type = EVENT_TYPES[event.type] ?? "other";
  const object = event.data.object as unknown as Record<string, unknown>;
  const out: PaymentEvent = { id: event.id, provider: "stripe", type, providerType: event.type, occurredAt: event.created * 1000, raw: event };
  if (event.type.startsWith("payment_intent.")) {
    out.paymentId = object.id as string;
    out.amount = object.amount as number;
    out.currency = String(object.currency ?? "").toUpperCase();
    out.metadata = { ...((object.metadata as Record<string, string>) ?? {}) };
  } else if (event.type === "charge.refunded") {
    const pi = object.payment_intent;
    out.paymentId = typeof pi === "string" ? pi : ((pi as { id?: string } | null)?.id ?? undefined);
    out.amount = object.amount as number;
    out.refunded = object.amount_refunded as number;
    out.currency = String(object.currency ?? "").toUpperCase();
    out.metadata = { ...((object.metadata as Record<string, string>) ?? {}) };
  }
  return out;
}

const wrap = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (err) {
    if (err instanceof PaymentError) throw err;
    const e = err as { code?: string; statusCode?: number; message?: string };
    if (e?.code === "resource_missing" || e?.statusCode === 404) throw new PaymentError("not_found", e.message ?? "Not found");
    throw new PaymentError("provider_error", e?.message ?? "Stripe request failed");
  }
};

/**
 * `client` returns the Stripe SDK client (lib/stripe.ts → getStripe, which
 * refuses a live key outside production). `webhookSecret` returns the
 * endpoint's signing secret.
 */
export function stripeProvider(client: () => Stripe, webhookSecret: () => string | undefined, isConfigured: () => boolean): PaymentProvider {
  const provider: PaymentProvider = {
    id: "stripe",
    capabilities: CAPABILITIES,
    configured: isConfigured,

    async createPayment(input: CreatePaymentInput): Promise<Payment> {
      assertValidPayment(provider, input);
      return wrap(async () =>
        toPayment(
          await client().paymentIntents.create(
            {
              amount: input.amount,
              currency: input.currency.toLowerCase(),
              ...(input.customerId ? { customer: input.customerId } : {}),
              automatic_payment_methods: { enabled: true },
              metadata: input.metadata,
              ...(input.receiptEmail ? { receipt_email: input.receiptEmail } : {}),
              description: input.description,
            },
            { idempotencyKey: input.idempotencyKey },
          ),
        ),
      );
    },

    async getPayment(id: string): Promise<Payment> {
      return wrap(async () => toPayment(await client().paymentIntents.retrieve(id, { expand: ["latest_charge"] })));
    },

    async refund(input: RefundInput): Promise<Refund> {
      return wrap(async () => {
        const payment = await provider.getPayment(input.paymentId);
        const left = payment.amount - payment.refunded;
        const amount = input.amount ?? left;
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new PaymentError("bad_request", "The refund must be a positive whole number of minor units");
        if (amount > left) throw new PaymentError("refund_exceeds_payment", "The refund is more than what's left of the payment");
        const r = await client().refunds.create(
          { payment_intent: input.paymentId, amount, ...(input.reason ? { metadata: { reason: input.reason } } : {}) },
          { idempotencyKey: input.idempotencyKey },
        );
        return {
          id: r.id,
          paymentId: input.paymentId,
          amount: r.amount,
          currency: r.currency.toUpperCase(),
          status: r.status === "succeeded" ? "succeeded" : r.status === "failed" || r.status === "canceled" ? "failed" : "pending",
        };
      });
    },

    async verifyWebhook(request): Promise<PaymentEvent> {
      const secret = webhookSecret();
      if (!secret) throw new PaymentError("not_configured", "The webhook signing secret isn't set");
      const signature = request.headers["stripe-signature"];
      if (!signature) throw new PaymentError("bad_signature", "Missing signature");
      let event: Stripe.Event;
      try {
        event = client().webhooks.constructEvent(request.body, signature, secret);
      } catch {
        throw new PaymentError("bad_signature", "Invalid signature");
      }
      return toEvent(event);
    },

    async listSucceeded(range): Promise<Payment[]> {
      return wrap(async () => {
        const out: Payment[] = [];
        const list = client().paymentIntents.list({
          created: { gte: Math.floor(range.from / 1000), lt: Math.ceil(range.to / 1000) },
          limit: 100,
          expand: ["data.latest_charge"],
        });
        for await (const pi of list) {
          if (pi.status === "succeeded") out.push(toPayment(pi));
        }
        return out;
      });
    },

    async payoutStatus(): Promise<PayoutStatus> {
      return wrap(async () => {
        const balance = await client().balance.retrieve();
        const currency = (balance.available[0]?.currency ?? balance.pending[0]?.currency ?? "").toUpperCase();
        const sum = (rows: { amount: number; currency: string }[]) => rows.filter((r) => r.currency.toUpperCase() === currency).reduce((t, r) => t + r.amount, 0);
        const payouts = await client().payouts.list({ limit: 1 });
        const last = payouts.data[0];
        return { available: sum(balance.available), pending: sum(balance.pending), currency, lastPayoutAt: last ? last.arrival_date * 1000 : null };
      });
    },
  };
  return provider;
}
