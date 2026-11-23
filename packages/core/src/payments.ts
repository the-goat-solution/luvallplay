// One Payments interface, several providers (build plan §6.5; Phase 3 step 8).
//
// Pure: types and rules, no I/O. A provider (Stripe first; MoMo and VietQR
// for Vietnam) implements PaymentProvider and declares its capabilities, so
// screens adapt: auto-renewing subscriptions only appear where the provider
// can charge again by itself; otherwise members get renewal reminders.
//
// Every provider passes one shared contract suite
// (apps/web/tests/payments.test.ts → paymentContract).

export type PaymentCapabilities = {
  /** Card or wallet payments confirmed in the browser with a client secret. */
  clientConfirmation: boolean;
  /** A QR code the payer scans in their banking or wallet app. */
  qr: boolean;
  /** The provider can charge again by itself (subscriptions). */
  recurring: boolean;
  refunds: boolean;
  partialRefunds: boolean;
  /** The provider tells us about payments (webhooks / IPN). Without it, payments are matched by hand or by bank feed. */
  webhooks: boolean;
  /** Payout (settlement) status can be read. */
  payoutStatus: boolean;
  /** Currencies the provider takes, upper case. */
  currencies: readonly string[];
};

export type PaymentStatus = "pending" | "processing" | "succeeded" | "failed" | "canceled" | "partially_refunded" | "refunded";

export type CreatePaymentInput = {
  /** Whole minor units of `currency` (cents for NZD, dong for VND). */
  amount: number;
  /** ISO 4217, upper case. */
  currency: string;
  description: string;
  /** What the payment is for; comes back on the provider's events. Values are strings. */
  metadata: Record<string, string>;
  /** The same key never creates a second payment. */
  idempotencyKey: string;
  receiptEmail?: string;
  /** The provider's own customer id, when the payer has one. */
  customerId?: string;
};

export type Payment = {
  /** The provider's id for the payment. */
  id: string;
  provider: string;
  status: PaymentStatus;
  amount: number;
  /** How much has been refunded, in minor units. */
  refunded: number;
  currency: string;
  metadata: Record<string, string>;
  /** For clientConfirmation providers: what the browser needs to finish the payment. */
  clientSecret?: string;
  /** For qr providers: the code's content. */
  qrPayload?: string;
};

export type RefundInput = {
  paymentId: string;
  /** Minor units; omit to refund everything that's left. */
  amount?: number;
  idempotencyKey: string;
  reason?: string;
};

export type Refund = { id: string; paymentId: string; amount: number; currency: string; status: "pending" | "succeeded" | "failed" };

export type PaymentEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled"
  | "payment.refunded"
  | "subscription.renewed"
  | "subscription.payment_failed"
  | "subscription.updated"
  | "subscription.canceled"
  /** Anything the app doesn't act on. Verified, acknowledged, ignored. */
  | "other";

export type PaymentEvent = {
  /** The provider's id for this event: the key for "have we seen this before". */
  id: string;
  provider: string;
  type: PaymentEventType;
  /** The provider's own name for the event, for logs. */
  providerType: string;
  paymentId?: string;
  amount?: number;
  /** For payment.refunded: the total refunded so far, in minor units. */
  refunded?: number;
  currency?: string;
  metadata?: Record<string, string>;
  /** When it happened at the provider (ms since epoch). */
  occurredAt: number;
  /** The provider's own event object, for handlers that need more. */
  raw: unknown;
};

export type PayoutStatus = { available: number; pending: number; currency: string; lastPayoutAt: number | null };

export interface PaymentProvider {
  readonly id: string;
  readonly capabilities: PaymentCapabilities;
  /** Whether the provider has its credentials. */
  configured(): boolean;
  createPayment(input: CreatePaymentInput): Promise<Payment>;
  getPayment(id: string): Promise<Payment>;
  refund(input: RefundInput): Promise<Refund>;
  /** Checks the signature and returns the event. Throws PaymentError("bad_signature") otherwise. */
  verifyWebhook(request: { body: string; headers: Record<string, string | undefined> }): Promise<PaymentEvent>;
  /** Payments that succeeded in a time range (ms since epoch), for reconciliation. */
  listSucceeded(range: { from: number; to: number }): Promise<Payment[]>;
  payoutStatus(): Promise<PayoutStatus>;
}

export type PaymentErrorCode =
  | "not_configured"
  | "unsupported"
  | "bad_signature"
  | "bad_request"
  | "not_found"
  | "currency_not_supported"
  | "refund_exceeds_payment"
  | "provider_error";

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  constructor(code: PaymentErrorCode, message: string) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }
}

/** Throws unless the provider can do it. Call before offering or starting the feature. */
export function requireCapability(provider: Pick<PaymentProvider, "id" | "capabilities">, capability: Exclude<keyof PaymentCapabilities, "currencies">): void {
  if (!provider.capabilities[capability]) throw new PaymentError("unsupported", `${provider.id} doesn't support ${capability}`);
}

/** The checks every provider makes before creating a payment. */
export function assertValidPayment(provider: Pick<PaymentProvider, "id" | "capabilities">, input: CreatePaymentInput): void {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new PaymentError("bad_request", "The amount must be a positive whole number of minor units");
  if (!provider.capabilities.currencies.includes(input.currency.toUpperCase())) {
    throw new PaymentError("currency_not_supported", `${provider.id} doesn't take ${input.currency}`);
  }
  if (!input.idempotencyKey) throw new PaymentError("bad_request", "An idempotency key is required");
  for (const [k, v] of Object.entries(input.metadata)) {
    if (typeof v !== "string") throw new PaymentError("bad_request", `metadata.${k} must be a string`);
  }
}

// ── Events arrive twice, and out of order ──────────────────────────────────

/** What we hold about a payment, built up from events. */
export type PaymentState = { status: PaymentStatus; amount: number; refunded: number; lastEventAt: number; seen: readonly string[] };

export const initialPaymentState = (amount: number): PaymentState => ({ status: "pending", amount, refunded: 0, lastEventAt: 0, seen: [] });

// A later stage is never undone by an event from an earlier one: a
// "succeeded" that arrives after the refund doesn't bring the money back.
const RANK: Record<PaymentStatus, number> = { pending: 0, processing: 1, failed: 2, canceled: 2, succeeded: 3, partially_refunded: 4, refunded: 5 };

/**
 * Folds one event into what we hold. The result is the same whatever order
 * the events arrive in, and however many times each is delivered:
 *   - an event id already seen changes nothing;
 *   - a status only moves forward (pending → succeeded → refunded);
 *   - the refunded total only grows, and never passes the amount.
 */
export function applyPaymentEvent(state: PaymentState, event: Pick<PaymentEvent, "id" | "type" | "occurredAt" | "refunded">): PaymentState {
  if (state.seen.includes(event.id)) return state;
  let { status, refunded } = state;
  const advance = (to: PaymentStatus) => {
    if (RANK[to] > RANK[status]) status = to;
  };
  if (event.type === "payment.succeeded") advance("succeeded");
  else if (event.type === "payment.failed") advance("failed");
  else if (event.type === "payment.canceled") advance("canceled");
  else if (event.type === "payment.refunded") {
    refunded = Math.min(state.amount, Math.max(refunded, event.refunded ?? state.amount));
    // A refund means the payment did succeed, even if that event is still on its way.
    advance(refunded >= state.amount ? "refunded" : "partially_refunded");
  }
  return { status, amount: state.amount, refunded, lastEventAt: Math.max(state.lastEventAt, event.occurredAt), seen: [...state.seen, event.id] };
}
