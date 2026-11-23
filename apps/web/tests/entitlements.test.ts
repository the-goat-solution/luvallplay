// Phase 3 step 9: plans, entitlements and usage metering (build plan §6.5
// "Business model", §11.2, §11.3 gate 4).
//
// Synthetic clubs and plans live only in this test's scratch database.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { MODULES } from "@luvallplay/modules";
import { can as canRule, checkLimit, featureModule, parseLimits, usagePeriod, USAGE_METRICS, type Plan } from "@luvallplay/core/entitlements";
import { CLUB_OWNED_TABLES, PLATFORM_TABLES } from "@luvallplay/db/tenancy";
import { migrate } from "../scripts/db/migrate.mjs";
import { billingEnabled, can, clubPlan, recordUsage, resetEntitlementsCache, usageReport } from "../lib/entitlements.ts";

const FREE: Plan = { id: "nz-badminton-free", tiers: ["free"], limits: {}, status: "active" };
const STANDARD: Plan = { id: "vn-standard", tiers: ["free", "standard"], limits: { "email.sent": 1000 }, status: "active" };

test("with billing off, every module that exists is allowed", () => {
  for (const plan of [FREE, STANDARD, null, { ...STANDARD, status: "canceled" as const }]) {
    assert.deepEqual(canRule({ billingEnabled: false, plan, moduleTier: "standard" }), { allowed: true });
  }
  assert.deepEqual(canRule({ billingEnabled: false, plan: FREE, moduleTier: undefined }), { allowed: false, reason: "unknown-module" });
});

test("with billing on, a plan allows the tiers it includes", () => {
  const on = (plan: Plan | null, moduleTier: string) => canRule({ billingEnabled: true, plan, moduleTier });
  assert.deepEqual(on(FREE, "free"), { allowed: true });
  assert.deepEqual(on(FREE, "standard"), { allowed: false, reason: "not-in-plan" });
  assert.deepEqual(on(STANDARD, "standard"), { allowed: true });
  assert.deepEqual(on(null, "standard"), { allowed: false, reason: "no-plan" });
  assert.deepEqual(on({ ...STANDARD, status: "canceled" }, "standard"), { allowed: false, reason: "plan-ended" });
  // Late payment doesn't switch a club off; that's a conversation.
  assert.deepEqual(on({ ...STANDARD, status: "past_due" }, "standard"), { allowed: true });
  // The free tier survives everything: no plan, an ended plan.
  assert.deepEqual(on(null, "free"), { allowed: true });
  assert.deepEqual(on({ ...STANDARD, status: "canceled" }, "free"), { allowed: true });
});

test("every module's manifest names its tier, and every module is on Free today", () => {
  for (const m of MODULES) assert.equal(m.plan, "free", m.id);
  assert.equal(featureModule("arena.challenges"), "arena");
  assert.equal(featureModule("arena"), "arena");
});

test("a fair-use limit reports, it never blocks", () => {
  assert.deepEqual(checkLimit(50, undefined), { state: "none", used: 50, limit: null, ratio: null });
  assert.deepEqual(checkLimit(50, 0), { state: "none", used: 50, limit: null, ratio: null });
  assert.equal(checkLimit(50, 100).state, "ok");
  assert.equal(checkLimit(80, 100).state, "near");
  assert.equal(checkLimit(100, 100).state, "near");
  assert.equal(checkLimit(101, 100).state, "over");
  assert.deepEqual(parseLimits({ "email.sent": 1000, "sms.sent": -1, bad: "x", zero: 0 }), { "email.sent": 1000 });
  assert.deepEqual(parseLimits(null), {});
  assert.deepEqual(parseLimits([1, 2]), {});
  assert.equal(usagePeriod(new Date("2026-11-23T10:00:00Z")), "2026-11-01");
  assert.equal(usagePeriod(new Date("2026-12-31T23:59:59Z")), "2026-12-01");
  assert.equal(usagePeriod(new Date("2027-01-01T00:00:00Z")), "2027-01-01");
});

test("the new tables are classified: plans is the platform's, the other two belong to a club", () => {
  assert.ok((PLATFORM_TABLES as readonly string[]).includes("plans"));
  assert.ok((CLUB_OWNED_TABLES as readonly string[]).includes("club_plans"));
  assert.ok((CLUB_OWNED_TABLES as readonly string[]).includes("usage_counters"));
});

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `entitlements_${process.pid}`;

describe("plans and usage in the database", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const originalError = console.error;
  const env = { billing: process.env.BILLING_ENABLED, slug: process.env.TENANT_SLUG };

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
    console.error = () => {};
  });
  after(async () => {
    console.error = originalError;
    for (const [k, v] of [["BILLING_ENABLED", env.billing], ["TENANT_SLUG", env.slug]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });
  beforeEach(() => {
    resetEntitlementsCache();
    delete process.env.BILLING_ENABLED;
    delete process.env.TENANT_SLUG;
  });

  test("the migration puts Three Wolves on the free-for-good plan, with no limits yet", async () => {
    const { rows } = await c.query(`SELECT p.id, p.country, p.sport, p.tiers, p.price_minor, p.currency, p.billing_interval, p.limits, cp.status, cp.ends_at, t.slug
                                    FROM club_plans cp JOIN plans p ON p.id = cp.plan_id JOIN tenants t ON t.id = cp.tenant_id`);
    assert.deepEqual(rows, [{ id: "nz-badminton-free", country: "NZ", sport: "badminton", tiers: ["free"], price_minor: 0, currency: "NZD", billing_interval: null, limits: {}, status: "active", ends_at: null, slug: "three-wolves" }]);
    assert.deepEqual(await clubPlan(c), { id: "nz-badminton-free", tiers: ["free"], limits: {}, status: "active" });
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM usage_counters`)).rows[0].n, 0);
  });

  test("billing is off by default, and can() then allows every real module without reading the plan", async () => {
    assert.equal(billingEnabled(), false);
    const noDb = { query: async () => { throw new Error("the plan must not be read"); } };
    for (const m of MODULES) assert.deepEqual(await can(noDb, m.id), { allowed: true }, m.id);
    assert.deepEqual(await can(noDb, "arena.challenges"), { allowed: true });
    assert.deepEqual(await can(noDb, "no-such-module"), { allowed: false, reason: "unknown-module" });
    for (const v of ["TRUE", "true", " true "]) {
      process.env.BILLING_ENABLED = v;
      assert.equal(billingEnabled(), true, v);
    }
    for (const v of ["1", "yes", "false", ""]) {
      process.env.BILLING_ENABLED = v;
      assert.equal(billingEnabled(), false, v);
    }
  });

  test("with billing on, Three Wolves keeps every module (all are Free), and a plan that can't be read doesn't stop the club", async () => {
    process.env.BILLING_ENABLED = "true";
    for (const m of MODULES) assert.deepEqual(await can(c, m.id), { allowed: true }, m.id);
    resetEntitlementsCache();
    assert.deepEqual(await can({ query: async () => { throw new Error("down"); } }, "arena"), { allowed: true });
  });

  test("a club has one current plan; changing plan closes the old row", async () => {
    await assert.rejects(c.query(`INSERT INTO club_plans (tenant_id, plan_id) VALUES (1, 'nz-badminton-free')`), /club_plans_current_idx/);
    await assert.rejects(c.query(`UPDATE club_plans SET plan_id = 'no-such-plan' WHERE tenant_id = 1`), /club_plans_plan_id_fkey/);
    await assert.rejects(c.query(`DELETE FROM plans WHERE id = 'nz-badminton-free'`), /club_plans_plan_id_fkey/);
    await assert.rejects(c.query(`INSERT INTO plans (id, name, currency, price_minor) VALUES ('bad', 'Bad', 'NZD', -1)`), /plans_price_minor_check/);
    await assert.rejects(c.query(`INSERT INTO plans (id, name, currency) VALUES ('bad', 'Bad', 'dollars')`), /plans_currency_check/);
    // A paid plan for a synthetic Vietnamese club, priced in whole dong.
    await c.query(`INSERT INTO plans (id, name, country, sport, tiers, price_minor, currency, billing_interval, limits) VALUES ('vn-standard', 'Vietnam standard', 'VN', 'badminton', ARRAY['free','standard'], 199000, 'VND', 'month', '{"email.sent": 3}')`);
    await c.query(`INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
                   SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, payment_mode, incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves'`);
    await c.query(`INSERT INTO club_plans (tenant_id, plan_id, status) SELECT id, 'nz-badminton-free', 'trial' FROM tenants WHERE slug = 'hanoi-smash'`);
    await c.query(`UPDATE club_plans SET ends_at = now() + interval '1 second' WHERE ends_at IS NULL AND tenant_id = (SELECT id FROM tenants WHERE slug = 'hanoi-smash')`);
    await c.query(`INSERT INTO club_plans (tenant_id, plan_id) SELECT id, 'vn-standard' FROM tenants WHERE slug = 'hanoi-smash'`);
    process.env.TENANT_SLUG = "hanoi-smash";
    resetEntitlementsCache();
    assert.deepEqual(await clubPlan(c), { id: "vn-standard", tiers: ["free", "standard"], limits: { "email.sent": 3 }, status: "active" });
  });

  test("usage is counted per club, metric and month, and never mixes clubs", async () => {
    const nov = new Date("2026-11-23T10:00:00Z");
    const dec = new Date("2026-12-01T00:00:01Z");
    await recordUsage(c, "email.sent", 1, nov);
    await recordUsage(c, "email.sent", 2, nov);
    await recordUsage(c, "storage.bytes_uploaded", 5_000_000_000, nov);
    await recordUsage(c, "email.sent", 1, dec);
    await recordUsage(c, "email.sent", 0, nov);
    await recordUsage(c, "email.sent", -5, nov);
    await recordUsage(c, "email.sent", Number.NaN, nov);
    process.env.TENANT_SLUG = "hanoi-smash";
    resetEntitlementsCache();
    for (let i = 0; i < 4; i++) await recordUsage(c, "email.sent", 1, nov);
    const { rows } = await c.query(`SELECT t.slug, u.metric, u.period::text AS period, u.quantity::text AS quantity FROM usage_counters u JOIN tenants t ON t.id = u.tenant_id ORDER BY t.slug, u.metric, u.period`);
    assert.deepEqual(rows, [
      { slug: "hanoi-smash", metric: "email.sent", period: "2026-11-01", quantity: "4" },
      { slug: "three-wolves", metric: "email.sent", period: "2026-11-01", quantity: "3" },
      { slug: "three-wolves", metric: "email.sent", period: "2026-12-01", quantity: "1" },
      { slug: "three-wolves", metric: "storage.bytes_uploaded", period: "2026-11-01", quantity: "5000000000" },
    ]);
    // Hanoi Smash is over its limit of 3 emails: reported, not blocked (the 4th was sent and counted).
    const report = await usageReport(c, nov);
    assert.equal(report.plan?.id, "vn-standard");
    assert.deepEqual(report.rows.map((r) => r.metric), Object.keys(USAGE_METRICS));
    const email = report.rows.find((r) => r.metric === "email.sent")!;
    assert.deepEqual({ state: email.state, used: email.used, limit: email.limit, period: email.period }, { state: "over", used: 4, limit: 3, period: "2026-11-01" });
    assert.equal(report.rows.find((r) => r.metric === "sms.sent")!.state, "none");
    // Three Wolves: counted, with no limits set.
    delete process.env.TENANT_SLUG;
    resetEntitlementsCache();
    const tw = await usageReport(c, nov);
    assert.deepEqual(tw.rows.map((r) => [r.metric, r.used, r.state]), [["email.sent", 3, "none"], ["sms.sent", 0, "none"], ["storage.bytes_uploaded", 5_000_000_000, "none"], ["payments.created", 0, "none"]]);
  });

  test("a count that can't be written is dropped, never thrown", async () => {
    resetEntitlementsCache();
    await recordUsage({ query: async () => { throw new Error("down"); } }, "email.sent");
    await assert.rejects(c.query(`INSERT INTO usage_counters (tenant_id, metric, period, quantity) VALUES (1, 'email.sent', '2026-11-15', 1)`), /usage_counters_period_check/);
    await assert.rejects(c.query(`INSERT INTO usage_counters (tenant_id, metric, period, quantity) VALUES (1, 'Email Sent', '2026-11-01', 1)`), /usage_counters_metric_check/);
  });
});
