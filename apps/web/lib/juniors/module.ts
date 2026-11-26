// Juniors: is it on, and switching it on (build plan §6.8; Phase 3b step 2).
//
// Juniors holds children's information, so its switch is stricter than any
// other module's:
//
// - FAIL CLOSED. Every other module counts as on when the club's switches
//   can't be read (lib/club-modules.ts): a database hiccup must not turn a
//   club's features off. Juniors is the opposite: `juniorsOn()` is true only
//   when the club's row says on AND an owner's acknowledgement of the
//   safeguarding policy is stored beside it. Anything else, an error
//   included, is off. Every junior endpoint and page asks here.
// - Switching it ON needs all of: a club OWNER (not an admin, and not
//   Luvallplay staff on the club's behalf: the acknowledgement is the club's
//   own); a sign-in CODE entered in the last few minutes; and the current
//   safeguarding policy ACKNOWLEDGED. Forms & waivers, which Juniors needs,
//   is switched on with it.
// - While Phase 3b ships dark the module is hidden platform-wide (its
//   manifest), so in production nobody can switch it on at all. Outside
//   production JUNIORS_AVAILABILITY=available opens it for tests and previews.
//
// The fresh-code check here is lane J's own until the admin's per-action
// step-up (audit H8) is on main; then this calls that instead.
//
// Takes a small `Db`, like lib/club-modules.ts, so scripts and tests share it.
import { MODULES, canTurnOn, type PaymentMode } from "@luvallplay/modules";
import type { Access } from "@luvallplay/auth";
import { listClubModules, resetClubModulesCache, setClubModule, type Db } from "../club-modules.ts";
import { defaultTenantSlug } from "../tenant-members.ts";
import { SAFEGUARDING_POLICY_VERSION } from "./safeguarding-policy.ts";
import { juniorsAvailability, readAcknowledgement, type Env, type SafeguardingAcknowledgement } from "./switch-rule.ts";

export { juniorsAvailability, type SafeguardingAcknowledgement } from "./switch-rule.ts";

export const JUNIORS = "juniors";
export const FORMS_WAIVERS = "forms-waivers";

/** How recently the owner must have entered a sign-in code to switch Juniors on. */
export const JUNIORS_STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;

export type JuniorsState = {
  /** The switch itself (the club's row). */
  enabled: boolean;
  /** The acknowledgement stored with the switch, if any. */
  acknowledgement: SafeguardingAcknowledgement | null;
  /** On for real: enabled, acknowledged, and offered on this deployment. */
  on: boolean;
  /** The club acknowledged an older version of the policy and should be asked again. */
  policyOutOfDate: boolean;
};

/** The club's Juniors switch as stored. Throws when it can't be read; `juniorsOn` is the safe question. */
export async function juniorsState(db: Db, slug = defaultTenantSlug(), env: Env = process.env): Promise<JuniorsState> {
  const { rows } = await db.query(
    `SELECT m.enabled, m.settings FROM tenant_modules m JOIN tenants t ON t.id = m.tenant_id WHERE t.slug = $1 AND m.module_id = $2`,
    [slug, JUNIORS],
  );
  const enabled = rows[0]?.enabled === true;
  const acknowledgement = readAcknowledgement(rows[0]?.settings);
  return {
    enabled,
    acknowledgement,
    on: enabled && acknowledgement !== null && juniorsAvailability(env) !== "hidden",
    policyOutOfDate: acknowledgement !== null && acknowledgement.version !== SAFEGUARDING_POLICY_VERSION,
  };
}

/** Is Juniors on for the club? Never throws: anything that isn't a clear yes is no. */
export async function juniorsOn(db: Db, slug = defaultTenantSlug(), env: Env = process.env): Promise<boolean> {
  try {
    return (await juniorsState(db, slug, env)).on;
  } catch (err) {
    console.warn(`[juniors] can't read the club's Juniors switch, treating it as off: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    return false;
  }
}

/**
 * The club's id when Juniors is on for it, otherwise null. What a junior
 * endpoint asks first: one read that answers "is it on?" and names the club
 * every later statement must carry. Never throws; anything unclear is null.
 */
export async function juniorsClubId(db: Db, slug = defaultTenantSlug(), env: Env = process.env): Promise<number | null> {
  try {
    if (juniorsAvailability(env) === "hidden") return null;
    const { rows } = await db.query(
      `SELECT t.id, m.enabled, m.settings FROM tenant_modules m JOIN tenants t ON t.id = m.tenant_id WHERE t.slug = $1 AND m.module_id = $2`,
      [slug, JUNIORS],
    );
    const row = rows[0];
    const id = Number(row?.id);
    return row?.enabled === true && readAcknowledgement(row.settings) !== null && Number.isInteger(id) && id > 0 ? id : null;
  } catch (err) {
    console.warn(`[juniors] can't read the club's Juniors switch, treating it as off: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    return null;
  }
}

export type JuniorsSwitchRefusal =
  /** Not a club owner. */
  | "not_owner"
  /** The sign-in code is older than JUNIORS_STEP_UP_MAX_AGE_MS: ask for a new one. */
  | "step_up"
  /** The policy box wasn't ticked. */
  | "not_acknowledged"
  /** The policy changed since the page was shown: show the current one. */
  | "policy_changed"
  /** Not offered on this deployment (hidden), or the registry's rules refuse (a lock, the payment mode). */
  | "unavailable";

export type JuniorsSwitchOutcome = { ok: true; changed: boolean } | { ok: false; code: JuniorsSwitchRefusal; reason: string };

export type JuniorsSwitchInput = {
  actor: { playerId: number; access: Access; signedInAt: Date | string | null };
  /** The owner ticked "our club acknowledges this policy". */
  acknowledged: boolean;
  /** The version of the policy the owner was shown. */
  policyVersion: string;
};

function codeIsFresh(signedInAt: Date | string | null, now: number): boolean {
  if (!signedInAt) return false;
  const t = new Date(signedInAt).getTime();
  return Number.isFinite(t) && now - t <= JUNIORS_STEP_UP_MAX_AGE_MS && t <= now + 60_000;
}

const refuse = (code: JuniorsSwitchRefusal, reason: string): JuniorsSwitchOutcome => ({ ok: false, code, reason });

/**
 * Switch Juniors on for the club, or record a new acknowledgement when it is
 * already on. The checks run in the order a person can fix them: who they
 * are, what they ticked, how fresh their code is, then the platform's rules.
 */
export async function switchJuniorsOn(db: Db, input: JuniorsSwitchInput, opts: { slug?: string; now?: number; env?: Env } = {}): Promise<JuniorsSwitchOutcome> {
  const slug = opts.slug ?? defaultTenantSlug();
  const now = opts.now ?? Date.now();
  const env = opts.env ?? process.env;

  if (input.actor.access.role !== "owner") return refuse("not_owner", "Only an owner of the club can switch Juniors on.");
  if (!input.acknowledged) return refuse("not_acknowledged", "Tick the box to acknowledge the safeguarding policy first.");
  if (input.policyVersion !== SAFEGUARDING_POLICY_VERSION) return refuse("policy_changed", "The safeguarding policy has changed. Read the current one and acknowledge it.");
  if (!codeIsFresh(input.actor.signedInAt, now)) return refuse("step_up", "Enter a new sign-in code first: switching Juniors on needs one from the last few minutes.");

  const availability = juniorsAvailability(env);
  if (availability === "hidden") return refuse("unavailable", "Juniors isn't available yet.");

  const tenant = (await db.query(`SELECT id, payment_mode FROM tenants WHERE slug = $1`, [slug])).rows[0];
  if (!tenant) return refuse("unavailable", "This club has no settings yet.");
  const rows = await listClubModules(db, slug);
  const enabled = rows.filter((r) => r.enabled).map((r) => r.id);
  const ctx = {
    paymentMode: tenant.payment_mode as PaymentMode,
    actor: "owner" as const,
    locked: rows.filter((r) => r.locked).map((r) => r.id),
    // Offered here means offered together with what it needs.
    availability: { [JUNIORS]: availability, [FORMS_WAIVERS]: availability },
    inBeta: availability === "beta" ? [JUNIORS, FORMS_WAIVERS] : [],
  };
  // The registry's rules for both, as if switched one after the other. One
  // that is already on is left as it is (a platform lock "on" included).
  const needs = !enabled.includes(FORMS_WAIVERS) ? canTurnOn(MODULES, FORMS_WAIVERS, { ...ctx, enabled }) : { ok: true as const };
  if (!needs.ok) return refuse("unavailable", needs.reason);
  const verdict = !enabled.includes(JUNIORS) ? canTurnOn(MODULES, JUNIORS, { ...ctx, enabled: [...enabled, FORMS_WAIVERS] }) : { ok: true as const };
  if (!verdict.ok) return refuse("unavailable", verdict.reason);

  const before = await juniorsState(db, slug, env);
  const acknowledgement: SafeguardingAcknowledgement = { version: SAFEGUARDING_POLICY_VERSION, byPlayerId: input.actor.playerId, at: new Date(now).toISOString() };
  if (before.on && !before.policyOutOfDate && enabled.includes(FORMS_WAIVERS)) return { ok: true, changed: false };

  // Both rows in one statement: Juniors is never on without what it needs.
  await db.query(
    `INSERT INTO tenant_modules (tenant_id, module_id, enabled, enabled_at, updated_at, updated_by, settings)
     VALUES ($1, $2, true, now(), now(), $4, '{}'::jsonb), ($1, $3, true, now(), now(), $4, $5::jsonb)
     ON CONFLICT (tenant_id, module_id) DO UPDATE SET
       enabled = true,
       enabled_at = CASE WHEN tenant_modules.enabled THEN tenant_modules.enabled_at ELSE now() END,
       updated_at = now(), updated_by = EXCLUDED.updated_by,
       settings = tenant_modules.settings || EXCLUDED.settings`,
    [tenant.id, FORMS_WAIVERS, JUNIORS, input.actor.playerId, JSON.stringify({ safeguarding: acknowledgement })],
  );
  resetClubModulesCache();
  return { ok: true, changed: true };
}

/**
 * Switch Juniors off. Hides everything it owns and keeps the data, like any
 * module. Owners and Luvallplay staff; no code or acknowledgement needed,
 * because off is the safe direction. The stored acknowledgement is removed,
 * so switching on again always asks again. Forms & waivers is left as it is.
 */
export async function switchJuniorsOff(db: Db, actor: { playerId: number; access: Access }, slug = defaultTenantSlug()): Promise<JuniorsSwitchOutcome> {
  if (actor.access.role !== "owner" && !actor.access.platformAdmin) return refuse("not_owner", "Only an owner of the club can switch Juniors off.");
  const result = await setClubModule(db, { moduleId: JUNIORS, on: false, actor: actor.access.platformAdmin ? "platform-admin" : "owner", actorPlayerId: actor.playerId }, slug);
  if (!result.ok) return refuse("unavailable", result.reason);
  await db.query(
    `UPDATE tenant_modules m SET settings = m.settings - 'safeguarding' FROM tenants t WHERE t.id = m.tenant_id AND t.slug = $1 AND m.module_id = $2`,
    [slug, JUNIORS],
  );
  resetClubModulesCache();
  return { ok: true, changed: result.changed };
}
