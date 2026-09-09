/**
 * Creates/updates Stripe products & prices for Three Wolves Badminton,
 * including the Friday -> Wednesday membership rollout:
 *   - Renames the existing "Monthly/Quarterly Membership" products to
 *     "... (Friday)" IN PLACE — same product id, same Price id, so every
 *     already-active Friday subscription is completely unaffected.
 *   - Creates new "... (Wednesday)" products + prices at the same amounts.
 * Safe to re-run: every step searches for an existing product/price before
 * creating one, so running this twice does not create duplicates.
 *
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

// Renames a pre-Wednesday-era product (found by its old name) to its new
// day-qualified name, in place — same product id and Price ids, so nothing
// about already-active subscriptions changes. If the old name isn't found
// (already renamed on a prior run, or a fresh Stripe account that never had
// it), falls through to creating/finding it under the new name directly.
async function renameProduct(oldName, newName, metadata) {
  const existing = await stripe.products.search({
    query: `name:'${oldName}'`,
  });
  const product = existing.data[0];
  if (product) {
    if (product.name === newName) return product;
    return stripe.products.update(product.id, { name: newName, metadata });
  }
  return ensureProduct(newName, metadata);
}

// Finds an existing active price on this product matching the exact amount
// + recurring interval before creating a new one — without this, re-running
// the script would create a fresh duplicate price every time.
async function ensurePrice(product, unitAmount, recurring, nickname) {
  const { data } = await stripe.prices.list({
    product: product.id,
    active: true,
    limit: 100,
  });
  const match = data.find(
    (p) =>
      p.unit_amount === unitAmount &&
      p.currency === "nzd" &&
      p.recurring?.interval === recurring.interval &&
      (p.recurring?.interval_count ?? 1) === (recurring.interval_count ?? 1),
  );
  if (match) return match;
  return stripe.prices.create({
    product: product.id,
    unit_amount: unitAmount,
    currency: "nzd",
    recurring,
    nickname,
  });
}

async function main() {
  const casual = await ensureProduct("Three Wolves — Casual Session", {
    plan: "casual",
  });

  const fridayMonthly = await renameProduct(
    "Three Wolves — Monthly Membership",
    "Three Wolves — Monthly Membership (Friday)",
    { plan: "monthly", day: "friday" },
  );
  const fridayQuarterly = await renameProduct(
    "Three Wolves — Quarterly Membership",
    "Three Wolves — Quarterly Membership (Friday)",
    { plan: "quarterly", day: "friday" },
  );
  const wednesdayMonthly = await ensureProduct(
    "Three Wolves — Monthly Membership (Wednesday)",
    { plan: "monthly", day: "wednesday" },
  );
  const wednesdayQuarterly = await ensureProduct(
    "Three Wolves — Quarterly Membership (Wednesday)",
    { plan: "quarterly", day: "wednesday" },
  );
  const donation = await ensureProduct("Three Wolves — Donation", {
    type: "donation",
  });

  // Week-based intervals (not calendar months) so Stripe's billing cycle
  // lines up exactly with the app's 28-day/84-day access window
  // (MEMBERSHIP_CYCLE_DAYS in lib/constants.ts) — matches the live account's
  // already-corrected Friday prices (nicknamed "... (4-week cycle)" /
  // "... (12-week cycle)").
  const fridayMonthlyPrice = await ensurePrice(
    fridayMonthly,
    3300,
    { interval: "week", interval_count: 4 },
    "Monthly (4-week cycle)",
  );
  const fridayQuarterlyPrice = await ensurePrice(
    fridayQuarterly,
    8500,
    { interval: "week", interval_count: 12 },
    "Quarterly (12-week cycle)",
  );
  const wednesdayMonthlyPrice = await ensurePrice(
    wednesdayMonthly,
    3300,
    { interval: "week", interval_count: 4 },
    "Monthly (4-week cycle)",
  );
  const wednesdayQuarterlyPrice = await ensurePrice(
    wednesdayQuarterly,
    8500,
    { interval: "week", interval_count: 12 },
    "Quarterly (12-week cycle)",
  );

  console.log(
    "\nFriday price ids — should already match your deployed env vars (no change needed):\n",
  );
  console.log(`STRIPE_PRICE_MONTHLY=${fridayMonthlyPrice.id}`);
  console.log(`STRIPE_PRICE_QUARTERLY=${fridayQuarterlyPrice.id}`);
  console.log("\nAdd these NEW env vars to Vercel for Wednesday memberships:\n");
  console.log(`STRIPE_PRICE_WEDNESDAY_MONTHLY=${wednesdayMonthlyPrice.id}`);
  console.log(`STRIPE_PRICE_WEDNESDAY_QUARTERLY=${wednesdayQuarterlyPrice.id}`);
  console.log(`STRIPE_PRODUCT_DONATION=${donation.id}`);
  console.log(`\nCasual uses PaymentIntent amount (NZD $10) — product id: ${casual.id}`);
  console.log("Donations use a customer-chosen amount (PaymentIntent for one-time, Price.price_data for monthly) against the Donation product above.");
  console.log("\nWebhook events to enable: payment_intent.succeeded, invoice.payment_succeeded, customer.subscription.updated, customer.subscription.deleted");
}

main().catch(console.error);
