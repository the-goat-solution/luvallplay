// Entitlements and usage metering for this deployment's club (Phase 3 step
// 9). The rules are in @luvallplay/core/entitlements; this file reads the
// club's plan and writes the usage counters.
//
// BILLING_ENABLED (default false): with billing off, can() allows
// everything. It is built and tested now because the first paid market
// (Vietnam) needs it to be real, not hidden (§11.2).
//
// Neither function may break the app: a plan that can't be read allows the
// feature (and is logged), and a usage count that can't be written is
// dropped (and logged). Metering is for the cost model and fair-use
// conversations, not for enforcement.
import { MODULES } from "@luvallplay/modules";
import { can as canRule, checkLimit, featureModule, parseLimits, usagePeriod, USAGE_METRICS, type CanResult, type LimitState, type Plan, type UsageMetric } from "@luvallplay/core/entitlements";
import { defaultTenantSlug } from "./tenant-members.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export function billingEnabled(): boolean {
  return process.env.BILLING_ENABLED?.trim().toLowerCase() === "true";
}

const TTL_MS = 60_000;
// Keyed by the club, so a cached answer is never another club's (audit C7).
let cached: { at: number; slug: string; plan: Plan | null; tenantId: number | null } | null = null;

/** For tests, and after a club's plan changes. */
export function resetEntitlementsCache(): void {
  cached = null;
}

async function load(db: Db, now: number): Promise<{ plan: Plan | null; tenantId: number | null }> {
  const slug = defaultTenantSlug();
  if (cached && cached.slug === slug && now - cached.at < TTL_MS) return cached;
  const { rows } = await db.query(
    `SELECT t.id AS tenant_id, p.id AS plan_id, p.tiers, p.limits, cp.status
     FROM tenants t
     LEFT JOIN club_plans cp ON cp.tenant_id = t.id AND cp.ends_at IS NULL
     LEFT JOIN plans p ON p.id = cp.plan_id
     WHERE t.slug = $1`,
    [slug],
  );
  const r = rows[0];
  const plan: Plan | null = r?.plan_id
    ? { id: r.plan_id as string, tiers: (r.tiers as string[]) ?? [], limits: parseLimits(r.limits), status: r.status as Plan["status"] }
    : null;
  cached = { at: now, slug, plan, tenantId: (r?.tenant_id as number | undefined) ?? null };
  return cached;
}

/** The club's current plan, or null when it has none. */
export async function clubPlan(db: Db, now = Date.now()): Promise<Plan | null> {
  return (await load(db, now)).plan;
}

const moduleTier = (feature: string) => MODULES.find((m) => m.id === featureModule(feature))?.plan;

/**
 * Whether the club may use a module's feature: can(db, "arena") or
 * can(db, "arena.challenges"). With billing off, always yes for a module
 * that exists. Never throws.
 */
export async function can(db: Db, feature: string, now = Date.now()): Promise<CanResult> {
  const tier = moduleTier(feature);
  if (tier === undefined) return { allowed: false, reason: "unknown-module" };
  if (!billingEnabled()) return { allowed: true };
  try {
    return canRule({ billingEnabled: true, plan: await clubPlan(db, now), moduleTier: tier });
  } catch (err) {
    // The plan couldn't be read: the club keeps working, and someone is told.
    console.error(`[entitlements] couldn't read the club's plan; allowing ${feature}:`, err);
    return { allowed: true };
  }
}

/** Adds to this month's count of a metric for the club. Never throws; a failed count is dropped. */
export async function recordUsage(db: Db, metric: UsageMetric, quantity = 1, at: Date = new Date()): Promise<void> {
  if (!(quantity > 0) || !Number.isFinite(quantity)) return;
  try {
    const { tenantId } = await load(db, at.getTime());
    if (tenantId === null) return;
    await db.query(
      `INSERT INTO usage_counters (tenant_id, metric, period, quantity) VALUES ($1, $2, $3::date, $4)
       ON CONFLICT (tenant_id, metric, period) DO UPDATE SET quantity = usage_counters.quantity + EXCLUDED.quantity, updated_at = now()`,
      [tenantId, metric, usagePeriod(at), Math.round(quantity)],
    );
  } catch (err) {
    console.error(`[usage] couldn't record ${metric}:`, (err as Error)?.message ?? err);
  }
}

export type UsageRow = { metric: UsageMetric; label: string; period: string } & LimitState;

/** This month's usage for the club, each metric against the plan's fair-use limit (if it has one). */
export async function usageReport(db: Db, at: Date = new Date()): Promise<{ plan: Plan | null; billingEnabled: boolean; rows: UsageRow[] }> {
  const { plan, tenantId } = await load(db, at.getTime());
  const period = usagePeriod(at);
  const { rows } = tenantId === null ? { rows: [] } : await db.query(`SELECT metric, quantity FROM usage_counters WHERE tenant_id = $1 AND period = $2::date`, [tenantId, period]);
  const used = new Map(rows.map((r) => [r.metric as string, Number(r.quantity)]));
  return {
    plan,
    billingEnabled: billingEnabled(),
    rows: (Object.keys(USAGE_METRICS) as UsageMetric[]).map((metric) => ({ metric, label: USAGE_METRICS[metric], period, ...checkLimit(used.get(metric) ?? 0, plan?.limits[metric]) })),
  };
}
