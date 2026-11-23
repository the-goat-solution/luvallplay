// The club's settings (build plan §6.2 "Settings replacing constants";
// Phase 3 step 4).
//
// Until now every setting was a constant in lib/constants.ts and the club's
// time zone a literal in lib/dates.ts. Migration 0003 copied those values
// into the database (tenants, tenant_modules.settings). This file is the
// one place the app asks for them, and CLUB_SETTINGS_SOURCE decides which
// copy answers:
//
//   constants  (default)  the built-in values, exactly as before.
//   shadow                the built-in values still answer, and the stored
//                         ones are read beside them; any difference is
//                         logged ("[shadow] club settings"). This is the
//                         shadow read: seven clean days before switching.
//   database              the stored values answer. Anything missing or
//                         malformed falls back to the built-in value for
//                         that field, with a warning.
//
// A database error never breaks a page: the built-in values answer.
import {
  type ClubConfig,
  type ModuleSettingsRow,
  type TenantRow,
  diffClubConfig,
  parseClubConfig,
} from "@luvallplay/core/club-config";
import * as C from "./constants.ts";
import { defaultTenantSlug } from "./tenant-members.ts";

export type { ClubConfig } from "@luvallplay/core/club-config";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Today's constants, in the shape of a club's settings. */
export const DEFAULT_CLUB_CONFIG: ClubConfig = {
  tenantId: null,
  slug: "three-wolves",
  name: "Three Wolves Badminton Club",
  country: "NZ",
  region: "syd",
  timezone: C.CLUB_TIME_ZONE,
  currency: C.CLUB_CURRENCY,
  languages: ["en", "vi"],
  terms: { pointsName: C.CLUB_TERMS.pointsName, visionName: C.CLUB_TERMS.visionName, localized: { vi: { ...C.CLUB_TERMS.localized.vi } } },
  playDays: {
    courtsToMaxPlayers: C.COURTS_TO_MAX_PLAYERS,
    sessionCapacity: C.SESSION_CAPACITY,
    casualOnlyDefaultCourts: C.CASUAL_ONLY_DEFAULT_COURTS,
    bookingWindowDays: C.BOOKING_WINDOW_DAYS,
    bookingCutoffHour: C.BOOKING_CUTOFF_HOUR,
  },
  roundRobin: { miniGameMaxPlayers: C.MINI_GAME_MAX_PLAYERS },
  memberships: {
    days: C.MEMBERSHIP_ACCESS_DAYS,
    defaultCourts: C.MEMBERSHIP_DAY_DEFAULT_COURTS,
    cycleDays: C.MEMBERSHIP_CYCLE_DAYS,
    startSearchDays: C.MEMBERSHIP_START_SEARCH_DAYS,
    pendingHoldMinutes: C.PENDING_MEMBERSHIP_HOLD_MINUTES,
  },
  donations: { minAmount: C.DONATION_MIN_CENTS, maxAmount: C.DONATION_MAX_CENTS },
};

export type SettingsSource = "constants" | "shadow" | "database";
export function settingsSource(): SettingsSource {
  const v = process.env.CLUB_SETTINGS_SOURCE?.trim().toLowerCase();
  return v === "shadow" || v === "database" ? v : "constants";
}

function isMissingTable(err: unknown): boolean {
  for (let e = err as { code?: string; cause?: unknown } | undefined, i = 0; e && i < 4; e = e.cause as typeof e, i++) {
    if (e.code === "42P01") return true;
  }
  return false;
}

export type StoredConfig = { config: ClubConfig; problems: string[] };

/** The club's stored settings, or null when it has none yet (tables or row missing). */
export async function loadClubConfigFromDb(db: Db, slug = defaultTenantSlug()): Promise<StoredConfig | null> {
  try {
    const t = await db.query(`SELECT id, slug, name, country, region, timezone, currency, languages, terms FROM tenants WHERE slug = $1`, [slug]);
    if (!t.rows[0]) return null;
    const tenant = t.rows[0] as unknown as TenantRow;
    const m = await db.query(`SELECT module_id, settings FROM tenant_modules WHERE tenant_id = $1`, [tenant.id]);
    return parseClubConfig(tenant, m.rows as unknown as ModuleSettingsRow[], DEFAULT_CLUB_CONFIG);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export type ShadowReport = {
  source: SettingsSource;
  /** False when the club has no stored settings to compare with. */
  stored: boolean;
  /** Stored values that were missing or malformed. */
  problems: string[];
  /** Settings where the stored value isn't the built-in one. */
  differences: string[];
};

/** Built-in settings beside the stored ones: what would change if the source switched. */
export async function compareClubConfig(db: Db, slug = defaultTenantSlug()): Promise<ShadowReport> {
  const stored = await loadClubConfigFromDb(db, slug);
  if (!stored) return { source: settingsSource(), stored: false, problems: [], differences: [] };
  return { source: settingsSource(), stored: true, problems: stored.problems, differences: diffClubConfig(DEFAULT_CLUB_CONFIG, stored.config) };
}

// One answer per server instance per minute: settings are read on most
// requests and change a few times a year.
const TTL_MS = 60_000;
let cached: { at: number; config: ClubConfig } | null = null;
let lastLogged = "";

/** For tests, and after an admin saves settings. */
export function resetClubConfigCache(): void {
  cached = null;
  lastLogged = "";
}

/** True the first time this exact message is seen (per server instance). */
function logOnce(kind: string, lines: string[]): boolean {
  const key = `${kind}:${lines.join("|")}`;
  if (key === lastLogged) return false;
  lastLogged = key;
  console.warn(`[shadow] club settings ${kind}: ${lines.join("; ")}`);
  return true;
}

// Set by the app (lib/club.ts) to put a difference on the durable record
// (lib/shadow-log.ts). Kept as a hook so this file has no dependency on it.
let onDifference: ((db: Db, differences: string[]) => Promise<void>) | null = null;
export function onClubConfigDifference(fn: typeof onDifference): void {
  onDifference = fn;
}

/**
 * The settings the app should use right now. Never throws.
 * `db` is injected (lib/database's sql in the app), so this file stays free
 * of the database client and usable from scripts and tests.
 */
export async function getClubConfig(db: Db, now = Date.now()): Promise<ClubConfig> {
  const source = settingsSource();
  if (source === "constants") return DEFAULT_CLUB_CONFIG;
  if (cached && now - cached.at < TTL_MS) return cached.config;
  let config = DEFAULT_CLUB_CONFIG;
  try {
    const stored = await loadClubConfigFromDb(db);
    if (!stored) {
      logOnce("missing", ["the club has no stored settings; using the built-in values"]);
    } else {
      if (stored.problems.length) logOnce("problems", stored.problems);
      const differences = diffClubConfig(DEFAULT_CLUB_CONFIG, stored.config);
      if (differences.length && logOnce("differ", differences)) await onDifference?.(db, differences);
      if (source === "database") config = stored.config;
    }
  } catch (err) {
    logOnce("unreadable", [String((err as Error)?.message ?? err).slice(0, 200)]);
  }
  cached = { at: now, config };
  return config;
}
