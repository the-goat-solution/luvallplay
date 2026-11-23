// Entitlements and fair-use limits (build plan §6.5 "Business model", §11.2;
// Phase 3 step 9). Pure: no I/O.
//
// A plan names the tiers it includes ("free", later "standard", …). Every
// module's manifest names the tier it belongs to. can() answers whether a
// club's plan includes a module's feature.
//
// Two rules from the plan:
//   - Billing is off until the first paid club (BILLING_ENABLED=false): with
//     billing off, everything is allowed, whatever the tables say.
//   - A limit never stops a club running its sessions (§11.2): going over
//     shows a warning and starts a conversation. checkLimit() reports; it
//     doesn't block.

export type Plan = {
  id: string;
  /** The tiers the plan includes. */
  tiers: readonly string[];
  /** Fair-use limits per month, by metric. A metric that isn't listed has no limit. */
  limits: Readonly<Record<string, number>>;
  status: "active" | "trial" | "past_due" | "canceled";
};

/** "arena.challenges" → "arena". A feature is "<module>" or "<module>.<feature>". */
export function featureModule(feature: string): string {
  const dot = feature.indexOf(".");
  return dot === -1 ? feature : feature.slice(0, dot);
}

export type CanInput = {
  billingEnabled: boolean;
  /** The club's current plan; null when it has none (or it couldn't be read). */
  plan: Plan | null;
  /** The tier of the module the feature belongs to; undefined for a module that doesn't exist. */
  moduleTier: string | undefined;
};

export type CanResult = { allowed: true } | { allowed: false; reason: "unknown-module" | "no-plan" | "plan-ended" | "not-in-plan" };

/** Whether the club's plan includes the feature, and why not. */
export function can(input: CanInput): CanResult {
  if (input.moduleTier === undefined) return { allowed: false, reason: "unknown-module" };
  if (!input.billingEnabled) return { allowed: true };
  // The free tier is what a club with no plan at all still has: a billing
  // problem never takes away the tools a free club runs its sessions with.
  if (input.moduleTier === "free") return { allowed: true };
  if (!input.plan) return { allowed: false, reason: "no-plan" };
  if (input.plan.status === "canceled") return { allowed: false, reason: "plan-ended" };
  return input.plan.tiers.includes(input.moduleTier) ? { allowed: true } : { allowed: false, reason: "not-in-plan" };
}

export type LimitState = { state: "none" | "ok" | "near" | "over"; used: number; limit: number | null; ratio: number | null };

/** Where usage stands against a fair-use limit. Never a reason to block: "over" means warn and talk. */
export function checkLimit(used: number, limit: number | null | undefined, nearAt = 0.8): LimitState {
  if (limit === null || limit === undefined || !(limit > 0)) return { state: "none", used, limit: null, ratio: null };
  const ratio = used / limit;
  return { state: ratio > 1 ? "over" : ratio >= nearAt ? "near" : "ok", used, limit, ratio };
}

/** The usage period an instant falls in: the first of its month, UTC ("2026-11-01"). */
export function usagePeriod(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** The metrics the platform counts per club (§11.3 gate 4). */
export const USAGE_METRICS = {
  "email.sent": "Emails sent",
  "sms.sent": "Sign-in texts sent",
  "storage.bytes_uploaded": "Bytes uploaded to file storage",
  "payments.created": "Online payments started",
} as const;
export type UsageMetric = keyof typeof USAGE_METRICS;

/** Reads a plan row's limits column: only whole, positive numbers for known shapes survive. */
export function parseLimits(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}
