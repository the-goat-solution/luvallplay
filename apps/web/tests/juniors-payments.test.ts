// Phase 3b step 5: paying for a child's place (lib/juniors/payments.ts).
//
// A payment that succeeds becomes exactly one booking; a payment that can't
// (the day filled, not the child's guardian, Juniors off, a second payment
// for the same place) is refunded in full. Against a real Postgres and the
// fake payment provider. Made-up children only.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `juniors_payments_${process.pid}`;

describe("paying for a child's place", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let lib: typeof import("../lib/db.ts");
  let database: typeof import("../lib/database.ts");
  let bookings: typeof import("../lib/juniors/bookings.ts");
  let family: typeof import("../lib/juniors/family.ts");
  let pay: typeof import("../lib/juniors/payments.ts");
  let provider: typeof import("../lib/payments/index.ts");
  let fake: import("../lib/payments/fake-provider.ts").FakeProvider;
  const KEYS = ["DATABASE_DRIVER", "POSTGRES_URL", "VERCEL_ENV"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const MIA = 1;
  const PETE = 2;
  const QUINN = 3;
  let tama = 0; // Mia's child
  let aroha = 0; // Mia's other child
  let ben = 0; // Pete's child
  let club2 = 0;
  // Every play day used here is the same weekday (weeks apart), so each holds the same number.
  let week = 0;
  const playDay = () => {
    const d = new Date(Date.UTC(2031, 5, 4 + 7 * week++));
    return d.toISOString().slice(0, 10);
  };
  const who = (pi: string) => ({ firstName: "Casey", lastName: "Casual", email: `${pi}@jp.test`, paymentIntentId: pi });
  const state = async (date: string) => {
    const booked = ((await c.query(`SELECT booked_spots FROM sessions WHERE date = $1`, [date])).rows[0]?.booked_spots ?? 0) as number;
    const live = (await c.query(`SELECT count(*)::int AS n FROM junior_bookings WHERE session_date = $1 AND status IN ('pending', 'confirmed')`, [date])).rows[0].n as number;
    const all = (await c.query(`SELECT count(*)::int AS n FROM junior_bookings WHERE session_date = $1`, [date])).rows[0].n as number;
    return { booked, live, all };
  };
  const open = async () => {
    const date = playDay();
    await lib.ensureSession(date);
    return date;
  };
  const book = (guardian: number, child: number, date: string, payment: import("../lib/juniors/bookings.ts").ChildPayment | null = null, tenant = 1) =>
    bookings.bookChild(database.sql, tenant, guardian, child, date, payment);

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
    await c.query(`INSERT INTO players (id, email, first_name, last_name) VALUES (1, 'mia@jp.test', 'Mia', 'Guardian'), (2, 'pete@jp.test', 'Pete', 'Guardian'), (3, 'quinn@jp.test', 'Quinn', 'Nobody')`);
    club2 = (
      await c.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, 'free', incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    delete process.env.VERCEL_ENV;
    database = await import("../lib/database.ts");
    lib = await import("../lib/db.ts");
    bookings = await import("../lib/juniors/bookings.ts");
    family = await import("../lib/juniors/family.ts");
    pay = await import("../lib/juniors/payments.ts");
    provider = await import("../lib/payments/index.ts");
    fake = (await import("../lib/payments/fake-provider.ts")).fakeProvider();
    provider.setPaymentsProvider(fake);
    // Juniors on for club 1 (acknowledged), and offered on this deployment.
    await c.query(
      `INSERT INTO tenant_modules (tenant_id, module_id, enabled, enabled_at, settings) VALUES
         (1, 'forms-waivers', TRUE, now(), '{}'::jsonb),
         (1, 'juniors', TRUE, now(), '{"safeguarding":{"version":"2026-11","byPlayerId":1,"at":"2031-01-01T00:00:00.000Z"}}'::jsonb)`,
    );
    const add = async (guardian: number, name: string) => {
      const r = await family.addChild(c, 1, guardian, { name, birthYear: 2019, guardianConfirmed: true }, { year: 2031 });
      assert.ok(r.ok, JSON.stringify(r));
      return r.value.id;
    };
    tama = await add(MIA, "Tama Testchild");
    aroha = await add(MIA, "Aroha Testchild");
    ben = await add(PETE, "Ben Testchild");
  });
  after(async () => {
    provider?.setPaymentsProvider(null);
    await database?.closeDatabase();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  const ON = { JUNIORS_AVAILABILITY: "available" };
  /** A payment the guardian's card paid, as the webhook hands it over. */
  const paid = async (guardian: number, child: number, date: string, tenant = 1) => {
    const p = await pay.createJuniorPayment({ tenantId: tenant, guardianId: guardian, guardianEmail: "mia@jp.test", childId: child, date });
    fake.pay(p.id);
    return { id: p.id, amount: p.amount, currency: p.currency, metadata: p.metadata };
  };
  const refundedOf = (id: string) => fake.payments.get(id)!.refunded;

  test("what the payment provider is told: ids, the date and the guardian's email; never the child's name or year of birth", async () => {
    const date = await open();
    const p = await pay.createJuniorPayment({ tenantId: 1, guardianId: MIA, guardianEmail: "mia@jp.test", childId: tama, date });
    assert.deepEqual(p.metadata, { type: "junior", tenantId: "1", guardianId: String(MIA), childId: String(tama), sessionDate: date, email: "mia@jp.test" });
    assert.equal(p.amount, pay.JUNIOR_PRICE_MINOR);
    const everything = JSON.stringify(p);
    assert.ok(!/Tama|Testchild|2019/.test(everything), everything);
    assert.deepEqual(await state(date), { booked: 0, live: 0, all: 0 }, "nothing is booked until the money arrives");
  });

  test("the payment succeeds: the place is booked and paid; the same event again changes nothing", async () => {
    const date = await open();
    const pi = await paid(MIA, tama, date);
    assert.deepEqual(await pay.settleJuniorPayment(database.sql, pi, ON), { outcome: "booked" });
    assert.deepEqual(await state(date), { booked: 1, live: 1, all: 1 });
    const row = (await c.query(`SELECT status, payment_intent_id, amount_minor, currency, booked_by_user_id FROM junior_bookings WHERE session_date = $1`, [date])).rows[0];
    assert.deepEqual(row, { status: "confirmed", payment_intent_id: pi.id, amount_minor: pay.JUNIOR_PRICE_MINOR, currency: "NZD", booked_by_user_id: MIA });
    assert.deepEqual(await pay.settleJuniorPayment(database.sql, pi, ON), { outcome: "already" });
    assert.deepEqual(await state(date), { booked: 1, live: 1, all: 1 });
    assert.equal(refundedOf(pi.id), 0);
  });

  test("a second payment for a place the child already holds is refunded in full, and the first stays", async () => {
    const date = await open();
    const first = await paid(MIA, tama, date);
    await pay.settleJuniorPayment(database.sql, first, ON);
    const second = await paid(MIA, tama, date);
    const r = await pay.settleJuniorPayment(database.sql, second, ON);
    assert.deepEqual([r.outcome, "why" in r && r.why], ["refunded", "duplicate"]);
    assert.equal(refundedOf(second.id), second.amount);
    assert.equal(refundedOf(first.id), 0);
    assert.deepEqual(await state(date), { booked: 1, live: 1, all: 1 });
    // The refund is asked for once however often the event arrives.
    await pay.settleJuniorPayment(database.sql, second, ON);
    assert.equal(refundedOf(second.id), second.amount);
  });

  test("the day filled while the guardian was paying: no booking, and the money goes back", async () => {
    const date = await open();
    const pi = await paid(MIA, tama, date);
    let capacity = 0;
    while ((await lib.reserveBookingSlotOnce(date, who(`pi_full_${capacity}`))) === "reserved") capacity++;
    const r = await pay.settleJuniorPayment(database.sql, pi, ON);
    assert.deepEqual(r, { outcome: "refunded", why: "full", sessionDate: date, guardianEmail: "mia@jp.test" });
    assert.equal(refundedOf(pi.id), pi.amount);
    assert.deepEqual(await state(date), { booked: capacity, live: 0, all: 0 });
  });

  test("someone who isn't the child's guardian, or a payment that names nothing real: refunded, nothing booked", async () => {
    const date = await open();
    const stranger = await paid(QUINN, tama, date);
    const a = await pay.settleJuniorPayment(database.sql, stranger, ON);
    assert.deepEqual([a.outcome, "why" in a && a.why], ["refunded", "not_found"]);
    const broken = await paid(MIA, tama, date);
    const b = await pay.settleJuniorPayment(database.sql, { ...broken, metadata: { type: "junior", tenantId: "1", guardianId: "x", childId: String(tama), sessionDate: date } }, ON);
    assert.deepEqual([b.outcome, "why" in b && b.why], ["refunded", "bad_payment"]);
    assert.deepEqual([refundedOf(stranger.id), refundedOf(broken.id)], [stranger.amount, broken.amount]);
    assert.deepEqual(await state(date), { booked: 0, live: 0, all: 0 });
  });

  test("fail closed: Juniors hidden on this deployment, switched off, or another club's payment: refunded, nothing booked", async () => {
    const date = await open();
    const hidden = await paid(MIA, tama, date);
    const a = await pay.settleJuniorPayment(database.sql, hidden, { VERCEL_ENV: "production", JUNIORS_AVAILABILITY: "available" });
    assert.deepEqual([a.outcome, "why" in a && a.why], ["refunded", "module_off"]);
    const otherClub = await paid(MIA, tama, date, club2);
    const b = await pay.settleJuniorPayment(database.sql, otherClub, ON);
    assert.deepEqual([b.outcome, "why" in b && b.why], ["refunded", "module_off"]);
    await c.query(`UPDATE tenant_modules SET enabled = FALSE WHERE module_id = 'juniors'`);
    const off = await paid(MIA, tama, date);
    const d = await pay.settleJuniorPayment(database.sql, off, ON);
    await c.query(`UPDATE tenant_modules SET enabled = TRUE WHERE module_id = 'juniors'`);
    assert.deepEqual([d.outcome, "why" in d && d.why], ["refunded", "module_off"]);
    assert.deepEqual([refundedOf(hidden.id), refundedOf(otherClub.id), refundedOf(off.id)], [hidden.amount, otherClub.amount, off.amount]);
    assert.deepEqual(await state(date), { booked: 0, live: 0, all: 0 });
  });

  test("the refund itself fails: said plainly so a person is told, and still nothing is booked", async () => {
    const date = await open();
    const pi = await paid(QUINN, tama, date);
    const r = await pay.settleJuniorPayment(database.sql, { ...pi, id: "pi_unknown_to_the_provider" }, ON);
    assert.equal(r.outcome, "refund_failed");
    assert.deepEqual(await state(date), { booked: 0, live: 0, all: 0 });
  });
});
