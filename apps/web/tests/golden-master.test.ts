// Golden master tests for the database driver swap (test plan §4.5:
// "Database driver swap and Drizzle: old and new repository functions run on
// the same fixture and must return identical results for every function").
//
// Two copies of every database module run side by side in this process:
//
//   legacy  imported with "?golden=legacy": lib/database.ts is replaced by
//           tests/golden/legacy-database.ts, i.e. @vercel/postgres exactly as
//           the app used it before Phase 2;
//   new     the modules as shipped, on lib/database.ts.
//
// Each copy gets its own database, built by the migrations and loaded with
// the same synthetic fixture (tests/fixtures/golden/seed.sql). Every case
// calls one exported function on both copies, in the same order, with the
// same arguments and the same random numbers, and requires the same result
// (or the same error). At the end, every table of the two databases must hold
// the same rows. A coverage check fails if an exported database function has
// neither a case nor a written reason.
//
// Needs Postgres (DATA_GUARD_TEST_URL's server). CI sets
// DATA_GUARD_REQUIRE_DB=1, so it can't be skipped silently.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import crypto from "node:crypto";
import { register, syncBuiltinESMExports } from "node:module";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const SEED = readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");

// Modules that talk to the database (every importer of lib/database.ts).
const MODULES = [
  "db", "player-db", "player-auth", "stats-db", "arena-db", "arena-state", "match-stats-db", "messages-db",
  "photos-db", "shop-db", "jersey-db", "finance-db", "bank-db", "casual-play-db", "mini-game-db", "day-requests",
  "membership-self-service", "me-data", "profile-badges", "player-export", "player-merge", "wolf-vision-db",
  "webhooks", "api-v1", "admin-access", "sms",
] as const;
type ModName = (typeof MODULES)[number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mods = Record<ModName, Record<string, any>>;
type Side = { name: "legacy" | "new"; url: string; m: Mods };
type Args = unknown[] | ((s: Side) => unknown[] | Promise<unknown[]>);
type Case = { mod: ModName; fn: string; args?: Args; label?: string };

// ---------------------------------------------------------------------------
// Deterministic randomness: the same random bytes on both sides.
// ---------------------------------------------------------------------------
let stream = 0;
let counter = 0;
function nextBytes(n: number): Buffer {
  const out = Buffer.alloc(n);
  let filled = 0;
  while (filled < n) {
    const block = createHash("sha256").update(`${stream}:${counter++}`).digest();
    block.copy(out, filled, 0, Math.min(block.length, n - filled));
    filled += block.length;
  }
  return out;
}
function resetRandom(seed: number) {
  stream = seed;
  counter = 0;
}
function installDeterministicRandom() {
  const c = crypto as unknown as Record<string, unknown>;
  c.randomBytes = (n: number, cb?: (e: Error | null, b: Buffer) => void) => {
    const b = nextBytes(n);
    if (cb) {
      cb(null, b);
      return undefined;
    }
    return b;
  };
  c.randomInt = (a: number, b?: number) => {
    const [min, max] = b === undefined ? [0, a] : [a, b];
    return min + (nextBytes(4).readUInt32BE(0) % (max - min));
  };
  c.randomUUID = () => {
    const h = nextBytes(16).toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  const getRandomValues = <T extends ArrayBufferView>(arr: T) => {
    const b = nextBytes(arr.byteLength);
    new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(b);
    return arr;
  };
  try {
    Object.defineProperty(c, "getRandomValues", { value: getRandomValues, configurable: true, writable: true });
  } catch {
    // read-only on some Node versions; modules here use randomBytes instead
  }
  Object.defineProperty(globalThis.crypto, "getRandomValues", { value: getRandomValues, configurable: true, writable: true });
  Math.random = () => nextBytes(4).readUInt32BE(0) / 2 ** 32;
  syncBuiltinESMExports();
}

// ---------------------------------------------------------------------------
// Comparison: identical, except timestamps a few seconds apart (each side
// reads its own clock and its own database's now()).
// ---------------------------------------------------------------------------
const TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/;
function sameTime(a: string, b: string) {
  const x = Date.parse(a.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  const y = Date.parse(b.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 10_000;
}
function normalize(v: unknown): unknown {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Invalid Date" : v.toISOString();
  if (typeof v === "bigint") return `${v}n`;
  if (Buffer.isBuffer(v)) return `<buffer ${v.toString("hex")}>`;
  if (v instanceof Response) return { response: v.status };
  // Maps are lookups: compared by key, whatever order they were filled in.
  if (v instanceof Map) return { "<map>": [...v.entries()].map(([k, x]) => [normalize(k), normalize(x)]).sort((a, b) => (JSON.stringify(a[0]) < JSON.stringify(b[0]) ? -1 : 1)) };
  if (v instanceof Set) return { "<set>": [...v.values()].map(normalize) };
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    if (typeof (v as { then?: unknown }).then === "function") return "<promise>";
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = normalize((v as Record<string, unknown>)[k]);
    return out;
  }
  if (typeof v === "function") return "<function>";
  return v;
}
function diff(a: unknown, b: unknown, path = "$"): string | null {
  if (typeof a === "string" && typeof b === "string" && a !== b && TS.test(a) && TS.test(b) && sameTime(a, b)) return null;
  if (typeof a === "number" && typeof b === "number" && a !== b && a > 1.7e12 && b > 1.7e12 && Math.abs(a - b) < 10_000) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: ${a.length} items vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.join() !== kb.join()) return `${path}: keys ${ka.join(",")} vs ${kb.join(",")}`;
    for (const k of ka) {
      const d = diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return Object.is(a, b) ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

/**
 * Waits until nothing else is running on the side's database. Some functions
 * start work after they return (points sync "after the response"); it must
 * finish on its own database before the other side runs.
 */
async function settle(side: Side) {
  const { drainAfter } = await import("./golden/next-server.ts");
  await drainAfter();
  const name = new URL(side.url).pathname.slice(1);
  const c = new pg.Client({ connectionString: urlFor("postgres") });
  await c.connect();
  try {
    for (let quiet = 0, tries = 0; quiet < 3 && tries < 200; tries++) {
      await new Promise((r) => setTimeout(r, 15));
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND state NOT IN ('idle') AND pid <> pg_backend_pid()`, [name]);
      quiet = rows[0].n === 0 ? quiet + 1 : 0;
    }
  } finally {
    await c.end();
  }
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };
async function run(side: Side, c: Case, seed: number): Promise<Outcome> {
  process.env.POSTGRES_URL = side.url;
  // Only the "rls" copy runs as the app's role; it stays set while that copy's after() work drains.
  process.env.TENANT_SCOPE = side.name === "rls" ? "enforce" : "off";
  resetRandom(seed);
  try {
    const fn = side.m[c.mod][c.fn];
    const args = typeof c.args === "function" ? await c.args(side) : (c.args ?? []);
    resetRandom(seed);
    const value = await fn(...args);
    return { ok: true, value: normalize(value) };
  } catch (err) {
    const e = err as { name?: string; message?: string; code?: string };
    return { ok: false, error: normalize({ name: e?.name, message: e?.message, code: e?.code }) };
  }
}

// ---------------------------------------------------------------------------
// Fixture values (synthetic people; see seed.sql).
// ---------------------------------------------------------------------------
const MIA = 3;
const MIA_EMAIL = "mia.member@golden.test";
const PETE = 4;
const fx = { nextFri: "", nextWed: "", lastFri: "", lastWed: "", today: "" };
const range = (period = "all") => ({ period, key: period, start: null as string | null, end: null as string | null });
const player = async (s: Side, id = MIA) => s.m["player-db"].getPlayerById(id);
const member = async (s: Side, email = MIA_EMAIL) => s.m["membership-self-service"].getCurrentMembership(email);
const world = async (s: Side) => s.m["arena-db"].loadWorld({ skipSync: true });
const caller = { playerId: MIA, email: MIA_EMAIL, scopes: ["me:read", "stats:read", "attendance:write"] };
const filters = { preset: "all", from: null, to: null, kind: null, category: null, method: null, q: "", sort: "date-desc" };
const cookieReader = (token?: string) => (name: string) => (name === "tw_player" ? token : undefined);
const checkerWeights = (n: number) => ({ v: 1, w1: Array.from({ length: 16 * 151 }, (_, i) => ((i % 7) - 3) / 10), b1: Array(16).fill(0.1), w2: Array(16).fill(0.2), b2: 0.3, n });
const request = (headers: Record<string, string> = {}) => new Request("http://localhost/api/test", { headers });

// ---------------------------------------------------------------------------
// The cases, in order. Reads first, then writes (both sides stay in step).
// ---------------------------------------------------------------------------
function cases(): Case[] {
  const R: Case[] = [
    // db.ts (core: play days, bookings, memberships)
    { mod: "db", fn: "getAvailableSpots", args: () => [fx.nextFri] },
    { mod: "db", fn: "getAvailableSpots", args: () => [fx.nextWed, { ignoreLock: true }], label: "ignoreLock" },
    { mod: "db", fn: "getSpotsAndHeadcountForDates", args: () => [[fx.nextFri, fx.nextWed, fx.lastFri]] },
    { mod: "db", fn: "sessionExists", args: () => [fx.nextFri] },
    { mod: "db", fn: "listSessionsInRange", args: () => [fx.lastWed, fx.nextFri] },
    { mod: "db", fn: "listMemberMiniGameDates", args: () => ["friday", fx.lastWed, fx.nextFri] },
    { mod: "db", fn: "getUpcomingSessionDates", args: [30] },
    { mod: "db", fn: "listAllSessionDates" },
    { mod: "db", fn: "getActiveMemberCountForDate", args: () => [fx.nextFri] },
    { mod: "db", fn: "getTotalActiveMemberCount" },
    { mod: "db", fn: "countFailedMemberPayments" },
    { mod: "db", fn: "getSessionHeadcount", args: () => [fx.nextFri] },
    { mod: "db", fn: "isRegistrationLocked", args: () => [fx.nextWed] },
    { mod: "db", fn: "isMiniGameDay", args: () => [fx.nextWed] },
    { mod: "db", fn: "getCourtsForDate", args: () => [fx.nextFri] },
    { mod: "db", fn: "getSessionAlertState", args: () => [fx.lastFri] },
    { mod: "db", fn: "getWaitlistForDate", args: () => [fx.nextWed] },
    { mod: "db", fn: "getUnnotifiedWaitlistForDate", args: () => [fx.nextWed, 5] },
    { mod: "db", fn: "getRosterForDate", args: () => [fx.nextFri] },
    { mod: "db", fn: "getRosterForDate", args: () => [fx.lastFri], label: "past" },
    { mod: "db", fn: "listMemberships" },
    { mod: "db", fn: "getMembershipById", args: [1] },
    { mod: "db", fn: "listActiveMembershipsByEmail", args: ["PLAYER4@golden.test"] },
    { mod: "db", fn: "getMembersWithPlayDayTomorrow", args: () => [fx.nextFri] },
    { mod: "db", fn: "getRemainingSessionDatesInPeriod", args: () => [fx.today, fx.nextFri, "friday"] },
    { mod: "db", fn: "getCasualBookingsForDate", args: () => [fx.nextFri] },
    { mod: "db", fn: "getOneTimeMembershipsDueForRenewalReminder", args: () => [fx.today, fx.nextFri] },
    { mod: "db", fn: "getMembershipByRenewalToken", args: ["renew-golden-5"] },
    { mod: "db", fn: "getActiveRenewalOf", args: [3] },
    { mod: "db", fn: "hasLaterMembership", args: async (s) => [await s.m.db.getMembershipById(3)] },
    { mod: "db", fn: "getStaleRecurringMemberships", args: () => [fx.today] },
    { mod: "db", fn: "listRecentlyEndedMemberships", args: () => [fx.lastWed] },
    { mod: "db", fn: "listMembershipsForStripeSync" },
    { mod: "db", fn: "firstMembershipDayOnOrAfter", args: () => [fx.today, "wednesday"] },
    // player-db
    { mod: "player-db", fn: "getPlayerById", args: [MIA] },
    { mod: "player-db", fn: "getPlayerById", args: [25], label: "deleted" },
    { mod: "player-db", fn: "getPlayerByEmail", args: ["  Mia.Member@GOLDEN.test "] },
    { mod: "player-db", fn: "getPlayerByVerifiedPhone", args: ["+64215550006"] },
    { mod: "player-db", fn: "latestDetailsForEmail", args: ["player4@golden.test"] },
    { mod: "player-db", fn: "getPlayerSetting", args: ["golden_flag"] },
    { mod: "player-db", fn: "listActiveMemberEmails" },
    { mod: "player-db", fn: "previewMemberImport" },
    { mod: "player-db", fn: "listPlayersForAdmin" },
    { mod: "player-db", fn: "listPlayersForAdmin", args: ["golden1"], label: "search" },
    { mod: "player-db", fn: "countWelcomePending" },
    { mod: "player-db", fn: "listWelcomePending", args: [10] },
    // player-auth
    { mod: "player-auth", fn: "sessionForToken", args: ["no-such-token"] },
    { mod: "player-auth", fn: "getPlayerFromRequest", args: [request({ cookie: "tw_player=nope" })] },
    // stats-db
    { mod: "stats-db", fn: "listAttendanceForDate", args: () => [fx.lastFri] },
    { mod: "stats-db", fn: "listUnverifiedAttendance" },
    { mod: "stats-db", fn: "boardPlayerId", args: [MIA_EMAIL] },
    { mod: "stats-db", fn: "listMinigameNameMatches" },
    { mod: "stats-db", fn: "getStatsBackfillPreview" },
    { mod: "stats-db", fn: "getLeaderboard", args: ["attendance", range()] },
    { mod: "stats-db", fn: "getLeaderboard", args: ["rr", range(), 7], label: "rr incl hidden" },
    { mod: "stats-db", fn: "getPlayerStats", args: [{ id: PETE, email: "player4@golden.test", minigameName: "MG4" }] },
    { mod: "stats-db", fn: "listAbsences", args: () => [MIA_EMAIL, fx.today] },
    { mod: "stats-db", fn: "getQuickStats", args: [{ id: MIA, email: MIA_EMAIL }] },
    // arena
    { mod: "arena-db", fn: "loadWorld", args: [{ skipSync: true }] },
    { mod: "arena-db", fn: "loadWorldCached", args: [0] },
    { mod: "arena-db", fn: "historyFor", args: async (s) => [await world(s), PETE] },
    { mod: "arena-db", fn: "achievementsOf", args: async (s) => [await world(s), PETE, null] },
    { mod: "arena-db", fn: "pairRecord", args: async (s) => [await world(s), 1] },
    { mod: "arena-db", fn: "headToHead", args: async (s) => [await world(s), [4, 5], [6, 7]] },
    { mod: "arena-db", fn: "loadWorld", args: [{ skipSync: true }], label: "again" },
    { mod: "arena-db", fn: "avgRank", args: async (s) => [await world(s), [4, 5]] },
    { mod: "arena-db", fn: "bonusesOnOffer", args: async (s) => [await world(s), [4, 5], [8, 9]] },
    { mod: "arena-db", fn: "packLeader", args: async (s) => [await world(s)] },
    { mod: "arena-db", fn: "seasonChampion", args: async (s) => [await world(s)] },
    { mod: "arena-db", fn: "acceptBlocker", args: async (s) => { const w = await world(s); return [w, w.challenges.find((c: { id: number }) => c.id === 3), 8]; } },
    { mod: "arena-db", fn: "getPointsBoard", args: ["all", range()] },
    { mod: "arena-db", fn: "getPointsBoard", args: ["challenges", range(), 7], label: "challenges" },
    { mod: "arena-db", fn: "getRankBadges" },
    { mod: "arena-db", fn: "liveMatchFor", args: [8] },
    { mod: "arena-db", fn: "countArenaActions", args: [6] },
    { mod: "arena-db", fn: "countDisputes" },
    { mod: "arena-db", fn: "arenaExport", args: [PETE] },
    { mod: "arena-state", fn: "buildArenaState", args: [{ id: PETE }, { maxAgeMs: 0 }] },
    { mod: "arena-state", fn: "buildArenaState", args: [null, { maxAgeMs: 0 }], label: "anonymous" },
    { mod: "match-stats-db", fn: "loadMatchSetup", args: [1] },
    { mod: "match-stats-db", fn: "loadMatchStats", args: [1] },
    // messages, photos, shop, jersey
    { mod: "messages-db", fn: "listThreadsForPlayer", args: [MIA] },
    { mod: "messages-db", fn: "getThreadForPlayer", args: [MIA, 1] },
    { mod: "messages-db", fn: "getThreadForPlayer", args: [MIA, 2], label: "not theirs" },
    { mod: "messages-db", fn: "listThreadsForAdmin" },
    { mod: "messages-db", fn: "listThreadsForAdmin", args: ["all"], label: "all" },
    { mod: "messages-db", fn: "countUnreadForAdmin" },
    { mod: "messages-db", fn: "getThreadForAdmin", args: [2] },
    { mod: "photos-db", fn: "countPhotosToday", args: [MIA] },
    { mod: "photos-db", fn: "listPhotosForPlayer", args: [MIA] },
    { mod: "photos-db", fn: "listGalleryPhotos" },
    { mod: "photos-db", fn: "listPhotosForAdmin", args: ["review"] },
    { mod: "photos-db", fn: "listPhotosForAdmin", args: ["approved"], label: "approved" },
    { mod: "photos-db", fn: "countPhotosNeedingReview" },
    { mod: "photos-db", fn: "getPhotoById", args: [2] },
    { mod: "photos-db", fn: "photoStorageBytes" },
    { mod: "shop-db", fn: "listShopProductsForPlayer" },
    { mod: "shop-db", fn: "listProductsForAdmin" },
    { mod: "shop-db", fn: "listOrdersForPlayer", args: [MIA] },
    { mod: "shop-db", fn: "listOrdersForAdmin", args: ["all"] },
    { mod: "shop-db", fn: "countShopOrdersToHandOver" },
    { mod: "shop-db", fn: "listOrdersForAdmin", args: ["open"], label: "open" },
    { mod: "shop-db", fn: "getOrder", args: [1] },
    { mod: "shop-db", fn: "cashOrdersExpiringSoon" },
    { mod: "shop-db", fn: "cashHoldUntil", args: ["player4@golden.test"] },
    { mod: "shop-db", fn: "getProduct", args: [1] },
    { mod: "jersey-db", fn: "earlyBirdsLeft" },
    { mod: "jersey-db", fn: "listJerseyRegistrations" },
    { mod: "jersey-db", fn: "getJerseyRegistration", args: [1] },
    // finance and bank
    { mod: "finance-db", fn: "listFinanceEntries", args: [filters] },
    { mod: "finance-db", fn: "listFinanceEntries", args: [{ ...filters, kind: "spent", q: "Entry 1" }], label: "filtered" },
    { mod: "finance-db", fn: "getFinanceTotals", args: [filters, { from: null, to: null }] },
    { mod: "finance-db", fn: "getCategoryBreakdown", args: [filters] },
    { mod: "finance-db", fn: "getMonthlyTotals", args: [filters, { from: null, to: null }] },
    { mod: "finance-db", fn: "getEarliestEntryDate" },
    { mod: "finance-db", fn: "getManualEntry", args: [1] },
    { mod: "finance-db", fn: "getEntryReceipt", args: [1] },
    { mod: "finance-db", fn: "listKnownPeople" },
    { mod: "finance-db", fn: "getSyncState", args: ["stripe"] },
    { mod: "bank-db", fn: "getOpeningBalances" },
    { mod: "bank-db", fn: "countBankToReconcile" },
    { mod: "bank-db", fn: "getReportedBankBalance" },
    { mod: "bank-db", fn: "listBankRules" },
    { mod: "bank-db", fn: "getBankSuggestions" },
    { mod: "bank-db", fn: "getOfflinePaymentReconciliation", args: [["in_golden_1"]] },
    { mod: "bank-db", fn: "getBankTransaction", args: [4] },
    { mod: "bank-db", fn: "listBankTransactions", args: [{}] },
    { mod: "bank-db", fn: "listBankTransactions", args: [{ status: "unmatched", limit: 5 }], label: "unmatched" },
    { mod: "bank-db", fn: "findMatchCandidates", args: () => [1148, fx.today] },
    { mod: "bank-db", fn: "getEntriesByIds", args: [[1, 2, 3]] },
    { mod: "bank-db", fn: "listEntriesMissingFromBank", args: [null] },
    { mod: "bank-db", fn: "getFundsSummary" },
    { mod: "bank-db", fn: "getFundsAt", args: () => [fx.today] },
    // other areas
    { mod: "casual-play-db", fn: "getCasualPlayState", args: () => [fx.nextFri] },
    { mod: "mini-game-db", fn: "getMiniGameState" },
    { mod: "day-requests", fn: "getPausedDays" },
    { mod: "day-requests", fn: "isDayPaused", args: ["monday"] },
    { mod: "day-requests", fn: "isSessionDatePaused", args: () => [fx.nextFri] },
    { mod: "day-requests", fn: "listDayRequests" },
    { mod: "day-requests", fn: "getPendingDayRequests", args: ["monday"] },
    { mod: "membership-self-service", fn: "getCurrentMembership", args: [MIA_EMAIL] },
    { mod: "membership-self-service", fn: "getCurrentMembership", args: ["player5@golden.test"], label: "one-time" },
    { mod: "membership-self-service", fn: "playDaysLeft", args: async (s) => [await member(s)] },
    { mod: "membership-self-service", fn: "stripeCustomerFor", args: async (s) => [await player(s)] },
    { mod: "membership-self-service", fn: "getBilling", args: async (s) => [await player(s), await member(s)] },
    { mod: "membership-self-service", fn: "listRecentFeedback" },
    { mod: "me-data", fn: "calendarFor", args: async (s) => [MIA_EMAIL, await member(s), ["monday"]] },
    { mod: "me-data", fn: "nextUp", args: async (s) => [await s.m["me-data"].calendarFor(MIA_EMAIL, await member(s), [])] },
    { mod: "profile-badges", fn: "getProfileBadges", args: [MIA] },
    { mod: "player-export", fn: "collectPlayerData", args: async (s) => [await player(s)] },
    { mod: "wolf-vision-db", fn: "usablePass", args: [MIA, "upload"] },
    { mod: "wolf-vision-db", fn: "latestModel", args: ["checker"] },
    { mod: "webhooks", fn: "listApiTokens", args: [MIA] },
    { mod: "webhooks", fn: "authenticateToken", args: ["tw_gold_not_a_real_token"] },
    { mod: "webhooks", fn: "listWebhookEndpoints", args: [MIA] },
    { mod: "api-v1", fn: "requireScope", args: [request({ authorization: "Bearer tw_nope" }), "me:read"] },
    { mod: "api-v1", fn: "meData", args: [caller] },
    { mod: "api-v1", fn: "attendanceData", args: () => [caller, fx.lastWed, fx.today] },
    { mod: "api-v1", fn: "roundRobinData", args: [caller] },
    { mod: "api-v1", fn: "statsData", args: [caller] },
    { mod: "api-v1", fn: "leaderboardData", args: ["attendance", "all"] },
    { mod: "api-v1", fn: "upcomingSessionsData", args: [30] },
    { mod: "api-v1", fn: "myUpcomingPlayDays", args: [caller] },
    { mod: "admin-access", fn: "adminContextFromCookies", args: [cookieReader("nope")] },
    { mod: "admin-access", fn: "resolveAdmin", args: [cookieReader(undefined), "/admin/play-days"] },
    { mod: "sms", fn: "smsFreeLimit" },
    { mod: "sms", fn: "isSmsSwitchedOn" },
    { mod: "sms", fn: "getSmsUsage" },
    { mod: "sms", fn: "isSmsAvailable" },
  ];

  const W: Case[] = [
    // Sign-in (codes go to the captured outbox outside production).
    { mod: "player-auth", fn: "issueEmailCode", args: [" Mia.Member@golden.test", "127.0.0.9"] },
    { mod: "player-auth", fn: "verifyEmailCode", args: [MIA_EMAIL, "000000"] },
    { mod: "player-auth", fn: "verifyLinkToken", args: ["not-a-link-token"] },
    { mod: "player-auth", fn: "createPlayerSession", args: [PETE, "golden-agent"] },
    { mod: "player-auth", fn: "endPlayerSession", args: ["no-such-token"] },
    { mod: "player-auth", fn: "endSessionFromRequest", args: [request()] },
    // Players
    { mod: "player-db", fn: "ensurePlayerForEmail", args: ["New.Person@golden.test", { via: "signup", details: { firstName: "New", lastName: "Person", phone: null } }] },
    { mod: "player-db", fn: "linkMemberAccount", args: ["no-account@golden.test", { firstName: "Nobody", lastName: "Account", phone: null }] },
    { mod: "player-db", fn: "updatePlayerProfile", args: [PETE, { firstName: "Peter", lastName: "Golden4", displayName: null, phone: "021 555 0004", lang: "vi" }] },
    { mod: "player-db", fn: "setLeaderboardVisible", args: [7, true] },
    { mod: "player-db", fn: "markPhoneVerified", args: [9, "+64215550009"] },
    { mod: "player-db", fn: "markClaimed", args: [8] },
    { mod: "player-db", fn: "recordPlayerEvent", args: [MIA, "golden", "detail"] },
    { mod: "player-db", fn: "setPlayerSetting", args: ["golden_flag", "no"] },
    { mod: "player-db", fn: "ensureOptOutToken", args: [10] },
    { mod: "player-db", fn: "markWelcomeSent", args: [10] },
    { mod: "player-db", fn: "setPlayerAvatar", args: [10, "https://blob.test/a/10"] },
    { mod: "player-db", fn: "changePlayerEmail", args: [11, "Player11.New@golden.test"] },
    { mod: "player-db", fn: "changePlayerEmail", args: [12, MIA_EMAIL], label: "taken" },
    { mod: "player-db", fn: "runMemberImport" },
    { mod: "player-auth", fn: "endAllPlayerSessions", args: [12] },
    // Play days
    { mod: "db", fn: "ensureSession", args: () => [fx.nextFri] },
    { mod: "db", fn: "upsertSessionFromCalendar", args: () => [fx.nextWed, { id: "golden-new", summary: "Moved", start: `${fx.nextWed}T19:30:00+13:00`, end: `${fx.nextWed}T21:30:00+13:00`, location: "Hall 2" }] },
    { mod: "db", fn: "setRegistrationLocked", args: () => [fx.nextFri, true] },
    { mod: "db", fn: "setMiniGameDay", args: () => [fx.nextFri, true] },
    { mod: "db", fn: "setCourtsForDate", args: () => [fx.nextFri, 5] },
    { mod: "db", fn: "upsertSessionAlertState", args: () => [fx.nextFri, "low", 6] },
    { mod: "db", fn: "markWaitlistNotified", args: [[1]] },
    { mod: "db", fn: "deleteWaitlistEntry", args: [2] },
    { mod: "db", fn: "saveSessionFillIn", args: () => [fx.nextWed, { membershipId: 2 }, { firstName: "Sub", lastName: "Player", email: "sub@golden.test", phone: null }] },
    { mod: "db", fn: "removeSessionFillIn", args: () => [fx.nextWed, { membershipId: 2 }] },
    { mod: "db", fn: "reserveBookingSlot", args: () => [fx.nextWed, { firstName: "Casual", lastName: "Guest", email: "casual@golden.test", phone: null, paymentIntentId: "pi_golden_new" }] },
    { mod: "db", fn: "reserveBookingSlotOnce", args: () => [fx.nextWed, { firstName: "Casual", lastName: "Guest", email: "casual@golden.test", phone: null, paymentIntentId: "pi_golden_new" }], label: "the same payment again" },
    { mod: "db", fn: "removeBooking", args: () => [1, fx.lastWed] },
    { mod: "db", fn: "claimBookingReminder", args: [2] },
    { mod: "db", fn: "claimMembershipReminder", args: () => [1, fx.nextFri] },
    // Memberships
    { mod: "db", fn: "assignAndReserveMembershipAccessStart", args: ["monthly", "wednesday", { email: "new.member@golden.test", firstName: "New", lastName: "Member", phone: null, recurring: true }] },
    { mod: "db", fn: "attachStripeIdToMembership", args: [7, { stripePaymentIntentId: "pi_golden_attach" }] },
    { mod: "db", fn: "activateMembershipByPaymentIntentId", args: ["pi_golden_attach"] },
    { mod: "db", fn: "activateMembershipBySubscriptionId", args: ["sub_golden_none"] },
    { mod: "db", fn: "setMembershipCancelAtPeriodEnd", args: [2] },
    { mod: "db", fn: "applyMembershipRenewal", args: ["sub_golden_mia", "in_golden_renew"] },
    { mod: "db", fn: "applyMembershipRenewal", args: ["sub_golden_mia", "in_golden_renew"], label: "again (idempotent)" },
    { mod: "db", fn: "claimRenewalReminder", args: [7, "renew-golden-7"] },
    { mod: "db", fn: "releaseRenewalReminder", args: [7] },
    { mod: "db", fn: "recordFreeDays", args: [1, 7, true] },
    { mod: "db", fn: "expireLapsedOneTimeMemberships", args: () => [fx.today] },
    { mod: "db", fn: "syncRecurringMembership", args: () => [6, "canceled", false, fx.today] },
    { mod: "db", fn: "updateMembershipFromStripe", args: [2, { status: "active", cancelAtPeriodEnd: false }] },
    { mod: "db", fn: "insertMembershipFromStripe", args: () => [{ email: "stripe.only@golden.test", firstName: "Stripe", lastName: "Only", phone: null, plan: "monthly", day: "friday", periodStart: fx.today, periodEnd: fx.nextFri, status: "active", stripeSubscriptionId: "sub_golden_new", recurring: true }] },
    { mod: "db", fn: "cancelMembershipImmediately", args: [6] },
    // Attendance and stats
    { mod: "stats-db", fn: "recordAttendance", args: () => [fx.lastFri, [MIA_EMAIL, "Player20@golden.test", "guest.only@golden.test"], "admin"] },
    { mod: "stats-db", fn: "removeAttendance", args: () => [fx.lastFri, "player20@golden.test"] },
    { mod: "stats-db", fn: "confirmAttendance", args: () => [fx.lastFri, "player11@golden.test"] },
    { mod: "stats-db", fn: "recordBoardAttendance", args: () => [fx.lastWed, [{ id: "p1", games: 3, guest: false }, { id: "g1", games: 1, guest: true }], [{ id: "p1", email: "player14@golden.test" }]] },
    { mod: "stats-db", fn: "storeDrawResults", args: [1] },
    { mod: "stats-db", fn: "setMinigameName", args: ["MG13", 13] },
    { mod: "stats-db", fn: "recordRosterAttendance" },
    { mod: "stats-db", fn: "syncRosterAttendance", args: [true] },
    { mod: "stats-db", fn: "runStatsBackfill" },
    { mod: "stats-db", fn: "setAbsence", args: () => [fx.nextWed, "player4@golden.test", true] },
    { mod: "stats-db", fn: "setAbsence", args: () => [fx.nextFri, MIA_EMAIL, false], label: "back in" },
    // Arena
    { mod: "arena-db", fn: "syncPoints" },
    { mod: "arena-db", fn: "recalculateAllPoints" },
    { mod: "arena-db", fn: "tick", args: [true] },
    { mod: "arena-db", fn: "createPairCode", args: [12] },
    { mod: "arena-db", fn: "enterPairCode", args: [13, "000000"] },
    { mod: "arena-db", fn: "cancelPairRequest", args: [12] },
    { mod: "arena-db", fn: "respondPairRequest", args: [12, false] },
    { mod: "arena-db", fn: "createPairInvite", args: [14] },
    { mod: "arena-db", fn: "joinPairInvite", args: [15, "not-an-invite"] },
    { mod: "arena-db", fn: "renamePair", args: [6, "Sixes"] },
    { mod: "arena-db", fn: "postChallenge", args: [8, 2, "evening game?"] },
    { mod: "arena-db", fn: "cancelChallenge", args: [6, 3] },
    { mod: "arena-db", fn: "acceptChallenge", args: [4, 3] },
    { mod: "arena-db", fn: "checkInNow", args: [10, 4] },
    { mod: "arena-db", fn: "enterScore", args: [10, 4, { posting: 21, accepting: 18 }] },
    { mod: "arena-db", fn: "confirmScore", args: [8, 4] },
    { mod: "arena-db", fn: "disputeScore", args: [8, 4, "wrong"] },
    { mod: "arena-db", fn: "callOffChallenge", args: [10, 4] },
    { mod: "arena-db", fn: "answerAfterGame", args: [5, 1, true, false] },
    { mod: "arena-db", fn: "markRankSeen", args: [PETE] },
    { mod: "arena-db", fn: "syncPlayerRank", args: async (s) => [await world(s), PETE] },
    { mod: "arena-db", fn: "adminResolve", args: [5, "as_entered", "checked the video"] },
    { mod: "arena-db", fn: "invalidateWorld" },
    { mod: "arena-db", fn: "leavePair", args: [11] },
    { mod: "arena-db", fn: "endPlayerArena", args: [9] },
    { mod: "match-stats-db", fn: "saveMatchStats", args: [{ id: 4 }, { challengeId: 1, mode: "upload", duration: 600, rallies: 30, longestRally: 12, avgRallyShots: 5, fastestShotKmh: null, players: [] }] },
    { mod: "match-stats-db", fn: "heartbeatTracking", args: [{ id: 4 }, { challengeId: 1, kind: "beat", rallies: 3, hits: 10, quality: 0.5 }] },
    // Messages and photos
    { mod: "messages-db", fn: "createThread", args: [{ playerId: PETE, subject: "Golden question", body: "Hello?", startedBy: "player" }] },
    { mod: "messages-db", fn: "addPlayerMessage", args: [MIA, 1, "Thanks!"] },
    { mod: "messages-db", fn: "addAdminMessage", args: [2, "All sorted."] },
    { mod: "messages-db", fn: "setThreadStatus", args: [2, "closed"] },
    { mod: "photos-db", fn: "insertPhoto", args: [{ playerId: MIA, originalUrl: "https://blob.test/o/new", displayUrl: "https://blob.test/d/new", thumbUrl: "https://blob.test/t/new", width: 800, height: 600, bytes: 1234, caption: "New", consent: true }] },
    { mod: "photos-db", fn: "setPhotoModeration", args: [2, "approved", { adult: "VERY_UNLIKELY" }] },
    { mod: "photos-db", fn: "adminSetPhotoStatus", args: [3, "hidden"] },
    { mod: "photos-db", fn: "adminSetFeatured", args: [4, true] },
    { mod: "photos-db", fn: "deletePlayerPhoto", args: [6, 3] },
    // Shop
    { mod: "shop-db", fn: "createOrder", args: [{ playerId: 6, email: "player6@golden.test", name: "Rua Golden6", variantId: 3, method: "cash", cashHoldUntil: new Date("2030-01-01T00:00:00Z") }] },
    { mod: "shop-db", fn: "attachPaymentIntent", args: [3, "pi_golden_shop3b"] },
    { mod: "shop-db", fn: "markOrderPaidByCard", args: [3] },
    { mod: "shop-db", fn: "markCashPaidAndCollected", args: [2, "in_golden_cash"] },
    { mod: "shop-db", fn: "markCollected", args: [1] },
    { mod: "shop-db", fn: "cancelOrder", args: [4, 6] },
    { mod: "shop-db", fn: "markRefunded", args: [1] },
    { mod: "shop-db", fn: "releaseExpiredHolds" },
    { mod: "shop-db", fn: "markReminderSent", args: [2] },
    { mod: "shop-db", fn: "setVariantStock", args: [2, 9] },
    { mod: "shop-db", fn: "saveProduct", args: [{ nameEn: "Socks", nameVi: "Tất", descEn: "Warm", descVi: "Ấm", priceCents: 1200, hasFit: false, hasSizes: false, active: true, sort: 4, images: [] }] },
    { mod: "shop-db", fn: "setSizeChart", args: [1, "men", "https://blob.test/chart"] },
    // Jersey
    { mod: "jersey-db", fn: "releaseExpired" },
    { mod: "jersey-db", fn: "registerJersey", args: [{ firstName: "Zoe", lastName: "Golden14", email: "player14@golden.test", emailNormalized: "player14@golden.test", phone: "021 555 0014", phoneNormalized: "0215550014", nameNormalized: "zoe golden14", size: "S", printName: "ZOE", printNumber: 14, printCountry: null, lang: "en", ipHash: "iph", deviceId: "dev", flags: [] }] },
    { mod: "jersey-db", fn: "createJerseyByAdmin", args: [{ firstName: "Free", lastName: "Shirt", email: "free@golden.test", phone: "021 555 0099", size: "XL", printName: null, printNumber: null, printCountry: null, payment: "free", priceMode: "auto", lang: "en" }] },
    { mod: "jersey-db", fn: "updateJerseyRegistration", args: [2, { firstName: "Pete", lastName: "Golden4", email: "player4@golden.test", phone: "021 555 0004", size: "XL", printName: "PETE", printNumber: 4, printCountry: "NZ" }] },
    { mod: "jersey-db", fn: "markJerseyPaid", args: [2, 5000] },
    { mod: "jersey-db", fn: "markJerseyUnpaid", args: [2] },
    { mod: "jersey-db", fn: "setJerseyStatus", args: [2, "cancelled"] },
    { mod: "jersey-db", fn: "matchJerseyPayments" },
    { mod: "jersey-db", fn: "matchAndNotifyJersey" },
    // Finance and bank
    { mod: "finance-db", fn: "createManualEntry", args: () => [{ kind: "spent", name: "Shuttles", category: "shuttles", method: "card", person: null, entryDate: fx.today, amountCents: 4599, notes: "golden" }] },
    { mod: "finance-db", fn: "updateManualEntry", args: () => [2, { kind: "received", name: "Entry 2 (edited)", category: "casual", method: "cash", person: "Person 2", entryDate: fx.lastWed, amountCents: 1074, notes: null }] },
    { mod: "finance-db", fn: "setEntryReceipt", args: [2, { url: "https://blob.test/r/2", access: "private", contentType: "image/jpeg" }] },
    { mod: "finance-db", fn: "deleteManualEntry", args: [5] },
    { mod: "finance-db", fn: "upsertStripeLines", args: () => [[{ externalId: "ch_golden_new", kind: "received", name: "Membership", category: "membership", method: "card", person: "Mia", entryDate: fx.today, amountCents: 6000, externalUrl: null }]] },
    { mod: "finance-db", fn: "markSyncSucceeded", args: [["stripe", new Date("2026-11-20T00:00:00Z")]].flat() },
    { mod: "finance-db", fn: "markSyncFailed", args: ["akahu", "golden failure"] },
    { mod: "bank-db", fn: "setOpeningBalances", args: [{ date: "2026-02-01", bankCents: 120000, cashCents: 3000 }] },
    { mod: "bank-db", fn: "setReportedBankBalance", args: () => [{ cents: 543210, asOf: fx.today, account: "12-3456-7890123-00", source: "csv" }] },
    { mod: "bank-db", fn: "insertBankTransactions", args: () => [[{ externalId: "bank-golden-new", account: null, date: fx.today, description: "NEW LINE", reference: null, amountCents: 2500, balanceCents: null }], "csv"].reverse() },
    { mod: "bank-db", fn: "upsertStripePayouts", args: () => [[{ id: "po_golden_2", amountCents: 999, createdDate: fx.lastWed, arrivalDate: fx.today, status: "paid" }]] },
    { mod: "bank-db", fn: "matchBankLine", args: [4, [4]] },
    { mod: "bank-db", fn: "setBankTransactionStatus", args: [5, "ignored"] },
    { mod: "bank-db", fn: "learnBankRule", args: ["BANK LINE 6", 1222, { action: "classify", status: "ignored" }] },
    { mod: "bank-db", fn: "setBankRuleAuto", args: [2, true] },
    { mod: "bank-db", fn: "applyBankRule", args: [6, 1] },
    { mod: "bank-db", fn: "markStripePayout", args: [7, "po_golden_1"] },
    { mod: "bank-db", fn: "autoMatchBankTransactions" },
    { mod: "bank-db", fn: "deleteBankRule", args: [2] },
    // Other areas
    { mod: "casual-play-db", fn: "runCasualPlayAction", args: () => [fx.nextFri, { type: "addGuest", name: "Golden Guest", tier: null }] },
    { mod: "casual-play-db", fn: "runCasualPlayAction", args: () => [fx.nextFri, { type: "setCourts", courts: 3 }], label: "courts" },
    { mod: "mini-game-db", fn: "createDraw" },
    { mod: "mini-game-db", fn: "lockScore", args: [2, "m1", 21, 12] },
    { mod: "day-requests", fn: "setDayPaused", args: ["friday", true] },
    { mod: "day-requests", fn: "addDayRequest", args: ["monday", "Another Fan", "fan2@golden.test"] },
    { mod: "day-requests", fn: "markDayRequestsNotified", args: [[1]] },
    { mod: "day-requests", fn: "deleteDayRequest", args: [2] },
    { mod: "membership-self-service", fn: "recordFeedback", args: [MIA, 1, "downgrade", "price", null] },
    { mod: "membership-self-service", fn: "syncPlanFromSubscriptionMetadata", args: ["sub_golden_4", { plan: "monthly", day: "wednesday" }] },
    { mod: "membership-self-service", fn: "resumeMembership", args: async (s) => [await member(s, "player4@golden.test")] },
    { mod: "wolf-vision-db", fn: "createPass", args: [MIA, "live", { test: true, challengeId: null }] },
    { mod: "wolf-vision-db", fn: "attachStripeSession", args: [3, "cs_golden_3"] },
    { mod: "wolf-vision-db", fn: "markPassPaid", args: ["cs_golden_3"] },
    { mod: "wolf-vision-db", fn: "consumePass", args: [MIA, 1] },
    { mod: "wolf-vision-db", fn: "saveLabels", args: [MIA, { videoName: "game.mp4", duration: 60, hits: [{ t: 1.5, player: 0, rally: 1 }] }] },
    { mod: "wolf-vision-db", fn: "submitCheckerUpdate", args: async (s) => { const base = (await s.m["wolf-vision-db"].latestModel("checker"))?.weights ?? checkerWeights(0); return [MIA, base, { kind: "checker", weights: checkerWeights(1), n: 1 }]; } },
    { mod: "match-stats-db", fn: "saveMatchStats", label: "live game", args: [{ id: 10 }, { challengeId: 4, mode: "live", duration: 300, rallies: 10, longestRally: 8, avgRallyShots: 4, fastestShotKmh: 120, players: [10, 11, 8, 9].map((id, i) => ({ playerId: id, hits: 10 + i, distance: 900 + i, topSpeed: 5 + i })) }] },
    { mod: "webhooks", fn: "createApiToken", args: [PETE, "Golden key", ["me:read"]] },
    { mod: "webhooks", fn: "revokeApiToken", args: [MIA, 1] },
    { mod: "webhooks", fn: "createWebhookEndpoint", args: [PETE, "https://hooks.golden.test/b", ["attendance.recorded"]] },
    { mod: "webhooks", fn: "deleteWebhookEndpoint", args: [MIA, 1] },
    { mod: "webhooks", fn: "emitToPlayers", args: [[MIA_EMAIL], "attendance.recorded", () => ({ ok: true })] },
    { mod: "webhooks", fn: "retryWebhookDeliveries", args: [5] },
    { mod: "api-v1", fn: "logActivity", args: () => [caller, fx.lastFri] },
    { mod: "sms", fn: "setSmsSwitch", args: [true] },
    { mod: "sms", fn: "verifySmsCode", args: ["no-session", "123456"] },
    { mod: "player-merge", fn: "mergeMembers", args: ["player15@golden.test", "player16@golden.test", false] },
    { mod: "player-merge", fn: "mergeMembers", args: ["player15@golden.test", "player16@golden.test", true], label: "apply" },
    { mod: "player-db", fn: "deletePlayerAccount", args: [17] },
  ];
  return [...R, ...W];
}

// Exported functions with no database work of their own, or that need a
// request context / external service the test can't provide. Each has a
// reason; anything else exported must have a case above.
const NOT_COVERED: Partial<Record<ModName, Record<string, string>>> = {
  db: {
    memberNotAbsentSql: "builds SQL text only",
    membershipCoversDateSql: "builds SQL text only",
    projectedPeriodEndSql: "builds SQL text only",
    addDays: "date arithmetic only",
    claimSessionSpot: "takes a transaction's connection; run through reserveBookingSlotOnce (covered) and on its own in tests/session-spot.test.ts",
    releaseSessionSpot: "takes a connection; run through removeBooking (covered) and on its own in tests/session-spot.test.ts",
  },
  "player-db": { defaultDisplayName: "string helper", mapPlayer: "row mapper", normalizeAccountEmail: "string helper", toE164: "re-exported phone helper" },
  "player-auth": {
    sha256: "hash helper",
    hmac: "hash helper",
    playerCookieOptions: "cookie options only",
    safeNextPath: "re-exported URL helper",
    getCurrentPlayer: "needs a Next.js request (cookies()); same path as getPlayerFromRequest (covered)",
  },
  "stats-db": {

    computeStreaks: "re-exported pure helper",
    periodFromKey: "re-exported pure helper",
    periodRange: "re-exported pure helper",
    weekKey: "re-exported pure helper",
  },
  "arena-db": { nzEndOfDay: "date helper" },
  "messages-db": {},
  "photos-db": {},
  "shop-db": { endOfClubDay: "date helper" },
  "jersey-db": {},
  "finance-db": {},
  "bank-db": { isBankStatus: "value check only" },
  "casual-play-db": {},
  "mini-game-db": {},
  "day-requests": { isWeekday: "value check only" },
  "membership-self-service": {
    formatNzDate: "date formatting only",
    cardUpdatePortalUrl: "Stripe only (no database)",
    scheduleChangeAtRenewal: "Stripe subscription schedule (needs live Stripe)",
    cancelPendingChange: "Stripe subscription schedule (needs live Stripe)",
    cancelAtPeriodEnd: "Stripe first, then the same update as setMembershipCancelAtPeriodEnd (covered)",
    startOneTimeRenewal: "creates a Stripe PaymentIntent (needs live Stripe)",
    createAutoRenewSetup: "creates a Stripe SetupIntent (needs live Stripe)",
    confirmAutoRenewFromOneTime: "creates a Stripe subscription (needs live Stripe)",
  },
  "player-merge": { runMerge: "inner step of mergeMembers (covered, both dry run and apply)" },
  "wolf-vision-db": {},
  webhooks: { bearerFrom: "header parsing only", isAllowedWebhookUrl: "URL check only", signPayload: "HMAC helper" },
  "api-v1": { json: "response helper", parsePeriod: "string parsing only" },
  "admin-access": {
    decide: "pure permission decision (tests/phase1-rules.test.ts)",
    currentAdmin: "needs a Next.js request (cookies()); same path as resolveAdmin (covered)",
    actorFor: "maps a context, no database",
    canOpenAdminPage: "pure menu filter over a context, no database",
    requireAdminActor: "needs a Next.js request (cookies()); same path as resolveAdmin (covered)",
    audit: "writes through lib/admin-roles.ts on node-postgres (not the swapped driver; tests/admin-roles.test.ts)",
    isAdminApiRequest: "header check only",
    readCookie: "header parsing only",
  },
  sms: {
    lookupRecaptchaSiteKey: "Google API only",
    getRecaptchaSiteKey: "Google API only",
    sendSmsCode: "needs reCAPTCHA + Google Identity Toolkit (external)",
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const created: string[] = [];
let proxy: ChildProcess | null = null;
const sides: Side[] = [];

function urlFor(db: string): string {
  const u = new URL(BASE_URL!);
  u.pathname = `/${db}`;
  u.hostname = "localhost";
  return u.toString();
}
async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: urlFor("postgres") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
async function withDb<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
async function freshFixtureDb(name: string): Promise<string> {
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${name}`);
  });
  created.push(name);
  const url = urlFor(name);
  await withDb(url, async (c) => {
    await migrate(c, { log: () => {} });
    await c.query(SEED);
  });
  return url;
}

// Columns whose value comes from the clock at the moment of the call, so the
// two sides can't match exactly. The rest of each row still must.
const CLOCK_COLUMNS: Record<string, { column: string; reason: string }> = {
  shop_products: { column: "slug", reason: "saveProduct appends Date.now() in base 36 to a new product's slug" },
};

/** Every row of every public table, in primary-key order, as text. */
async function tableContents(url: string): Promise<Record<string, unknown[]>> {
  return withDb(url, async (c) => {
    const tables = (await c.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`)).rows.map((r) => r.relname as string);
    const out: Record<string, unknown[]> = {};
    for (const t of tables) {
      const { rows } = await c.query(`SELECT * FROM ${t} ORDER BY 1, 2`).catch(() => c.query(`SELECT * FROM ${t} ORDER BY 1`));
      const clock = CLOCK_COLUMNS[t];
      out[t] = rows.map((r) => normalize(clock ? { ...r, [clock.column]: String(r[clock.column]).replace(/-[0-9a-z]{6,}$/, "-<clock>") } : r));
    }
    return out;
  });
}

describe("golden master: old driver vs new driver", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL to a scratch Postgres" : false }, () => {
  const allCases = cases();

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    delete process.env.VERCEL_ENV;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.RESEND_API_KEY;
    process.env.PLAYER_SESSION_SECRET ??= "golden-player-session-secret";
    process.env.TZ ??= "UTC";
    const legacyUrl = await freshFixtureDb(`golden_legacy_${process.pid}`);
    const newUrl = await freshFixtureDb(`golden_new_${process.pid}`);
    // The same app on the standard-Postgres driver (Phase 3 step 6).
    const pgUrl = await freshFixtureDb(`golden_pg_${process.pid}`);
    // The same app as the app's role, through row-level security (Phase 3 steps 10 and 11).
    const rlsUrl = await freshFixtureDb(`golden_rls_${process.pid}`);
    const pgPort = new URL(BASE_URL!).port || "5432";
    const wsPort = String(await (await import("./golden/free-port.ts")).freePort());
    proxy = spawn(process.execPath, ["scripts/e2e/ws-proxy.mjs", wsPort, pgPort], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 600));
    const { pointDriversAt } = await import("./golden/local-drivers.ts");
    await pointDriversAt(`localhost:${wsPort}`);
    register("./golden/hook.mjs", import.meta.url);
    installDeterministicRandom();
    for (const [name, url, suffix] of [["legacy", legacyUrl, "?golden=legacy"], ["new", newUrl, ""], ["pg", pgUrl, "?golden=pg"], ["rls", rlsUrl, "?golden=rls"]] as const) {
      const m = {} as Mods;
      for (const mod of MODULES) m[mod] = await import(`../lib/${mod}.ts${suffix}`);
      sides.push({ name, url, m });
    }
    await withDb(legacyUrl, async (c) => {
      const q = async (dow: number, dir: ">" | "<") =>
        (await c.query(`SELECT ${dir === ">" ? "min" : "max"}(date)::text AS d FROM sessions WHERE extract(dow FROM date) = $1 AND date ${dir} current_date`, [dow])).rows[0].d as string;
      fx.nextFri = await q(5, ">");
      fx.nextWed = await q(3, ">");
      fx.lastFri = await q(5, "<");
      fx.lastWed = await q(3, "<");
      fx.today = (await c.query(`SELECT current_date::text AS d`)).rows[0].d;
    });
  });

  after(async () => {
    // Close both drivers' pools before the databases go away.
    const oldClient = await import("./golden/legacy-database.ts?golden=legacy");
    await oldClient.sql.end().catch(() => {});
    const newClient = await import("../lib/database.ts");
    await newClient.closeDatabase();
    const pgClient = await import("./golden/pg-database.ts?golden=pg");
    await pgClient.closeDatabase();
    const rlsClient = await import("../lib/database.ts?golden=rls");
    await rlsClient.closeDatabase();
    delete process.env.TENANT_SCOPE;
    proxy?.kill("SIGTERM");
    await admin(async (c) => {
      for (const name of created) await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    });
  });

  test("the two copies really use different drivers", async () => {
    const [legacy, fresh] = sides;
    assert.notEqual(legacy.m.db.listMemberships, fresh.m.db.listMemberships);
    const oldClient = await import("./golden/legacy-database.ts?golden=legacy");
    const newClient = await import("../lib/database.ts");
    assert.notEqual(oldClient.sql, newClient.sql);
  });

  test("every exported database function has a case or a written reason", () => {
    const covered = new Set(allCases.map((c) => `${c.mod}.${c.fn}`));
    const missing: string[] = [];
    const stale: string[] = [];
    for (const mod of MODULES) {
      const exportsOf = Object.entries(sides[1].m[mod]).filter(([, v]) => typeof v === "function" && !/^[A-Z]/.test(v.name || "x")).map(([k]) => k);
      const skip = NOT_COVERED[mod] ?? {};
      for (const fn of exportsOf) if (!covered.has(`${mod}.${fn}`) && !skip[fn]) missing.push(`${mod}.${fn}`);
      for (const fn of Object.keys(skip)) if (!exportsOf.includes(fn)) stale.push(`${mod}.${fn}`);
    }
    for (const c of allCases) if (typeof sides[1].m[c.mod][c.fn] !== "function") stale.push(`${c.mod}.${c.fn} (case)`);
    assert.deepEqual(missing, [], `exported database functions without a golden master case: ${missing.join(", ")}`);
    assert.deepEqual(stale, [], `listed functions that no longer exist: ${stale.join(", ")}`);
  });

  test("every function returns the same result on both drivers", async () => {
    const failures: string[] = [];
    let errorsBoth = 0;
    const bothThrew: string[] = [];
    for (const [i, c] of allCases.entries()) {
      const label = `${c.mod}.${c.fn}${c.label ? ` (${c.label})` : ""}`;
      const a = await run(sides[0], c, i + 1);
      await settle(sides[0]);
      // Every other copy (the new client, then the standard-Postgres driver)
      // must answer exactly as the first.
      for (const side of sides.slice(1)) {
        const b = await run(side, c, i + 1);
        await settle(side);
        const where = sides.length > 2 ? `${label} [${side.name}]` : label;
        if (a.ok !== b.ok) {
          failures.push(`${where}: ${a.ok ? "legacy ok" : `legacy threw ${JSON.stringify((a as { error: unknown }).error)}`} / ${b.ok ? `${side.name} ok` : `${side.name} threw ${JSON.stringify((b as { error: unknown }).error)}`}`);
          continue;
        }
        const d = diff(a.ok ? a.value : (a as { error: unknown }).error, b.ok ? b.value : (b as { error: unknown }).error);
        if (d) failures.push(`${where}: ${d}`);
      }
      if (!a.ok) {
        errorsBoth++;
        bothThrew.push(`${label}: ${JSON.stringify((a as { error: unknown }).error)}`);
      }
      if (process.env.GOLDEN_TRACE) {
        const ta = await tableContents(sides[0].url);
        for (const side of sides.slice(1)) {
          const tb = await tableContents(side.url);
          for (const t of Object.keys(ta)) {
            const td = diff(ta[t], tb[t], t);
            if (td) {
              console.log(`TRACE after ${label} [${side.name}]: ${td}`);
              break;
            }
          }
        }
      }
    }
    if (process.env.GOLDEN_VERBOSE) console.log(`golden master: ${allCases.length} cases, ${errorsBoth} threw the same error on both drivers:\n${bothThrew.join("\n")}`);
    assert.deepEqual(failures, [], `golden master differences:\n${failures.join("\n")}`);
    // Work scheduled "after the response" ran inside the test and was waited for.
    const { afterStats } = await import("./golden/next-server.ts");
    assert.ok(afterStats.calls > 0, "after() was never called: the next/server stand-in isn't wired up");
    // Most cases must actually run (not just fail the same way on both).
    assert.ok(errorsBoth < allCases.length * 0.15, `${errorsBoth} of ${allCases.length} cases threw on both drivers`);
  });

  // The repository pairs below run on the first two copies only, so the
  // standard-Postgres copy's rows are compared here, after the same calls.
  test("after the function cases, the copy run through row-level security holds the same rows", async () => {
    process.env.TENANT_SCOPE = "off";
    const rlsSide = sides.find((x) => x.name === "rls");
    assert.ok(rlsSide, "the rls copy is loaded");
    assert.notEqual(rlsSide.m.db.listMemberships, sides[1].m.db.listMemberships);
    const a = await tableContents(sides[0].url);
    const b = await tableContents(rlsSide.url);
    const failures: string[] = [];
    for (const t of Object.keys(a)) {
      const d = diff(a[t], b[t], t);
      if (d) failures.push(d);
    }
    assert.deepEqual(failures, [], `table contents differ through row-level security:\n${failures.join("\n")}`);
    // It really ran as the app's role: the enforced client can't see another club's rows.
    const rlsDb = await import("../lib/database.ts?golden=rls");
    process.env.POSTGRES_URL = rlsSide.url;
    process.env.TENANT_SCOPE = "enforce";
    try {
      const who = await rlsDb.sql.query(`SELECT current_user AS role, current_setting('app.tenant_id', true) AS club`);
      assert.deepEqual(who.rows, [{ role: "luvallplay_app", club: "1" }]);
      const viaHttp = await rlsDb.sql`SELECT current_user AS role, current_setting('app.tenant_id', true) AS club`;
      assert.deepEqual(viaHttp.rows, [{ role: "luvallplay_app", club: "1" }]);
    } finally {
      process.env.TENANT_SCOPE = "off";
    }
  });

  test("after the function cases, the standard-Postgres copy holds the same rows", async () => {
    const pgSide = sides.find((x) => x.name === "pg");
    assert.ok(pgSide, "the pg copy is loaded");
    const pgClient = await import("./golden/pg-database.ts?golden=pg");
    const newClient = await import("../lib/database.ts");
    assert.notEqual(pgClient.sql, newClient.sql);
    assert.notEqual(pgSide.m.db.listMemberships, sides[1].m.db.listMemberships);
    const a = await tableContents(sides[0].url);
    const b = await tableContents(pgSide.url);
    const failures: string[] = [];
    for (const t of Object.keys(a)) {
      const d = diff(a[t], b[t], t);
      if (d) failures.push(d);
    }
    assert.deepEqual(failures, [], `table contents differ on the standard-Postgres driver:\n${failures.join("\n")}`);
  });

  // Queries that lived in route handlers, now repository functions (Drizzle).
  // Old: the route's SQL, verbatim, on the old driver. New: the repository.
  test("routes → repositories: each repository does exactly what the route's SQL did", async () => {
    const legacy = (await import("./golden/legacy-database.ts?golden=legacy")).sql;
    const { DISPLAY_NAME_SQL } = await import("../lib/stats-periods.ts");
    const repo = {
      donations: await import("../lib/repos/donations.ts"),
      memberships: await import("../lib/repos/memberships.ts"),
      players: await import("../lib/repos/players.ts"),
      waitlist: await import("../lib/repos/waitlist.ts"),
      health: await import("../lib/repos/health.ts"),
    };
    type Pair = { label: string; old: () => Promise<unknown>; new: () => Promise<unknown> };
    const pairs: Pair[] = [
      {
        label: "wolf-vision/players: player picker list",
        old: async () => {
          const { rows } = await legacy.query(
            `SELECT p.id, ${DISPLAY_NAME_SQL} AS name, p.avatar_url FROM players p
             WHERE p.deleted_at IS NULL AND (trim(p.first_name) <> '' OR trim(coalesce(p.display_name, '')) <> '')
             ORDER BY lower(${DISPLAY_NAME_SQL}) LIMIT 2000;`,
          );
          return rows.map((r) => ({ id: Number(r.id), name: String(r.name), avatarUrl: (r.avatar_url as string | null) ?? null }));
        },
        new: () => repo.players.listPlayersForPicker(),
      },
      {
        label: "create-donation-subscription: monthly donation (twice: idempotent)",
        old: async () => {
          for (let i = 0; i < 2; i++)
            await legacy`INSERT INTO donations (email, first_name, last_name, amount_cents, frequency, stripe_subscription_id, status)
              VALUES (${"giver@golden.test"}, ${"Give"}, ${"R"}, ${1500}, 'monthly', ${"sub_golden_don"}, 'pending')
              ON CONFLICT (stripe_subscription_id) DO NOTHING;`;
        },
        new: async () => {
          for (let i = 0; i < 2; i++) await repo.donations.insertMonthlyDonation({ email: "giver@golden.test", firstName: "Give", lastName: "R", amountCents: 1500, stripeSubscriptionId: "sub_golden_don" });
        },
      },
      {
        label: "stripe-webhook: one-off donation (twice: idempotent)",
        old: async () => {
          for (let i = 0; i < 2; i++)
            await legacy`INSERT INTO donations (email, first_name, last_name, amount_cents, frequency, stripe_payment_intent_id, status)
              VALUES (${""}, ${""}, ${""}, ${700}, 'once', ${"pi_golden_don"}, 'succeeded')
              ON CONFLICT (stripe_payment_intent_id) DO NOTHING;`;
        },
        new: async () => {
          for (let i = 0; i < 2; i++) await repo.donations.insertOneTimeDonation({ email: "", firstName: "", lastName: "", amountCents: 700, stripePaymentIntentId: "pi_golden_don" });
        },
      },
      {
        label: "stripe-webhook: subscription updated",
        old: async () => {
          await legacy`UPDATE memberships SET status = ${"past_due"}, cancel_at_period_end = ${true} WHERE stripe_subscription_id = ${"sub_golden_mia"};`;
          await legacy`UPDATE donations SET status = ${"past_due"} WHERE stripe_subscription_id = ${"sub_golden_don"};`;
        },
        new: async () => {
          await repo.memberships.setMembershipStatusBySubscription("sub_golden_mia", "past_due", true);
          await repo.donations.setDonationStatusBySubscription("sub_golden_don", "past_due");
        },
      },
      {
        label: "stripe-webhook: subscription deleted",
        old: async () => {
          await legacy`UPDATE memberships SET status = 'canceled' WHERE stripe_subscription_id = ${"sub_golden_na"};`;
          await legacy`UPDATE donations SET status = 'canceled' WHERE stripe_subscription_id = ${"sub_golden_na"};`;
        },
        new: async () => {
          await repo.memberships.setMembershipStatusBySubscription("sub_golden_na", "canceled");
          await repo.donations.setDonationStatusBySubscription("sub_golden_na", "canceled");
        },
      },
      {
        label: "stripe-webhook: invoice paid → donation active",
        old: () => legacy`UPDATE donations SET status = 'active' WHERE stripe_subscription_id = ${"sub_golden_don"};`.then(() => undefined),
        new: () => repo.donations.setDonationStatusBySubscription("sub_golden_don", "active"),
      },
      {
        label: "profile/event: install hint, installed, welcome dismissed (each twice: first time kept)",
        old: async () => {
          for (let i = 0; i < 2; i++) {
            await legacy`UPDATE players SET install_hint_shown_at = coalesce(install_hint_shown_at, NOW()) WHERE id = ${5};`;
            await legacy`UPDATE players SET installed_at = coalesce(installed_at, NOW()), install_hint_shown_at = coalesce(install_hint_shown_at, NOW()) WHERE id = ${6};`;
            await legacy`UPDATE players SET welcome_card_dismissed_at = coalesce(welcome_card_dismissed_at, NOW()) WHERE id = ${7};`;
          }
        },
        new: async () => {
          for (let i = 0; i < 2; i++) {
            await repo.players.markInstallHintShown(5);
            await repo.players.markInstalled(6);
            await repo.players.markWelcomeDismissed(7);
          }
        },
      },
      {
        label: "profile/leaderboard-optout: hide by token",
        old: async () => {
          const { rows } = await legacy`SELECT leaderboard_optout_token AS t FROM players WHERE id = 10;`;
          await legacy`UPDATE players SET leaderboard_visible = FALSE WHERE leaderboard_optout_token = ${rows[0].t as string};`;
          await legacy`UPDATE players SET leaderboard_visible = FALSE WHERE leaderboard_optout_token = ${"no-such-token-golden-xx"};`;
        },
        new: async () => {
          const { rows } = await (await import("../lib/database.ts")).sql`SELECT leaderboard_optout_token AS t FROM players WHERE id = 10;`;
          await repo.players.hideFromLeaderboardByToken(rows[0].t as string);
          await repo.players.hideFromLeaderboardByToken("no-such-token-golden-xx");
        },
      },
      {
        label: "waitlist: with and without a play day",
        old: async () => {
          await legacy`INSERT INTO waitlist (session_date, name, email) VALUES (${fx.nextFri}, ${"Late Comer"}, ${"late@golden.test"});`;
          await legacy`INSERT INTO waitlist (session_date, name, email) VALUES (${null}, ${"Any Day"}, ${"any@golden.test"});`;
        },
        new: async () => {
          await repo.waitlist.addToWaitlist({ sessionDate: fx.nextFri, name: "Late Comer", email: "late@golden.test" });
          await repo.waitlist.addToWaitlist({ sessionDate: null, name: "Any Day", email: "any@golden.test" });
        },
      },
      {
        label: "health/db: round trip",
        old: () => legacy`SELECT 1;`.then(() => undefined),
        new: () => repo.health.ping(),
      },
    ];
    const failures: string[] = [];
    for (const p of pairs) {
      process.env.POSTGRES_URL = sides[0].url;
      const a = await p.old().then((v) => ({ ok: true, v: normalize(v) }), (e) => ({ ok: false, v: String(e) }));
      await settle(sides[0]);
      process.env.POSTGRES_URL = sides[1].url;
      const b = await p.new().then((v) => ({ ok: true, v: normalize(v) }), (e) => ({ ok: false, v: String(e) }));
      await settle(sides[1]);
      const d = diff(a, b);
      if (d) failures.push(`${p.label}: ${d}`);
    }
    assert.deepEqual(failures, [], `repository differences:\n${failures.join("\n")}`);
  });

  test("after all the writes, both databases hold the same rows", async () => {
    const a = await tableContents(sides[0].url);
    const b = await tableContents(sides[1].url);
    const failures: string[] = [];
    for (const t of Object.keys(a)) {
      const d = diff(a[t], b[t], t);
      if (d) failures.push(d);
    }
    assert.deepEqual(failures, [], `table contents differ:\n${failures.join("\n")}`);
  });
});
