// The durable record of shadow reads (lib/shadow-log.ts; Phase 3 gate:
// "shadow reads clean for 7 days"). Server logs last an hour, so the
// evidence is rows in admin_audit_log.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";
import { getClubConfig, onClubConfigDifference, resetClubConfigCache, settingsSource } from "../lib/club-config.ts";
import { recordShadow, shadowHeartbeat, shadowReport } from "../lib/shadow-log.ts";

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
    assert.deepEqual(out, [{ what: "settings", result: "clean", differences: [] }]);
    const all = await rows();
    assert.equal(all.length, 1);
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
    assert.equal(report.length, 1);
    assert.deepEqual({ clean: report[0].clean, differ: report[0].differ, unavailable: report[0].unavailable, what: report[0].what }, { clean: 1, differ: 2, unavailable: 0, what: "settings" });
  });

  test("a database that can't answer never throws", async () => {
    const broken = { query: async () => { throw new Error("connection lost"); } };
    await recordShadow(broken, "settings", "clean");
    const out = await shadowHeartbeat(broken);
    assert.equal(out[0].result, "unavailable");
  });
});
