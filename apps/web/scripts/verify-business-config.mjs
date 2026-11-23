// Compares the business config in a database (POSTGRES_URL, read-only) with
// the live, published Sanity documents (Phase 2 PR 6). Run on the rehearsal
// branch after migration 0002 and on production right after the run: any
// difference (someone edited Sanity since the 23 Nov snapshot, or a value
// was copied wrong) fails with the exact field.
//
//   POSTGRES_URL=... node scripts/verify-business-config.mjs
//
// Sanity project and dataset: NEXT_PUBLIC_SANITY_PROJECT_ID /
// NEXT_PUBLIC_SANITY_DATASET (defaults: c0v5j4dz / production, the site's).
import { dbClient } from "./db-client.mjs";

const project = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "c0v5j4dz";
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const query = `{"plans": *[_type == "pricingPlan"] | order(order asc){planId, name, description, priceNzd, periodLabel, featured, features, stripePriceId},
  "schedule": *[_type == "scheduleSettings"][0]{maxCasualSpots, bookingLockDays}}`;
const res = await fetch(`https://${project}.api.sanity.io/v2025-02-19/data/query/${dataset}?perspective=published&query=${encodeURIComponent(query)}`);
if (!res.ok) throw new Error(`Sanity answered ${res.status}`);
const { result: cms } = await res.json();

const strip = (o) => {
  const out = {};
  if (o?.en) out.en = o.en;
  if (o?.vi) out.vi = o.vi;
  return out.en || out.vi ? out : null;
};
const canon = (p) => ({
  planId: p.planId,
  name: strip(p.name),
  description: strip(p.description),
  priceNzd: p.priceNzd ?? null,
  periodLabel: strip(p.periodLabel),
  featured: Boolean(p.featured),
  features: (p.features ?? []).map(strip).filter(Boolean),
  stripePriceId: p.stripePriceId ?? null,
});

const c = await dbClient(process.env.POSTGRES_URL, "verify-business-config");
await c.connect();
let db;
try {
  await c.query("BEGIN READ ONLY");
  const plans = (
    await c.query(
      `SELECT plan_id, name, description, price_nzd::float8 AS price, period_label, featured, features, stripe_price_id FROM pricing_plans ORDER BY sort, plan_id`,
    )
  ).rows;
  const settings = Object.fromEntries((await c.query(`SELECT key, value FROM club_settings`)).rows.map((r) => [r.key, r.value]));
  db = {
    plans: plans.map((r) =>
      canon({ planId: r.plan_id, name: r.name, description: r.description, priceNzd: r.price, periodLabel: r.period_label, featured: r.featured, features: r.features, stripePriceId: r.stripe_price_id }),
    ),
    maxCasualSpots: settings.max_casual_spots ?? null,
    bookingLockDays: settings.booking_lock_days ?? null,
  };
  await c.query("ROLLBACK");
} finally {
  await c.end();
}
const want = { plans: cms.plans.map(canon), maxCasualSpots: cms.schedule?.maxCasualSpots ?? null, bookingLockDays: cms.schedule?.bookingLockDays ?? null };
const problems = [];
const walk = (a, b, path) => {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${path}.${k}`);
  } else problems.push(`${path}: Sanity ${JSON.stringify(a)} vs database ${JSON.stringify(b)}`);
};
walk(want, db, "config");
if (problems.length) {
  console.error(`Business config differs (${problems.length}):\n${problems.join("\n")}`);
  process.exit(1);
}
const summary = db.plans.map((p) => `${p.planId} NZD ${p.priceNzd}`).join(", ");
console.log(`Business config matches Sanity exactly: ${db.plans.length} plans (${summary}), capacity ${db.maxCasualSpots ?? "default"}, booking lock ${db.bookingLockDays} days.`);
