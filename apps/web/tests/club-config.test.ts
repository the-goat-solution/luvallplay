// Phase 3 step 4: club settings replace constants (build plan §6.2).
//
// 1. The settings stored for Three Wolves (migration 0003) are exactly the
//    constants the code uses today: the shadow comparison is empty.
// 2. A bad or missing stored value never breaks the club: that field falls
//    back to the built-in value and is reported.
// 3. CLUB_SETTINGS_SOURCE decides which copy answers, and a database error
//    never throws.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { diffClubConfig, parseClubConfig, type ClubConfig, type TenantRow } from "@luvallplay/core/club-config";
import { migrate } from "../scripts/db/migrate.mjs";
import { DEFAULT_CLUB_CONFIG, compareClubConfig, getClubConfig, loadClubConfigFromDb, resetClubConfigCache, settingsSource } from "../lib/club-config.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `club_config_${process.pid}`;

const TENANT: TenantRow = {
  id: 7, slug: "synthetic-club", name: "Synthetic Club", country: "VN", region: "han", timezone: "Asia/Ho_Chi_Minh", currency: "VND",
  languages: ["vi", "en"], terms: { points_name: "Luv Points", vision_name: "Vision" },
};
const MODULES = [
  { module_id: "play-days", settings: { courtsToMaxPlayers: { "1": 4, "2": 8 }, sessionCapacity: 8, casualOnlyDefaultCourts: 1, bookingWindowDays: 14, bookingCutoffHour: 20 } },
  { module_id: "round-robin", settings: { miniGameMaxPlayers: 12 } },
  { module_id: "memberships", settings: { days: ["tuesday"], defaultCourts: { tuesday: 2 }, cycleDays: { monthly: 30, quarterly: 90 }, startSearchDays: 60, pendingHoldMinutes: 15 } },
  { module_id: "donations", settings: { minAmount: 10000, maxAmount: 5000000 } },
];

test("another club's rows give another club's settings, with nothing borrowed from the defaults", () => {
  const { config, problems } = parseClubConfig(TENANT, MODULES, DEFAULT_CLUB_CONFIG);
  assert.deepEqual(problems, []);
  assert.deepEqual(config, {
    tenantId: 7, slug: "synthetic-club", name: "Synthetic Club", country: "VN", region: "han", timezone: "Asia/Ho_Chi_Minh", currency: "VND",
    languages: ["vi", "en"], terms: { pointsName: "Luv Points", visionName: "Vision" },
    playDays: { courtsToMaxPlayers: { 1: 4, 2: 8 }, sessionCapacity: 8, casualOnlyDefaultCourts: 1, bookingWindowDays: 14, bookingCutoffHour: 20 },
    roundRobin: { miniGameMaxPlayers: 12 },
    memberships: { days: ["tuesday"], defaultCourts: { tuesday: 2 }, cycleDays: { monthly: 30, quarterly: 90 }, startSearchDays: 60, pendingHoldMinutes: 15 },
    // Whole dong: VND has no minor unit.
    donations: { minAmount: 10000, maxAmount: 5000000 },
  } satisfies ClubConfig);
});

test("a missing or malformed value falls back for that field only, and is reported", () => {
  const { config, problems } = parseClubConfig(
    { ...TENANT, timezone: "Mars/Olympus", currency: "dong", terms: { points_name: "" } },
    [
      { module_id: "play-days", settings: { courtsToMaxPlayers: { "0": 6, x: 2 }, sessionCapacity: -1, bookingWindowDays: 14.5, bookingCutoffHour: 24 } },
      { module_id: "memberships", settings: { days: ["funday"], cycleDays: { monthly: 28 }, defaultCourts: [] } },
      { module_id: "donations", settings: { minAmount: 900, maxAmount: 100 } },
    ],
    DEFAULT_CLUB_CONFIG,
  );
  const D = DEFAULT_CLUB_CONFIG;
  assert.equal(config.name, "Synthetic Club", "valid fields are kept");
  assert.equal(config.timezone, D.timezone);
  assert.equal(config.currency, D.currency);
  assert.deepEqual(config.terms, D.terms);
  assert.deepEqual(config.playDays, D.playDays);
  assert.deepEqual(config.roundRobin, D.roundRobin);
  assert.deepEqual(config.memberships, D.memberships);
  assert.deepEqual(config.donations, D.donations);
  for (const path of ["tenant.timezone", "tenant.currency", "tenant.terms.points_name", "tenant.terms.vision_name", "play-days.courtsToMaxPlayers",
    "play-days.sessionCapacity", "play-days.casualOnlyDefaultCourts", "play-days.bookingWindowDays", "play-days.bookingCutoffHour",
    "round-robin.miniGameMaxPlayers", "memberships.days", "memberships.defaultCourts", "memberships.cycleDays", "memberships.startSearchDays",
    "memberships.pendingHoldMinutes", "donations"]) {
    assert.ok(problems.some((p) => p.startsWith(`${path}:`)), `reported: ${path}`);
  }
});

test("the comparison names each setting that differs, and ignores key order", () => {
  const a = DEFAULT_CLUB_CONFIG;
  assert.deepEqual(diffClubConfig(a, structuredClone(a)), []);
  const b = structuredClone(a);
  b.timezone = "Australia/Sydney";
  b.playDays.courtsToMaxPlayers = { 4: 22, 3: 18, 2: 14, 1: 6 };
  b.memberships.days = ["wednesday", "friday"];
  assert.deepEqual(diffClubConfig(a, b), [
    'memberships.days: ["friday","wednesday"] → ["wednesday","friday"]',
    'playDays.courtsToMaxPlayers: {"1":6,"2":12,"3":18,"4":22} → {"1":6,"2":14,"3":18,"4":22}',
    'timezone: "Pacific/Auckland" → "Australia/Sydney"',
  ]);
  // The same values with keys in another order aren't a difference.
  b.playDays.courtsToMaxPlayers = { 4: 22, 2: 12, 1: 6, 3: 18 };
  assert.equal(diffClubConfig(a, b).length, 2);
});

describe("club settings from the database", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const warnings: string[] = [];
  const originalWarn = console.warn;

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.end();
    c = new pg.Client({ connectionString: urlFor(NAME) });
    await c.connect();
    await migrate(c, { log: () => {} });
    console.warn = (...a: unknown[]) => warnings.push(a.join(" "));
  });
  after(async () => {
    console.warn = originalWarn;
    delete process.env.CLUB_SETTINGS_SOURCE;
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });
  beforeEach(() => {
    warnings.length = 0;
    resetClubConfigCache();
    delete process.env.CLUB_SETTINGS_SOURCE;
  });

  test("what migration 0003 stored for Three Wolves is exactly what the code uses today", async () => {
    const stored = await loadClubConfigFromDb(c);
    assert.ok(stored);
    assert.deepEqual(stored.problems, []);
    assert.deepEqual(diffClubConfig(DEFAULT_CLUB_CONFIG, stored.config), []);
    assert.deepEqual({ ...stored.config, tenantId: null }, DEFAULT_CLUB_CONFIG);
    assert.deepEqual(await compareClubConfig(c), { source: "constants", stored: true, problems: [], differences: [] });
  });

  test("the source decides which copy answers", async () => {
    await c.query(`UPDATE tenant_modules SET settings = jsonb_set(settings, '{bookingCutoffHour}', '18') WHERE module_id = 'play-days'`);
    try {
      assert.equal(settingsSource(), "constants");
      assert.equal((await getClubConfig(c)).playDays.bookingCutoffHour, 17);
      assert.deepEqual(warnings, [], "the default source doesn't read the database at all");

      process.env.CLUB_SETTINGS_SOURCE = "shadow";
      resetClubConfigCache();
      assert.equal((await getClubConfig(c)).playDays.bookingCutoffHour, 17, "shadow: the built-in value still answers");
      assert.deepEqual(warnings, ["[shadow] club settings differ: playDays.bookingCutoffHour: 17 → 18"]);
      await getClubConfig(c);
      await getClubConfig(c, Date.now() + 120_000);
      assert.equal(warnings.length, 1, "the same difference is logged once, not on every request");

      process.env.CLUB_SETTINGS_SOURCE = "database";
      resetClubConfigCache();
      const fromDb = await getClubConfig(c);
      assert.equal(fromDb.playDays.bookingCutoffHour, 18, "database: the stored value answers");
      assert.equal(typeof fromDb.tenantId, "number");
    } finally {
      await c.query(`UPDATE tenant_modules SET settings = jsonb_set(settings, '{bookingCutoffHour}', '17') WHERE module_id = 'play-days'`);
    }
  });

  test("answers are cached for a minute", async () => {
    process.env.CLUB_SETTINGS_SOURCE = "database";
    let calls = 0;
    const counting = { query: (t: string, p?: unknown[]) => (calls++, c.query(t, p)) };
    const t0 = Date.now();
    await getClubConfig(counting, t0);
    await getClubConfig(counting, t0 + 30_000);
    assert.equal(calls, 2, "one read of tenants and one of tenant_modules");
    await getClubConfig(counting, t0 + 61_000);
    assert.equal(calls, 4);
  });

  test("a database error or a club without stored settings never throws: the built-in values answer", async () => {
    process.env.CLUB_SETTINGS_SOURCE = "database";
    const broken = { query: async () => Promise.reject(new Error("connection lost")) };
    assert.deepEqual(await getClubConfig(broken), DEFAULT_CLUB_CONFIG);
    assert.deepEqual(warnings, ["[shadow] club settings unreadable: connection lost"]);

    resetClubConfigCache();
    const noTables = { query: async () => Promise.reject(Object.assign(new Error("relation does not exist"), { code: "42P01" })) };
    assert.deepEqual(await getClubConfig(noTables), DEFAULT_CLUB_CONFIG);
    assert.equal(await loadClubConfigFromDb(c, "no-such-club"), null);
  });
});
