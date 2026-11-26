// The durable record of shadow reads (lib/shadow-log.ts; Phase 3 gate:
// "shadow reads clean for 7 days"). Server logs last an hour, so the
// evidence is rows in admin_audit_log.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";
import { getClubConfig, onClubConfigDifference, resetClubConfigCache, settingsSource } from "../lib/club-config.ts";
import { recordShadow, shadowHeartbeat, shadowReport, shadowVerdict, type ShadowDay } from "../lib/shadow-log.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `shadow_log_${process.pid}`;

describe("shadow record", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const originalWarn = console.warn;
  const originalError = console.error;
  const rows = async () => (await c.query(`SELECT actor_kind, action, target, meta FROM admin_audit_log WHERE action LIKE 'shadow.%' ORDER BY id`)).rows;

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
    console.warn = () => {};
    console.error = () => {};
  });
  after(async () => {
    console.warn = originalWarn;
    console.error = originalError;
    onClubConfigDifference(null);
    delete process.env.CLUB_SETTINGS_SOURCE;
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("the heartbeat records a clean day", async () => {
    const out = await shadowHeartbeat(c);
    assert.deepEqual(out, [
      { what: "settings", result: "clean", differences: [] },
      { what: "routing", result: "clean", differences: [] },
    ]);
    const all = await rows();
    assert.equal(all.length, 2);
    assert.deepEqual(all[1].meta.checked, ["three-wolves.luvallplay.com", "threewolvesbadminton.org", "www.threewolvesbadminton.org"]);
    assert.equal(all[0].actor_kind, "system");
    assert.equal(all[0].action, "shadow.settings");
    assert.equal(all[0].target, "clean");
    assert.equal(all[0].meta.heartbeat, true);
  });

  test("a difference is recorded when a request sees it, once, and by the heartbeat", async () => {
    await c.query(`UPDATE tenant_modules SET settings = jsonb_set(settings, '{bookingCutoffHour}', '18') WHERE module_id = 'play-days'`);
    process.env.CLUB_SETTINGS_SOURCE = "shadow";
    onClubConfigDifference((db, differences) => recordShadow(db, "settings", "differ", { source: settingsSource(), differences }));
    resetClubConfigCache();
    await getClubConfig(c, 1_000_000);
    await getClubConfig(c, 1_000_000 + 120_000); // cache expired: compared again, same difference, not recorded twice
    let differ = (await rows()).filter((r) => r.target === "differ");
    assert.equal(differ.length, 1);
    assert.match(JSON.stringify(differ[0].meta.differences), /bookingCutoffHour/);

    const out = await shadowHeartbeat(c);
    assert.equal(out[0].result, "differ");
    differ = (await rows()).filter((r) => r.target === "differ");
    assert.equal(differ.length, 2);

    const report = await shadowReport(c, 2);
    assert.deepEqual(report.map((r) => ({ what: r.what, clean: r.clean, differ: r.differ, unavailable: r.unavailable })), [
      { what: "routing", clean: 2, differ: 0, unavailable: 0 },
      { what: "settings", clean: 1, differ: 2, unavailable: 0 },
    ]);
  });

  test("a database that can't answer never throws", async () => {
    const broken = { query: async () => { throw new Error("connection lost"); } };
    await recordShadow(broken, "settings", "clean");
    const out = await shadowHeartbeat(broken);
    assert.deepEqual(out.map((o) => o.result), ["unavailable", "unavailable"]);
  });
});

// The step 11 gate (audit C0): the old report counted a day as clean when any
// check was clean and ignored "unavailable", so it couldn't see a check that
// never ran.
describe("shadow verdict", () => {
  const row = (day: string, what: string, clean = 1, differ = 0, unavailable = 0): ShadowDay => ({ day, what, clean, differ, unavailable });
  const cleanDay = (day: string) => [row(day, "routing"), row(day, "settings"), row(day, "tenant-reads")];
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-12-${String(from + i).padStart(2, "0")}`);

  test("a day is clean only when every check was clean", () => {
    const v = shadowVerdict(cleanDay("2026-12-01"), { today: "2026-12-01" });
    assert.deepEqual(v.days, [{ day: "2026-12-01", clean: true, reasons: [] }]);
    assert.equal(v.streak, 1);
    assert.equal(v.passed, false, "one day isn't seven");
  });

  test("production on 25 Nov: settings differ and the row-level-security probe unavailable, routing clean. Not a clean day", () => {
    const rows = [row("2026-11-25", "routing"), row("2026-11-25", "settings", 0, 1, 0), row("2026-11-25", "tenant-reads", 0, 0, 1)];
    const v = shadowVerdict(rows, { today: "2026-11-25" });
    assert.equal(v.days[0].clean, false);
    assert.deepEqual(v.days[0].reasons, ["settings: no clean result", "tenant-reads: no clean result", "settings: 1 difference(s)", "tenant-reads: unavailable 1 time(s)"]);
    assert.equal(v.streak, 0);
  });

  test("unavailable is a failure even beside a clean result the same day", () => {
    const rows = [...cleanDay("2026-12-01").slice(0, 2), row("2026-12-01", "tenant-reads", 1, 0, 1)];
    assert.deepEqual(shadowVerdict(rows, { today: "2026-12-01" }).days[0].reasons, ["tenant-reads: unavailable 1 time(s)"]);
  });

  test("a check that never reported that day fails it; so does a difference a request saw after a clean heartbeat", () => {
    assert.deepEqual(shadowVerdict(cleanDay("2026-12-01").slice(0, 2), { today: "2026-12-01" }).days[0].reasons, ["tenant-reads: no clean result"]);
    const withDiffer = [...cleanDay("2026-12-01").slice(0, 2), row("2026-12-01", "tenant-reads", 1, 2, 0)];
    assert.deepEqual(shadowVerdict(withDiffer, { today: "2026-12-01" }).days[0].reasons, ["tenant-reads: 2 difference(s)"]);
  });

  test("seven clean days in a row meet the gate; six don't", () => {
    const seven = range(1, 7).flatMap(cleanDay);
    const v = shadowVerdict(seven, { today: "2026-12-07", since: "2026-12-01" });
    assert.equal(v.streak, 7);
    assert.equal(v.streakFrom, "2026-12-01");
    assert.equal(v.passed, true);
    assert.equal(shadowVerdict(range(1, 6).flatMap(cleanDay), { today: "2026-12-06", since: "2026-12-01" }).passed, false);
  });

  test("a day with nothing recorded breaks the run (the heartbeat didn't run)", () => {
    const rows = [...range(1, 3), ...range(5, 8)].flatMap(cleanDay);
    const v = shadowVerdict(rows, { today: "2026-12-08", since: "2026-12-01" });
    assert.deepEqual(v.failed, ["2026-12-04"]);
    assert.match(v.days[3].reasons[0], /no result recorded/);
    assert.equal(v.streak, 4);
    assert.equal(v.passed, false);
  });

  test("today doesn't count against the run before its heartbeat, and counts like any day after", () => {
    const seven = range(1, 7).flatMap(cleanDay);
    const early = shadowVerdict(seven, { today: "2026-12-08", since: "2026-12-01" });
    assert.equal(early.days.length, 7);
    assert.equal(early.passed, true);
    const bad = shadowVerdict([...seven, row("2026-12-08", "tenant-reads", 0, 1, 0)], { today: "2026-12-08", since: "2026-12-01" });
    assert.equal(bad.streak, 0);
    assert.equal(bad.passed, false);
  });

  test("with --since, an earlier failure is ignored and a later one fails the gate even after seven clean days", () => {
    const rows = [row("2026-11-30", "settings", 0, 1, 0), ...range(1, 7).flatMap(cleanDay)];
    assert.equal(shadowVerdict(rows.filter((r) => r.day >= "2026-12-01"), { today: "2026-12-07", since: "2026-12-01" }).passed, true);
    const late = [row("2026-12-01", "settings", 0, 1, 0), ...range(2, 8).flatMap(cleanDay)];
    const v = shadowVerdict(late, { today: "2026-12-08", since: "2026-12-01" });
    assert.equal(v.streak, 7);
    assert.equal(v.passed, false, "the clock restarts after a failed day: --since has to move");
    assert.equal(shadowVerdict(late.filter((r) => r.day >= "2026-12-02"), { today: "2026-12-08", since: "2026-12-02" }).passed, true);
  });

  test("month ends and an empty record", () => {
    const rows = ["2026-11-29", "2026-11-30", "2026-12-01"].flatMap(cleanDay);
    assert.equal(shadowVerdict(rows, { today: "2026-12-01", need: 3 }).passed, true);
    const none = shadowVerdict([], { today: "2026-12-01" });
    assert.deepEqual([none.days, none.streak, none.passed], [[], 0, false]);
  });
});
