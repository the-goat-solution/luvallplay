import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

export function getPriceId(plan: "monthly" | "quarterly"): string {
  const key =
    plan === "monthly"
      ? "STRIPE_PRICE_MONTHLY"
      : "STRIPE_PRICE_QUARTERLY";
  const id = process.env[key];
  if (!id) throw new Error(`${key} is not configured`);
  return id;
}

export function getDonationProductId(): string {
  const id = process.env.STRIPE_PRODUCT_DONATION;
  if (!id) throw new Error("STRIPE_PRODUCT_DONATION is not configured");
  return id;
}

// Cancels at the end of the current billing period rather than
// immediately, so a member keeps the access they already paid for.
export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
}

// The invoice's payment (and its PaymentIntent) attach a moment after the
// invoice itself is created, so an immediate retrieve can race and find
// `payments.data` still empty — poll briefly until it shows up.
export async function getInvoicePaymentIntent(
  stripeClient: Stripe,
  invoiceId: string,
): Promise<{ id: string; clientSecret: string } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const invoice = await stripeClient.invoices.retrieve(invoiceId, {
      expand: ["payments.data.payment.payment_intent"],
    });
    const paymentIntent = invoice.payments?.data[0]?.payment?.payment_intent;
    if (typeof paymentIntent === "object" && paymentIntent?.client_secret) {
      return { id: paymentIntent.id, clientSecret: paymentIntent.client_secret };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}
