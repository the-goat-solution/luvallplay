// The shared rate limiter and the handled-Stripe-events list (audit H6, H3;
// migration 0014), on a real Postgres.
//
// - rateLimit() with RATE_LIMIT_STORE=database keeps one count for every
//   server instance; without the switch, or when the database can't
//   answer, it counts on this instance as before.
// - A Stripe event handled to the end is skipped when delivered again.
//
// Needs Postgres (DATA_GUARD_TEST_URL's server). CI sets
// DATA_GUARD_REQUIRE_DB=1, so it can't be skipped silently.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import Stripe from "stripe";
import { migrate, loadMigrations } from "../scripts/db/migrate.mjs";
import { rateLimit, rateLimitStore } from "../lib/security.ts";
import { markStripeEventHandled, stripeEventHandled } from "../lib/stripe-events.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `rate_limit_${process.pid}`;
const WEBHOOK_SECRET = "whsec_rate_limit_test";

test("the store is the instance's memory unless RATE_LIMIT_STORE=database", () => {
  assert.equal(rateLimitStore({}), "memory");
  assert.equal(rateLimitStore({ RATE_LIMIT_STORE: "" }), "memory");
  assert.equal(rateLimitStore({ RATE_LIMIT_STORE: "redis" }), "memory");
  assert.equal(rateLimitStore({ RATE_LIMIT_STORE: " Database " }), "database");
});

describe("rate limits and handled Stripe events in the database", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  // Two pools stand for two server instances: separate connections, one database.
  let instanceA: pg.Pool;
  let instanceB: pg.Pool;
  const KEYS = ["RATE_LIMIT_STORE", "DATABASE_DRIVER", "POSTGRES_URL", "STRIPE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY", "VERCEL_ENV", "EMAIL_FROM", "RESEND_API_KEY"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const originalWarn = console.warn;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  let n = 0;
  const key = () => `test:203.0.113.${++n}`;

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
    instanceA = new pg.Pool({ connectionString: urlFor(NAME), max: 5 });
    instanceB = new pg.Pool({ connectionString: urlFor(NAME), max: 5 });
    process.env.RATE_LIMIT_STORE = "database";
  });
  after(async () => {
    console.warn = originalWarn;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await instanceA?.end();
    await instanceB?.end();
    await (await import("../lib/database.ts")).closeDatabase();
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("60 requests at once across two instances, limit 10: exactly 10 get through", async () => {
    const k = key();
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => rateLimit(k, 10, 60_000, i % 2 ? instanceA : instanceB)));
    assert.equal(results.filter(Boolean).length, 10);
    // And the eleventh, later, on either instance.
    assert.equal(await rateLimit(k, 10, 60_000, instanceA), false);
    assert.equal(await rateLimit(k, 10, 60_000, instanceB), false);
    // Someone else has their own count.
    assert.equal(await rateLimit(key(), 10, 60_000, instanceA), true);
  });

  test("the count starts again when the window has passed", async () => {
    const k = key();
    for (let i = 0; i < 3; i++) assert.equal(await rateLimit(k, 3, 60_000, instanceA), true);
    assert.equal(await rateLimit(k, 3, 60_000, instanceB), false);
    await c.query(`UPDATE rate_limits SET reset_at = NOW() - INTERVAL '1 second' WHERE count >= 3`);
    assert.equal(await rateLimit(k, 3, 60_000, instanceB), true);
    assert.equal((await c.query(`SELECT count FROM rate_limits ORDER BY reset_at DESC LIMIT 1`)).rows[0].count, 1);
  });

  test("no address or email is stored: the key is kept as a hash", async () => {
    await rateLimit("auth-email:198.51.100.77:someone@example.test", 5, 60_000, instanceA);
    const { rows } = await c.query(`SELECT key_hash FROM rate_limits`);
    assert.ok(rows.length > 0);
    for (const r of rows) assert.match(r.key_hash, /^[0-9a-f]{64}$/);
  });

  test("when the database can't answer, it counts on this instance: nobody is let through without a limit, nobody is locked out", async () => {
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    const broken = { query: async () => { throw new Error("connection refused"); } };
    const k = key();
    try {
      const results = [];
      for (let i = 0; i < 5; i++) results.push(await rateLimit(k, 3, 60_000, broken));
      assert.deepEqual(results, [true, true, true, false, false]);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(warnings.length, 1, "said once, not on every request");
  });

  test("without the switch nothing is written to the database", async () => {
    const before = (await c.query(`SELECT count(*)::int AS n FROM rate_limits`)).rows[0].n;
    delete process.env.RATE_LIMIT_STORE;
    try {
      const k = key();
      assert.deepEqual([await rateLimit(k, 1, 60_000, instanceA), await rateLimit(k, 1, 60_000, instanceA)], [true, false]);
    } finally {
      process.env.RATE_LIMIT_STORE = "database";
    }
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM rate_limits`)).rows[0].n, before);
  });

  test("a handled Stripe event is remembered; marking twice is fine", async () => {
    assert.equal(await stripeEventHandled("evt_one", instanceA), false);
    await markStripeEventHandled("evt_one", "payment_intent.succeeded", instanceA);
    await markStripeEventHandled("evt_one", "payment_intent.succeeded", instanceB);
    assert.equal(await stripeEventHandled("evt_one", instanceB), true);
    assert.equal(await stripeEventHandled("evt_two", instanceB), false);
  });

  test("before the migration has run, the app carries on: no limit is lost and every event is handled as before", async () => {
    const old = `${NAME}_before`;
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${old} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${old}`);
    const pool = new pg.Pool({ connectionString: urlFor(old), max: 2 });
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const oc = new pg.Client({ connectionString: urlFor(old) });
      await oc.connect();
      await migrate(oc, { migrations: loadMigrations().filter((m: { tag: string }) => !m.tag.endsWith("rate_limits_stripe_events")), log: () => {} });
      await oc.end();
      const k = key();
      assert.deepEqual([await rateLimit(k, 2, 60_000, pool), await rateLimit(k, 2, 60_000, pool), await rateLimit(k, 2, 60_000, pool)], [true, true, false]);
      assert.equal(await stripeEventHandled("evt_any", pool), false);
      await markStripeEventHandled("evt_any", "invoice.payment_succeeded", pool); // doesn't throw
    } finally {
      console.warn = originalWarn;
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${old} WITH (FORCE)`);
      await admin.end();
    }
  });

  test("the webhook: an event delivered again after it was handled is answered and skipped", async () => {
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_rate_limit";
    process.env.EMAIL_FROM = "Club <club@replay.test>";
    process.env.RESEND_API_KEY = "re_captured_never_sent";
    delete process.env.VERCEL_ENV; // not production: email is captured, never sent
    const { POST } = await import("../app/api/stripe-webhook/route.ts");
    const stripe = new Stripe("sk_test_rate_limit");
    const event = {
      id: "evt_donation_once",
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_donation_once", object: "payment_intent", amount: 2000, currency: "nzd", receipt_email: null, customer: null, metadata: { type: "donation", email: "donor@replay.test", firstName: "Dee", lastName: "Donor" } } },
    };
    const deliver = async () => {
      const body = JSON.stringify(event);
      const r = await POST(new Request("http://localhost/api/stripe-webhook", { method: "POST", body, headers: { "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET }) } }));
      return [r.status, await r.json()];
    };
    assert.deepEqual(await deliver(), [200, { received: true }]);
    assert.deepEqual(await deliver(), [200, { received: true, duplicate: true }]);
    assert.deepEqual(await deliver(), [200, { received: true, duplicate: true }]);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM donations WHERE stripe_payment_intent_id = 'pi_donation_once'`)).rows[0].n, 1);
    assert.deepEqual((await c.query(`SELECT type FROM stripe_events WHERE event_id = 'evt_donation_once'`)).rows, [{ type: "payment_intent.succeeded" }]);
  });
});

if (!BASE_URL && REQUIRE_DB) {
  test("the rate limit tests are required in CI", () => assert.fail("DATA_GUARD_REQUIRE_DB=1 but DATA_GUARD_TEST_URL is not set"));
}
