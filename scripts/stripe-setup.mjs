/**
 * Creates Stripe test products/prices for Three Wolves Badminton.
 * Run: STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
 */

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY");
  process.exit(1);
}

const Stripe = (await import("stripe")).default;
const stripe = new Stripe(key);

async function ensureProduct(name, metadata) {
  const existing = await stripe.products.search({
    query: `name:'${name}'`,
  });
  if (existing.data[0]) return existing.data[0];
  return stripe.products.create({ name, metadata });
}

async function main() {
  const casual = await ensureProduct("Three Wolves — Casual Session", {
    plan: "casual",
  });
  const monthly = await ensureProduct("Three Wolves — Monthly Membership", {
    plan: "monthly",
  });
  const quarterly = await ensureProduct("Three Wolves — Quarterly Membership", {
    plan: "quarterly",
  });
  const donation = await ensureProduct("Three Wolves — Donation", {
    type: "donation",
  });

  const monthlyPrice = await stripe.prices.create({
    product: monthly.id,
    unit_amount: 3300,
    currency: "nzd",
    recurring: { interval: "month" },
  });

  const quarterlyPrice = await stripe.prices.create({
    product: quarterly.id,
    unit_amount: 8500,
    currency: "nzd",
    recurring: { interval: "month", interval_count: 3 },
  });

  console.log("\nAdd these to your .env / Vercel:\n");
  console.log(`STRIPE_PRICE_MONTHLY=${monthlyPrice.id}`);
  console.log(`STRIPE_PRICE_QUARTERLY=${quarterlyPrice.id}`);
  console.log(`STRIPE_PRODUCT_DONATION=${donation.id}`);
  console.log(`\nCasual uses PaymentIntent amount (NZD $10) — product id: ${casual.id}`);
  console.log("Donations use a customer-chosen amount (PaymentIntent for one-time, Price.price_data for monthly) against the Donation product above.");
  console.log("\nWebhook events to enable: payment_intent.succeeded, invoice.payment_succeeded, customer.subscription.updated, customer.subscription.deleted");
}

main().catch(console.error);
