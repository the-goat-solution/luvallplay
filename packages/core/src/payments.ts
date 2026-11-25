// One Payments interface, several providers (build plan §6.5; Phase 3 step 8).
//
// Pure: types and rules, no I/O. A provider (Stripe first; MoMo and VietQR
// for Vietnam) implements PaymentProvider and declares its capabilities, so
// screens adapt: auto-renewing subscriptions only appear where the provider
// can charge again by itself; otherwise members get renewal reminders.
//
// Every provider passes one shared contract suite
// (apps/web/tests/payments.test.ts → paymentContract).
//
// Three optional parts sit beside the one-off payments every provider has,
// each present only when the matching capability is true:
//
//   customers       payers the provider knows by its own id, and their cards
//   subscriptions   charges the provider repeats by itself (capabilities.recurring)
//   checkout        a payment page the provider hosts (capabilities.hostedCheckout)
//
// Callers reach them through customersOf(), subscriptionsOf() and
// checkoutOf(), which refuse with PaymentError("unsupported") instead of
// failing on a missing property. Times are milliseconds since the epoch.

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
  /** The provider keeps customers and their saved cards (`customers`). */
  customers: boolean;
  /** The provider has its own payment page to send a payer to (`checkout`). */
  hostedCheckout: boolean;
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
  /** The provider's id for the club's own merchant account, when the event came through the platform (Stripe Connect). */
  account?: string;
  /** The provider's own event object, for handlers that need more. */
  raw: unknown;
};

export type PayoutStatus = { available: number; pending: number; currency: string; lastPayoutAt: number | null };

// ── Customers and their cards ──────────────────────────────────────────────

export type Card = { brand: string; last4: string; expMonth: number; expYear: number };

/** How a payer pays. `card` is null for anything that isn't a card (a bank debit, a wallet). */
export type PaymentMethod = { card: Card | null };

export type Receipt = { paidAt: number; amount: number; description: string | null; url: string | null; refunded: boolean };

export type CustomerInput = { email: string; name?: string; phone?: string; metadata?: Record<string, string> };

/** A card being saved for later charges, confirmed in the browser. */
export type CardSetup = { id: string; clientSecret: string | null };

export interface Customers {
  /** The provider's id for the payer with this email, if it has one. */
  find(email: string): Promise<string | null>;
  create(input: CustomerInput): Promise<string>;
  /** The customer's default way to pay and their latest payments (failed ones left out). */
  billing(customerId: string): Promise<{ paymentMethod: PaymentMethod | null; receipts: Receipt[] }>;
  /** Any card the customer has saved, for when neither they nor their subscription has a default. */
  savedCard(customerId: string): Promise<Card | null>;
  /** The provider's own page for replacing the card, coming back to `returnUrl`. */
  cardUpdateUrl(input: { customerId: string; returnUrl: string }): Promise<string>;
  /** Starts saving a card, to charge later without the payer present. Nothing is charged. */
  createCardSetup(input: { customerId: string; metadata: Record<string, string> }): Promise<CardSetup>;
  getCardSetup(id: string): Promise<{ succeeded: boolean; customerId: string | null; paymentMethodId: string | null }>;
}

// ── Subscriptions (capabilities.recurring) ─────────────────────────────────

/** What a subscription charges: one of the provider's own prices, or an amount made on the spot. */
export type SubscriptionPrice = { priceId: string } | { amount: number; currency: string; productId: string; every: "month" };

export type Subscription = {
  id: string;
  /** The provider's own word (Stripe: active, trialing, past_due, canceled, …). */
  status: string;
  cancelAtPeriodEnd: boolean;
  /** When the provider charges next (the end of a free period, or of the paid one). */
  nextChargeAt: number | null;
  /** What it charges each time, in minor units, when the provider says. */
  amount: number | null;
  metadata: Record<string, string>;
  /** The provider's handle on a change waiting for the next renewal, if any. */
  changeRef: string | null;
  /** With `{ billing: true }`: what it charges, when the subscription has its own. */
  paymentMethod?: PaymentMethod | null;
  /** With `{ billing: true }`: the change that starts at a later renewal. */
  pendingChange?: { startsAt: number; metadata: Record<string, string> } | null;
};

export type StartSubscriptionInput = {
  customerId: string;
  price: SubscriptionPrice;
  description?: string;
  metadata: Record<string, string>;
  /** Where the receipt for the first payment goes. */
  receiptEmail: string;
};

export interface Subscriptions {
  /**
   * A subscription whose first payment the payer confirms in the browser now.
   * `clientSecret` is null when the provider had no payment ready to confirm.
   */
  start(input: StartSubscriptionInput): Promise<{ subscriptionId: string; clientSecret: string | null }>;
  /** A subscription on a card already saved, first charged at `firstChargeAt`; cancelled if the card has gone by then. */
  startLater(input: { customerId: string; price: SubscriptionPrice; paymentMethodId: string; firstChargeAt: number; description?: string; metadata: Record<string, string> }): Promise<{ subscriptionId: string }>;
  get(id: string, options?: { billing?: boolean }): Promise<Subscription>;
  /** true: stops at the end of the paid period. false: carries on. */
  setCancelAtPeriodEnd(id: string, cancel: boolean): Promise<void>;
  /** From the next renewal: a new price, charged every `weeks` weeks, with `metadata` added to the subscription's. Replaces a change already waiting. */
  scheduleChange(subscription: Subscription, change: { price: { priceId: string }; weeks: number; metadata: Record<string, string> }): Promise<{ startsAt: number }>;
  /** Drops a change waiting for the next renewal. Nothing happens when there is none. */
  clearScheduledChange(subscription: Subscription): Promise<void>;
  /** Makes the next renewal free, once. `alreadyQueued`: one was already waiting, nothing changed. */
  skipNextCharge(id: string): Promise<{ alreadyQueued: boolean }>;
  /** Pushes the next charge out by `days`; the price afterwards is unchanged. Returns the new date. */
  postponeNextCharge(id: string, days: number): Promise<number>;
}

// ── A payment page the provider hosts (capabilities.hostedCheckout) ────────

export type CheckoutInput = {
  amount: number;
  currency: string;
  /** What the payer sees they're buying. */
  name: string;
  description: string;
  email: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
};

export interface Checkout {
  create(input: CheckoutInput): Promise<{ id: string; url: string | null }>;
  get(id: string): Promise<{ paid: boolean; metadata: Record<string, string> }>;
}

export interface PaymentProvider {
  readonly id: string;
  readonly capabilities: PaymentCapabilities;
  /** Whether the provider has its credentials. */
  configured(): boolean;
  /** Throws when the provider can't be used here (no credentials, or live credentials outside production). Call before reserving anything for a payment. */
  assertReady(): void;
  readonly customers?: Customers;
  readonly subscriptions?: Subscriptions;
  readonly checkout?: Checkout;
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

type Part = Pick<PaymentProvider, "id" | "capabilities" | "customers" | "subscriptions" | "checkout">;

/** The provider's customers, or PaymentError("unsupported"). */
export function customersOf(provider: Part): Customers {
  requireCapability(provider, "customers");
  if (!provider.customers) throw new PaymentError("unsupported", `${provider.id} declares customers but has none`);
  return provider.customers;
}

/** The provider's subscriptions, or PaymentError("unsupported"): offer renewal reminders instead. */
export function subscriptionsOf(provider: Part): Subscriptions {
  requireCapability(provider, "recurring");
  if (!provider.subscriptions) throw new PaymentError("unsupported", `${provider.id} declares recurring but has no subscriptions`);
  return provider.subscriptions;
}

/** The provider's hosted payment page, or PaymentError("unsupported"). */
export function checkoutOf(provider: Part): Checkout {
  requireCapability(provider, "hostedCheckout");
  if (!provider.checkout) throw new PaymentError("unsupported", `${provider.id} declares hostedCheckout but has none`);
  return provider.checkout;
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
