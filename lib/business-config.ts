// Business config: pricing plans (incl. Stripe price ids) and club settings
// (session capacity, booking lock days). Moved out of Sanity into the
// database (Phase 2 PR 6, build plan §5); edited in Admin → Settings.
//
// Expand/contract: until migration 0002 has run on a database, its tables
// don't exist, and these readers fall back to Sanity, exactly as before. Once
// it has run, the database is the only source. Removing the Sanity fallback
// (and the Sanity fields) is a later, separate step.
import { asc, eq } from "drizzle-orm";
import { orm, schema } from "./database.ts";
import type { CmsPricingPlan } from "./pricing-plans.ts";
import type { PlanId } from "./constants.ts";
import type { LocaleString, LocaleText } from "./sanity.ts";

const { pricing_plans, club_settings } = schema;

export const PLAN_IDS: PlanId[] = ["casual", "fridayMonthly", "fridayQuarterly", "wednesdayMonthly", "wednesdayQuarterly"];

function missingTable(err: unknown): boolean {
  for (let e = err as { code?: string; cause?: unknown } | undefined, i = 0; e && i < 4; e = e.cause as typeof e, i++) {
    if (e.code === "42P01") return true;
  }
  return false;
}

const locale = (v: unknown): LocaleString | undefined => {
  const o = (v ?? {}) as { en?: string; vi?: string };
  return o.en || o.vi ? { ...(o.en ? { en: o.en } : {}), ...(o.vi ? { vi: o.vi } : {}) } : undefined;
};

/** Pricing plans from the database, or null when the table doesn't exist yet or is empty. */
export async function loadPricingPlansFromDb(): Promise<CmsPricingPlan[] | null> {
  const rows = await listPricingPlansForAdmin();
  return rows ? rows.map((r) => {
    const plan: CmsPricingPlan & { sort?: number } = { ...r };
    delete plan.sort;
    return plan;
  }) : null;
}

/** As loadPricingPlansFromDb, plus each plan's display order (Admin → Settings). */
export async function listPricingPlansForAdmin(): Promise<(CmsPricingPlan & { sort: number })[] | null> {
  if (!process.env.POSTGRES_URL) return null;
  try {
    const rows = await orm().select().from(pricing_plans).orderBy(asc(pricing_plans.sort), asc(pricing_plans.plan_id));
    if (!rows.length) return null;
    return rows.map((r) => ({
      planId: r.plan_id as PlanId,
      name: locale(r.name),
      description: locale(r.description) as LocaleText | undefined,
      priceNzd: r.price_nzd === null ? undefined : Number(r.price_nzd),
      periodLabel: locale(r.period_label),
      featured: r.featured,
      features: Array.isArray(r.features) && r.features.length ? (r.features as unknown[]).map((f) => locale(f) ?? {}) : undefined,
      stripePriceId: r.stripe_price_id ?? undefined,
      sort: r.sort,
    }));
  } catch (err) {
    if (missingTable(err)) return null;
    throw err;
  }
}

/** One club setting: found (possibly null = "not set") or not in the database. */
export async function loadClubSetting<T>(key: string): Promise<{ found: boolean; value: T | null }> {
  if (!process.env.POSTGRES_URL) return { found: false, value: null };
  try {
    const rows = await orm().select({ value: club_settings.value }).from(club_settings).where(eq(club_settings.key, key));
    return rows.length ? { found: true, value: (rows[0].value as T | null) ?? null } : { found: false, value: null };
  } catch (err) {
    if (missingTable(err)) return { found: false, value: null };
    throw err;
  }
}

/** The pricing plans the site shows and charges: database first, Sanity until migration 0002 has run. */
export async function getPricingPlans(): Promise<CmsPricingPlan[] | null> {
  const fromDb = await loadPricingPlansFromDb();
  if (fromDb) return fromDb;
  const { fetchPricingPlans } = await import("./sanity-queries.ts");
  return fetchPricingPlans();
}

/** Total players per session shown on the schedule (null = use the built-in default). */
export async function getMaxCasualSpots(fromSanity: number | null | undefined): Promise<number | null> {
  const s = await loadClubSetting<number>("max_casual_spots");
  return s.found ? s.value : (fromSanity ?? null);
}

// ---------------------------------------------------------------------------
// Admin edits
// ---------------------------------------------------------------------------

export type PlanEdit = {
  planId: PlanId;
  name: { en: string; vi: string };
  description: { en: string; vi: string };
  periodLabel: { en: string; vi: string };
  priceNzd: number | null;
  featured: boolean;
  features: { en: string; vi: string }[];
  stripePriceId: string | null;
  sort: number;
};

const clean = (o: { en: string; vi: string }) => ({ ...(o.en.trim() ? { en: o.en.trim() } : {}), ...(o.vi.trim() ? { vi: o.vi.trim() } : {}) });

export async function savePricingPlan(p: PlanEdit, actorPlayerId: number | null): Promise<void> {
  await orm()
    .update(pricing_plans)
    .set({
      name: clean(p.name),
      description: clean(p.description),
      period_label: clean(p.periodLabel),
      price_nzd: p.priceNzd === null ? null : p.priceNzd.toFixed(2),
      featured: p.featured,
      features: p.features.map(clean).filter((f) => f.en || f.vi),
      stripe_price_id: p.stripePriceId?.trim() || null,
      sort: p.sort,
      updated_at: new Date().toISOString(),
      updated_by: actorPlayerId,
    })
    .where(eq(pricing_plans.plan_id, p.planId));
}

export async function saveClubSetting(key: "max_casual_spots" | "booking_lock_days", value: number | null, actorPlayerId: number | null): Promise<void> {
  await orm()
    .insert(club_settings)
    .values({ key, value, updated_by: actorPlayerId })
    .onConflictDoUpdate({ target: club_settings.key, set: { value, updated_at: new Date().toISOString(), updated_by: actorPlayerId } });
}
