// Which modules the club has switched on (build plan §6.2.3; Phase 3 step 5).
//
// tenant_modules holds one row per module and club. The request proxy asks
// here before serving a path a module owns (packages/modules/src/routes.ts),
// and the admin menu asks before showing a page.
//
// - The core is always on, whatever the table says.
// - A module without a row is OFF: the registry is the catalogue, and the
//   table is what the club chose.
// - If the table can't be read (database down, or the migration not applied
//   yet), every module counts as on, except one the platform keeps hidden. Enforcement is a product switch, not a
//   security boundary, and a database hiccup must not turn a club's features
//   off. The failure is logged.
// - A module the platform keeps hidden counts as on only when its own guard
//   agrees (Juniors: offered on this deployment, and an owner's
//   acknowledgement stored). A row that merely says "enabled" isn't enough.
// - MODULE_ENFORCEMENT=off turns enforcement off altogether (every module
//   on), as an escape hatch.
//
// Takes a small `Db`, like lib/club-config.ts, so scripts and tests share it.
import { MODULES, blockedByModule, routeOwner, canTurnOff, canTurnOn, type ModuleId, type PaymentMode } from "@luvallplay/modules";
import { hiddenModuleOn } from "./juniors/switch-rule.ts";
import { defaultTenantSlug } from "./tenant-members.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const CORE = MODULES.filter((m) => m.core).map((m) => m.id as string);
// A module the platform keeps hidden (its manifest says so) can't be switched
// on by a club, so "every module" never includes it: when the switches can't
// be read, a hidden module stays off.
const ALL = MODULES.filter((m) => m.availability !== "hidden").map((m) => m.id as string);
const everyModule = () => new Set(ALL);
const HIDDEN = new Set(MODULES.filter((m) => m.availability === "hidden").map((m) => m.id as string));

export function moduleEnforcementOn(): boolean {
  return process.env.MODULE_ENFORCEMENT?.trim().toLowerCase() !== "off";
}

export type ModuleRow = { id: string; enabled: boolean; locked: "on" | "off" | null; lockReason: string | null; settings?: unknown };

/** The club's row for every module in the registry (a missing row reads as off, unlocked). */
export async function listClubModules(db: Db, slug = defaultTenantSlug()): Promise<ModuleRow[]> {
  const { rows } = await db.query(
    `SELECT m.module_id, m.enabled, m.locked, m.lock_reason, m.settings
     FROM tenant_modules m JOIN tenants t ON t.id = m.tenant_id WHERE t.slug = $1`,
    [slug],
  );
  const byId = new Map(rows.map((r) => [String(r.module_id), r]));
  return MODULES.map((m) => {
    const r = byId.get(m.id);
    return {
      id: m.id,
      enabled: m.core ? true : r?.enabled === true,
      locked: r?.locked === "on" || r?.locked === "off" ? r.locked : null,
      lockReason: typeof r?.lock_reason === "string" ? r.lock_reason : null,
      settings: r?.settings,
    };
  });
}

// How long an instance remembers the club's switches. A switch reaches every
// server instance within this time (the instance that made it, at once).
// MODULES_CACHE_MS overrides it (tests use 0).
const ttlMs = () => {
  const v = Number(process.env.MODULES_CACHE_MS);
  return process.env.MODULES_CACHE_MS && Number.isFinite(v) && v >= 0 ? v : 60_000;
};
// Keyed by the club, so a cached answer is never another club's (audit C7).
let cached: { at: number; slug: string; enabled: Set<string> } | null = null;
let lastError = "";

/** After a switch is changed, and for tests. */
export function resetClubModulesCache(): void {
  cached = null;
  lastError = "";
}

/** The ids of the modules that are on for the club. Never throws. */
export async function enabledModules(db: Db, now = Date.now()): Promise<Set<string>> {
  if (!moduleEnforcementOn()) return everyModule();
  const slug = defaultTenantSlug();
  if (cached && cached.slug === slug && now - cached.at < ttlMs()) return cached.enabled;
  let enabled: Set<string>;
  try {
    const rows = await listClubModules(db, slug);
    // A hidden module's row saying "on" isn't enough: its own guard has to agree (lib/juniors/switch-rule.ts).
    enabled = new Set([...CORE, ...rows.filter((r) => r.enabled && (!HIDDEN.has(r.id) || hiddenModuleOn(r.id, r.settings))).map((r) => r.id)]);
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 200);
    if (message !== lastError) {
      lastError = message;
      console.warn(`[modules] can't read the club's modules, treating every module as on: ${message}`);
    }
    enabled = everyModule();
  }
  cached = { at: now, slug, enabled };
  return enabled;
}

/** The module that stops this path for the club right now, or null when it is served. */
export async function moduleBlocking(db: Db, pathname: string): Promise<ModuleId | null> {
  // Most paths belong to the core or the account and never need the database.
  const owner = routeOwner(pathname);
  if (!owner || owner === "core" || owner === "account" || owner === "platform") return null;
  return blockedByModule(pathname, await enabledModules(db));
}

export type SwitchOutcome = { ok: true; changed: boolean } | { ok: false; reason: string };

/**
 * Switch a module on or off for the club. The rules are the registry's
 * (canTurnOn / canTurnOff): the core never switches, requirements first,
 * dependents block, payment modes, and a platform admin's lock that owners
 * can't change. Data is never touched: off hides, it doesn't delete.
 */
export async function setClubModule(
  db: Db,
  input: { moduleId: string; on: boolean; actor: "owner" | "platform-admin"; actorPlayerId: number | null },
  slug = defaultTenantSlug(),
): Promise<SwitchOutcome> {
  const tenant = (await db.query(`SELECT id, payment_mode FROM tenants WHERE slug = $1`, [slug])).rows[0];
  if (!tenant) return { ok: false, reason: "This club has no settings yet." };
  const rows = await listClubModules(db, slug);
  const row = rows.find((r) => r.id === input.moduleId);
  if (!row) return { ok: false, reason: `There's no module "${input.moduleId}".` };
  if (row.enabled === input.on) return { ok: true, changed: false };

  const ctx = {
    paymentMode: tenant.payment_mode as PaymentMode,
    enabled: rows.filter((r) => r.enabled).map((r) => r.id),
    actor: input.actor,
    locked: rows.filter((r) => r.locked).map((r) => r.id),
  };
  const verdict = input.on ? canTurnOn(MODULES, input.moduleId, ctx) : canTurnOff(MODULES, input.moduleId, ctx);
  if (!verdict.ok) return verdict;

  await db.query(
    `INSERT INTO tenant_modules (tenant_id, module_id, enabled, enabled_at, updated_at, updated_by)
     VALUES ($1, $2, $3, CASE WHEN $3 THEN now() END, now(), $4)
     ON CONFLICT (tenant_id, module_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       enabled_at = CASE WHEN EXCLUDED.enabled THEN now() ELSE tenant_modules.enabled_at END,
       updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [tenant.id, input.moduleId, input.on, input.actorPlayerId],
  );
  resetClubModulesCache();
  return { ok: true, changed: true };
}

/**
 * A platform admin's lock on a module for the club (build plan §6.2.3: "an
 * owner can switch modules unless Luvallplay has locked one"). Locking a
 * module "on" or "off" first puts it in that state, by the same rules as any
 * switch; if those refuse (a core module, something depends on it), nothing
 * is locked. `lock: null` unlocks and leaves the state as it is.
 */
export async function setModuleLock(
  db: Db,
  input: { moduleId: string; lock: "on" | "off" | null; reason?: string; actor: "owner" | "platform-admin"; actorPlayerId: number | null },
  slug = defaultTenantSlug(),
): Promise<SwitchOutcome> {
  if (input.actor !== "platform-admin") return { ok: false, reason: "Only Luvallplay staff can lock a module." };
  const mod = MODULES.find((m) => m.id === input.moduleId);
  if (!mod) return { ok: false, reason: `There's no module "${input.moduleId}".` };
  if (mod.core) return { ok: false, reason: `${mod.name.en} is part of the core: it is always on and can't be locked.` };
  const reason = (input.reason ?? "").trim().slice(0, 200);
  if (input.lock && !reason) return { ok: false, reason: "Say why it is locked: the club's owners will see it." };
  const tenant = (await db.query(`SELECT id FROM tenants WHERE slug = $1`, [slug])).rows[0];
  if (!tenant) return { ok: false, reason: "This club has no settings yet." };
  const before = (await listClubModules(db, slug)).find((r) => r.id === input.moduleId);
  if (input.lock) {
    const switched = await setClubModule(db, { moduleId: input.moduleId, on: input.lock === "on", actor: "platform-admin", actorPlayerId: input.actorPlayerId }, slug);
    if (!switched.ok) return switched;
  }
  if ((before?.locked ?? null) === input.lock && (before?.lockReason ?? "") === (input.lock ? reason : "")) return { ok: true, changed: false };
  await db.query(
    `INSERT INTO tenant_modules (tenant_id, module_id, enabled, locked, lock_reason, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, now(), $6)
     ON CONFLICT (tenant_id, module_id) DO UPDATE SET locked = EXCLUDED.locked, lock_reason = EXCLUDED.lock_reason, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [tenant.id, input.moduleId, input.lock === "on", input.lock, input.lock ? reason : null, input.actorPlayerId],
  );
  resetClubModulesCache();
  return { ok: true, changed: true };
}
