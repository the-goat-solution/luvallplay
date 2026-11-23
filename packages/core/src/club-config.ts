// A club's settings, as the app uses them (build plan §6.2 "Settings
// replacing constants"). Pure: no database, no framework.
//
// Each club's values live in `tenants` (time zone, currency, terms) and in
// `tenant_modules.settings` (per module). parseClubConfig turns those rows
// into one typed object. Anything missing or malformed falls back to the
// given defaults field by field, and is reported, so a bad value can never
// take a club down: the worst case is yesterday's behaviour plus a warning.

export type MembershipDayName = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
const DAY_NAMES: readonly string[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export type ClubConfig = {
  /** tenants.id; null when the values are the built-in defaults. */
  tenantId: number | null;
  slug: string;
  name: string;
  country: string;
  region: string;
  /** IANA time zone the club's days and cut-offs are counted in. */
  timezone: string;
  /** ISO 4217. Amounts are integer minor units of this currency. */
  currency: string;
  languages: string[];
  terms: { pointsName: string; visionName: string };
  playDays: {
    /** Courts booked → players allowed. */
    courtsToMaxPlayers: Record<number, number>;
    /** Players allowed when the courts count isn't in the table. */
    sessionCapacity: number;
    casualOnlyDefaultCourts: number;
    bookingWindowDays: number;
    /** Hour (0–23, club time) after which same-day booking closes. */
    bookingCutoffHour: number;
  };
  roundRobin: { miniGameMaxPlayers: number };
  memberships: {
    /** Weekdays a membership gives access to. */
    days: MembershipDayName[];
    defaultCourts: Record<string, number>;
    cycleDays: { monthly: number; quarterly: number };
    startSearchDays: number;
    pendingHoldMinutes: number;
  };
  /** Minor units of the club's currency. */
  donations: { minAmount: number; maxAmount: number };
};

export type TenantRow = {
  id: number;
  slug: string;
  name: string;
  country: string;
  region: string;
  timezone: string;
  currency: string;
  languages: string[] | null;
  terms: unknown;
};
export type ModuleSettingsRow = { module_id: string; settings: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const nonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Positive-integer keys and values, e.g. courts → players. */
function intMap(v: unknown): Record<number, number> | null {
  if (!isObj(v)) return null;
  const out: Record<number, number> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!/^[1-9]\d*$/.test(k) || !posInt(x)) return null;
    out[Number(k)] = x;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The club's settings from its database rows. Returns the config and the
 * list of fields that fell back to `defaults` (empty when every value was
 * present and valid).
 */
export function parseClubConfig(tenant: TenantRow, modules: ModuleSettingsRow[], defaults: ClubConfig): { config: ClubConfig; problems: string[] } {
  const problems: string[] = [];
  const settings = new Map(modules.map((m) => [m.module_id, isObj(m.settings) ? m.settings : {}]));
  const pick = <T,>(path: string, value: unknown, ok: (v: unknown) => v is T, fallback: T): T => {
    if (ok(value)) return value;
    problems.push(`${path}: ${value === undefined ? "missing" : "invalid"}, using the default`);
    return fallback;
  };
  const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

  const terms = isObj(tenant.terms) ? tenant.terms : {};
  const pd = settings.get("play-days") ?? {};
  const rr = settings.get("round-robin") ?? {};
  const mem = settings.get("memberships") ?? {};
  const don = settings.get("donations") ?? {};

  const courts = intMap(pd.courtsToMaxPlayers);
  if (!courts) problems.push(`play-days.courtsToMaxPlayers: ${pd.courtsToMaxPlayers === undefined ? "missing" : "invalid"}, using the default`);

  const days = Array.isArray(mem.days) && mem.days.length > 0 && mem.days.every((d) => typeof d === "string" && DAY_NAMES.includes(d)) ? (mem.days as MembershipDayName[]) : null;
  if (!days) problems.push(`memberships.days: ${mem.days === undefined ? "missing" : "invalid"}, using the default`);

  const defaultCourts = isObj(mem.defaultCourts) && Object.entries(mem.defaultCourts).every(([k, v]) => DAY_NAMES.includes(k) && posInt(v)) ? (mem.defaultCourts as Record<string, number>) : null;
  if (!defaultCourts) problems.push(`memberships.defaultCourts: ${mem.defaultCourts === undefined ? "missing" : "invalid"}, using the default`);

  const cycle = isObj(mem.cycleDays) && posInt(mem.cycleDays.monthly) && posInt(mem.cycleDays.quarterly) ? { monthly: mem.cycleDays.monthly, quarterly: mem.cycleDays.quarterly } : null;
  if (!cycle) problems.push(`memberships.cycleDays: ${mem.cycleDays === undefined ? "missing" : "invalid"}, using the default`);

  const hour = (v: unknown): v is number => nonNegInt(v) && v <= 23;
  let minAmount = pick("donations.minAmount", don.minAmount, nonNegInt, defaults.donations.minAmount);
  let maxAmount = pick("donations.maxAmount", don.maxAmount, posInt, defaults.donations.maxAmount);
  if (minAmount > maxAmount) {
    problems.push("donations: minAmount is above maxAmount, using the defaults");
    ({ minAmount, maxAmount } = defaults.donations);
  }

  const config: ClubConfig = {
    tenantId: tenant.id,
    slug: tenant.slug,
    name: pick("tenant.name", tenant.name, str, defaults.name),
    country: pick("tenant.country", tenant.country, (v): v is string => typeof v === "string" && /^[A-Z]{2}$/.test(v), defaults.country),
    region: pick("tenant.region", tenant.region, str, defaults.region),
    timezone: pick("tenant.timezone", tenant.timezone, validTimeZone, defaults.timezone),
    currency: pick("tenant.currency", tenant.currency, (v): v is string => typeof v === "string" && /^[A-Z]{3}$/.test(v), defaults.currency),
    languages: Array.isArray(tenant.languages) && tenant.languages.length ? tenant.languages : defaults.languages,
    terms: {
      pointsName: pick("tenant.terms.points_name", terms.points_name, str, defaults.terms.pointsName),
      visionName: pick("tenant.terms.vision_name", terms.vision_name, str, defaults.terms.visionName),
    },
    playDays: {
      courtsToMaxPlayers: courts ?? defaults.playDays.courtsToMaxPlayers,
      sessionCapacity: pick("play-days.sessionCapacity", pd.sessionCapacity, posInt, defaults.playDays.sessionCapacity),
      casualOnlyDefaultCourts: pick("play-days.casualOnlyDefaultCourts", pd.casualOnlyDefaultCourts, posInt, defaults.playDays.casualOnlyDefaultCourts),
      bookingWindowDays: pick("play-days.bookingWindowDays", pd.bookingWindowDays, posInt, defaults.playDays.bookingWindowDays),
      bookingCutoffHour: pick("play-days.bookingCutoffHour", pd.bookingCutoffHour, hour, defaults.playDays.bookingCutoffHour),
    },
    roundRobin: { miniGameMaxPlayers: pick("round-robin.miniGameMaxPlayers", rr.miniGameMaxPlayers, posInt, defaults.roundRobin.miniGameMaxPlayers) },
    memberships: {
      days: days ?? defaults.memberships.days,
      defaultCourts: defaultCourts ?? defaults.memberships.defaultCourts,
      cycleDays: cycle ?? defaults.memberships.cycleDays,
      startSearchDays: pick("memberships.startSearchDays", mem.startSearchDays, posInt, defaults.memberships.startSearchDays),
      pendingHoldMinutes: pick("memberships.pendingHoldMinutes", mem.pendingHoldMinutes, posInt, defaults.memberships.pendingHoldMinutes),
    },
    donations: { minAmount, maxAmount },
  };
  return { config, problems };
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "undefined";
}

/**
 * Every setting where two configs differ, as "path: a → b" (empty when they
 * agree). Identity fields (tenantId, slug) aren't settings and are skipped.
 * This is the shadow read: the values the code uses today beside the values
 * stored for the club.
 */
export function diffClubConfig(a: ClubConfig, b: ClubConfig): string[] {
  const out: string[] = [];
  const walk = (path: string, x: unknown, y: unknown, leaf: boolean) => {
    if (!leaf && isObj(x) && isObj(y)) {
      for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
        // Maps and lists are compared whole: one line per setting.
        const whole = ["courtsToMaxPlayers", "defaultCourts", "cycleDays", "days", "languages"].includes(k);
        walk(path ? `${path}.${k}` : k, x[k], y[k], whole);
      }
      return;
    }
    if (canonical(x) !== canonical(y)) out.push(`${path}: ${canonical(x)} → ${canonical(y)}`);
  };
  const { tenantId: _a, slug: _b, ...restA } = a;
  const { tenantId: _c, slug: _d, ...restB } = b;
  void _a, _b, _c, _d;
  walk("", restA, restB, false);
  return out;
}
