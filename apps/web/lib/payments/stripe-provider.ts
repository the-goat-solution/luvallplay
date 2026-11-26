// Stripe behind the Payments interface (build plan §6.5; Phase 3 step 8).
// The first provider. It passes the shared contract suite
// (tests/payments.test.ts) against a stand-in for Stripe's API, with real
// webhook signatures.
import type Stripe from "stripe";
import {
  PaymentError,
  assertValidPayment,
  type Card,
  type Checkout,
  type CreatePaymentInput,
  type Customers,
  type Payment,
  type PaymentCapabilities,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentProvider,
  type PaymentStatus,
  type PayoutStatus,
  type Refund,
  type RefundInput,
  type Subscription,
  type SubscriptionPrice,
  type Subscriptions,
} from "@luvallplay/core/payments";

const CAPABILITIES: PaymentCapabilities = {
  clientConfirmation: true,
  qr: false,
  recurring: true,
  refunds: true,
  partialRefunds: true,
  webhooks: true,
  payoutStatus: true,
  customers: true,
  hostedCheckout: true,
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
  if (event.account) out.account = event.account;
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

const cardOf = (pm: Stripe.PaymentMethod | null | undefined): Card | null =>
  pm?.card ? { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year } : null;

const ms = (unix: number | null | undefined): number | null => (unix ? unix * 1000 : null);

const priceItem = (price: SubscriptionPrice): Stripe.SubscriptionCreateParams.Item =>
  "priceId" in price
    ? { price: price.priceId }
    : { price_data: { currency: price.currency.toLowerCase(), product: price.productId, unit_amount: price.amount, recurring: { interval: price.every } } };

// The invoice's payment (and its PaymentIntent) attach a moment after the
// invoice itself is created, so an immediate retrieve can race and find
// `payments.data` still empty: poll briefly until it shows up.
async function invoicePayment(stripe: Stripe, invoiceId: string): Promise<{ id: string; clientSecret: string } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payments.data.payment.payment_intent"] });
    const paymentIntent = invoice.payments?.data[0]?.payment?.payment_intent;
    if (typeof paymentIntent === "object" && paymentIntent?.client_secret) {
      return { id: paymentIntent.id, clientSecret: paymentIntent.client_secret };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

function toSubscription(sub: Stripe.Subscription): Subscription {
  const item = sub.items?.data[0];
  return {
    id: sub.id,
    status: sub.status,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    nextChargeAt: ms(sub.status === "trialing" && sub.trial_end ? sub.trial_end : item?.current_period_end),
    amount: item?.price?.unit_amount ?? null,
    metadata: { ...(sub.metadata ?? {}) },
    changeRef: (typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id) ?? null,
  };
}

export type StripeProviderOptions = {
  /**
   * The id of the one 100%-off, single-use coupon behind every free renewal
   * (skipNextCharge). A fixed id means it's made once and found again,
   * instead of a new coupon per member.
   */
  freePeriodCouponId?: string;
  /** The billing portal configuration for card updates, when the account has one. */
  portalConfigurationId?: () => string | undefined;
  /**
   * Stripe Connect: the club's connected account and the platform's fee in
   * basis points (lib/payments/stripe-client.ts). The account itself rides on
   * the client; this only adds the fee to what is charged. No account, or a
   * fee of 0: nothing is added.
   */
  connect?: () => { account: string | null; feeBps: number };
  /** The signing secret of the platform's Connect webhook endpoint (events from connected accounts). */
  connectWebhookSecret?: () => string | undefined;
};

/**
 * `client` returns the Stripe SDK client (lib/stripe.ts → getStripe, which
 * refuses a live key outside production). `webhookSecret` returns the
 * endpoint's signing secret.
 */
export function stripeProvider(client: () => Stripe, webhookSecret: () => string | undefined, isConfigured: () => boolean, options: StripeProviderOptions = {}): PaymentProvider {
  const freePeriodCouponId = options.freePeriodCouponId ?? "free-period";

  // The platform's fee, only on a connected account and only when above 0.
  const feeBps = (): number => {
    const connect = options.connect?.();
    return connect?.account ? connect.feeBps : 0;
  };
  const feeAmount = (amount: number): number => Math.round((amount * feeBps()) / 10_000);
  const feeOnPayment = (amount: number) => (feeAmount(amount) > 0 ? { application_fee_amount: feeAmount(amount) } : {});
  const feeOnSubscription = () => (feeBps() > 0 ? { application_fee_percent: feeBps() / 100 } : {});

  const customers: Customers = {
    find: (email) => wrap(async () => (await client().customers.list({ email, limit: 1 })).data[0]?.id ?? null),

    create: (input) =>
      wrap(async () => {
        const params: Stripe.CustomerCreateParams = { email: input.email };
        if ("name" in input) params.name = input.name;
        if ("phone" in input) params.phone = input.phone;
        if (input.metadata) params.metadata = input.metadata;
        return (await client().customers.create(params)).id;
      }),

    billing: (customerId) =>
      wrap(async () => {
        const stripe = client();
        const [customer, charges] = await Promise.all([
          stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] }),
          stripe.charges.list({ customer: customerId, limit: 12 }),
        ]);
        let pm: Stripe.PaymentMethod | null = null;
        if (!customer.deleted) {
          const dpm = customer.invoice_settings?.default_payment_method;
          if (dpm && typeof dpm === "object") pm = dpm;
        }
        return {
          paymentMethod: pm ? { card: cardOf(pm) } : null,
          receipts: charges.data
            .filter((c) => c.status === "succeeded")
            .map((c) => ({ paidAt: c.created * 1000, amount: c.amount, description: c.description ?? null, url: c.receipt_url ?? null, refunded: c.refunded })),
        };
      }),

    savedCard: (customerId) => wrap(async () => cardOf((await client().paymentMethods.list({ customer: customerId, type: "card", limit: 1 })).data[0])),

    cardUpdateUrl: ({ customerId, returnUrl }) =>
      wrap(async () => {
        const configuration = options.portalConfigurationId?.();
        const session = await client().billingPortal.sessions.create({
          customer: customerId,
          return_url: returnUrl,
          ...(configuration ? { configuration } : {}),
          // Limited to updating the card (no cancel button).
          flow_data: { type: "payment_method_update", after_completion: { type: "redirect", redirect: { return_url: returnUrl } } },
        });
        return session.url;
      }),

    createCardSetup: ({ customerId, metadata }) =>
      wrap(async () => {
        const si = await client().setupIntents.create({ customer: customerId, usage: "off_session", automatic_payment_methods: { enabled: true }, metadata });
        return { id: si.id, clientSecret: si.client_secret ?? null };
      }),

    getCardSetup: (id) =>
      wrap(async () => {
        const si = await client().setupIntents.retrieve(id);
        return {
          succeeded: si.status === "succeeded",
          customerId: (typeof si.customer === "string" ? si.customer : si.customer?.id) ?? null,
          paymentMethodId: (typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id) ?? null,
        };
      }),
  };

  const releaseSchedule = async (id: string | null): Promise<void> => {
    if (!id) return;
    const schedule = await client().subscriptionSchedules.retrieve(id);
    if (schedule.status === "active" || schedule.status === "not_started") {
      await client().subscriptionSchedules.release(id);
    }
  };

  const subscriptions: Subscriptions = {
    start: (input) =>
      wrap(async () => {
        const stripe = client();
        const subscription = await stripe.subscriptions.create({
          customer: input.customerId,
          items: [priceItem(input.price)],
          // The first invoice is left for the payer to pay in the browser.
          payment_behavior: "default_incomplete",
          payment_settings: { save_default_payment_method: "on_subscription" },
          ...(input.description ? { description: input.description } : {}),
          metadata: input.metadata,
          ...feeOnSubscription(),
        });
        const invoiceId = typeof subscription.latest_invoice === "string" ? subscription.latest_invoice : subscription.latest_invoice?.id;
        const payment = invoiceId ? await invoicePayment(stripe, invoiceId) : null;
        if (!payment) return { subscriptionId: subscription.id, clientSecret: null };
        // Setting receipt_email always sends a receipt once this invoice is
        // paid, whatever the account's dashboard email settings: without it,
        // new members paid and got no confirmation.
        await stripe.paymentIntents.update(payment.id, { receipt_email: input.receiptEmail });
        return { subscriptionId: subscription.id, clientSecret: payment.clientSecret };
      }),

    startLater: (input) =>
      wrap(async () => {
        const sub = await client().subscriptions.create({
          customer: input.customerId,
          items: [priceItem(input.price)],
          default_payment_method: input.paymentMethodId,
          trial_end: Math.floor(input.firstChargeAt / 1000),
          trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
          ...(input.description ? { description: input.description } : {}),
          metadata: input.metadata,
          ...feeOnSubscription(),
        });
        return { subscriptionId: sub.id };
      }),

    get: (id, opts) =>
      wrap(async () => {
        if (!opts?.billing) return toSubscription(await client().subscriptions.retrieve(id));
        const sub = await client().subscriptions.retrieve(id, { expand: ["default_payment_method", "schedule"] });
        const out = toSubscription(sub);
        out.paymentMethod = sub.default_payment_method && typeof sub.default_payment_method === "object" ? { card: cardOf(sub.default_payment_method) } : null;
        out.pendingChange = null;
        const schedule = sub.schedule && typeof sub.schedule === "object" ? sub.schedule : null;
        if (schedule && schedule.status === "active") {
          const now = Math.floor(Date.now() / 1000);
          const upcoming = schedule.phases.find((p) => p.start_date > now);
          if (upcoming) out.pendingChange = { startsAt: upcoming.start_date * 1000, metadata: { ...(upcoming.metadata ?? {}) } };
        }
        return out;
      }),

    setCancelAtPeriodEnd: (id, cancel) =>
      wrap(async () => {
        await client().subscriptions.update(id, { cancel_at_period_end: cancel });
      }),

    // A subscription schedule: the current phase runs out, then the new
    // price starts with no proration. The new phase carries the change's
    // metadata onto the subscription, which is how the app learns it began.
    scheduleChange: (sub, change) =>
      wrap(async () => {
        const stripe = client();
        const scheduleId = sub.changeRef ?? (await stripe.subscriptionSchedules.create({ from_subscription: sub.id })).id;
        const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
        const now = Math.floor(Date.now() / 1000);
        const currentPhase = schedule.phases.find((p) => p.start_date <= now && p.end_date > now) ?? schedule.phases[0];
        const currentItems = currentPhase.items.map((it) => ({ price: typeof it.price === "string" ? it.price : it.price.id, quantity: it.quantity ?? 1 }));
        await stripe.subscriptionSchedules.update(scheduleId, {
          end_behavior: "release",
          phases: [
            {
              items: currentItems,
              start_date: currentPhase.start_date,
              end_date: currentPhase.end_date,
              metadata: { ...sub.metadata },
              ...(currentPhase.trial_end ? { trial_end: currentPhase.trial_end } : {}),
            },
            {
              items: [{ price: change.price.priceId, quantity: 1 }],
              duration: { interval: "week", interval_count: change.weeks },
              proration_behavior: "none",
              metadata: { ...sub.metadata, ...change.metadata },
            },
          ],
        });
        return { startsAt: currentPhase.end_date * 1000 };
      }),

    clearScheduledChange: (sub) => wrap(() => releaseSchedule(sub.changeRef)),

    // The next renewal invoice comes out at 0 without cancelling or pausing:
    // the provider still issues it and marks it paid, so the renewal path
    // extends the member's access exactly as a paid renewal would, and the
    // subscription stays "active" (pausing collection voids the invoice, so
    // access never advances; a trial flips the status to "trialing").
    skipNextCharge: (id) =>
      wrap(async () => {
        const stripe = client();
        const subscription = await stripe.subscriptions.retrieve(id, { expand: ["discounts"] });
        const existing = (subscription.discounts ?? []).filter((d): d is Stripe.Discount => typeof d === "object" && d !== null);
        // A "once" coupon is consumed by the next invoice, so one still
        // attached means a free renewal is already queued: a second would be
        // swallowed by that same invoice.
        if (existing.some((d) => d.coupon?.id === freePeriodCouponId)) return { alreadyQueued: true };
        try {
          await stripe.coupons.retrieve(freePeriodCouponId);
        } catch (e) {
          if ((e as { statusCode?: number } | null)?.statusCode !== 404) throw e;
          await stripe.coupons.create({ id: freePeriodCouponId, name: "Free month (admin granted)", percent_off: 100, duration: "once" });
        }
        await stripe.subscriptions.update(id, {
          // Setting `discounts` replaces the whole list: carry the others over.
          discounts: [...existing.map((d) => ({ discount: d.id })), { coupon: freePeriodCouponId }],
        });
        return { alreadyQueued: false };
      }),

    // Moving trial_end pushes the next charge out; the subscription shows as
    // "trialing" until then and normal billing resumes on the new date.
    // Repeat grants stack.
    postponeNextCharge: (id, days) =>
      wrap(async () => {
        const stripe = client();
        const subscription = await stripe.subscriptions.retrieve(id);
        if (subscription.status !== "active" && subscription.status !== "trialing") {
          throw new PaymentError("bad_request", `This subscription is ${subscription.status}, so it can't be extended.`);
        }
        const nextCharge = subscription.status === "trialing" && subscription.trial_end ? subscription.trial_end : subscription.items.data[0]?.current_period_end;
        if (!nextCharge) throw new PaymentError("bad_request", "Couldn't find this subscription's next billing date.");
        const resumesAt = nextCharge + days * 86400;
        await stripe.subscriptions.update(id, { trial_end: resumesAt, proration_behavior: "none" });
        return resumesAt * 1000;
      }),
  };

  const checkout: Checkout = {
    create: (input) =>
      wrap(async () => {
        const cs = await client().checkout.sessions.create({
          mode: "payment",
          line_items: [{ quantity: 1, price_data: { currency: input.currency.toLowerCase(), unit_amount: input.amount, product_data: { name: input.name, description: input.description } } }],
          customer_email: input.email,
          metadata: input.metadata,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          ...(feeAmount(input.amount) > 0 ? { payment_intent_data: feeOnPayment(input.amount) } : {}),
        });
        return { id: cs.id, url: cs.url };
      }),
    get: (id) =>
      wrap(async () => {
        const cs = await client().checkout.sessions.retrieve(id);
        return { paid: cs.payment_status === "paid", metadata: { ...(cs.metadata ?? {}) } };
      }),
  };

  const provider: PaymentProvider = {
    id: "stripe",
    capabilities: CAPABILITIES,
    configured: isConfigured,
    assertReady() {
      client();
    },
    customers,
    subscriptions,
    checkout,

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
              ...feeOnPayment(input.amount),
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
      // Two endpoints can deliver here: the account's own, and the platform's
      // Connect endpoint (events from connected accounts), each with its secret.
      const secrets = [webhookSecret(), options.connectWebhookSecret?.()].filter((s): s is string => Boolean(s));
      if (secrets.length === 0) throw new PaymentError("not_configured", "The webhook signing secret isn't set");
      const signature = request.headers["stripe-signature"];
      if (!signature) throw new PaymentError("bad_signature", "Missing signature");
      for (const secret of secrets) {
        try {
          return toEvent(client().webhooks.constructEvent(request.body, signature, secret));
        } catch {
          // Not signed with this one.
        }
      }
      throw new PaymentError("bad_signature", "Invalid signature");
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
