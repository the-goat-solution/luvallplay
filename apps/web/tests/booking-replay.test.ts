// A replayed Stripe event and a casual booking (audit H3).
//
// Stripe delivers events at least once. The booking used to raise the play
// day's count first and write the booking second ("ON CONFLICT DO NOTHING"),
// so a replay counted the same person twice, and a replay on a day that had
// since filled looked "full" and refunded someone who had their spot. These
// tests replay the same payment, in turn and at the same moment, against a
// real Postgres, at the function and through the webhook route itself.
//
// Needs Postgres (DATA_GUARD_TEST_URL's server). CI sets
// DATA_GUARD_REQUIRE_DB=1, so it can't be skipped silently.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import Stripe from "stripe";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `booking_replay_${process.pid}`;
const WEBHOOK_SECRET = "whsec_booking_replay_test";

describe("a casual booking is counted once", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let lib: typeof import("../lib/db.ts");
  let database: typeof import("../lib/database.ts");
  let effects: typeof import("../lib/side-effects.ts");
  let POST: (request: Request) => Promise<Response>;
  const KEYS = ["DATABASE_DRIVER", "POSTGRES_URL", "STRIPE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY", "VERCEL_ENV", "EMAIL_FROM", "RESEND_API_KEY"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const originalError = console.error;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  // Play days far enough ahead to be nobody's membership day in an empty club.
  let d = 0;
  const freshDay = () => `2031-03-${String(++d).padStart(2, "0")}`;
  const who = (pi: string) => ({ firstName: "Casey", lastName: "Casual", email: `${pi}@replay.test`, paymentIntentId: pi });
  const state = async (date: string) => {
    const booked = (await c.query(`SELECT booked_spots FROM sessions WHERE date = $1`, [date])).rows[0]?.booked_spots ?? 0;
    const rows = (await c.query(`SELECT count(*)::int AS n FROM bookings WHERE session_date = $1`, [date])).rows[0].n;
    return { booked: booked as number, rows: rows as number };
  };
  /** Fills the day and says how many spots it had. */
  const fill = async (date: string, prefix: string) => {
    let n = 0;
    while ((await lib.reserveBookingSlotOnce(date, who(`${prefix}_${n}`))) === "reserved") n++;
    assert.ok(n > 0 && n < 200, `the day holds ${n} casual players`);
    return n;
  };

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
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_booking_replay";
    delete process.env.VERCEL_ENV; // not production: email is captured, never sent
    process.env.EMAIL_FROM = "Club <club@replay.test>";
    process.env.RESEND_API_KEY = "re_captured_never_sent";
    database = await import("../lib/database.ts");
    lib = await import("../lib/db.ts");
    effects = await import("../lib/side-effects.ts");
    ({ POST } = await import("../app/api/stripe-webhook/route.ts"));
  });
  after(async () => {
    console.error = originalError;
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

  test("the same payment twice: one booking, the count goes up by one", async () => {
    const date = freshDay();
    assert.equal(await lib.reserveBookingSlotOnce(date, who("pi_twice")), "reserved");
    assert.equal(await lib.reserveBookingSlotOnce(date, who("pi_twice")), "already");
    assert.deepEqual(await state(date), { booked: 1, rows: 1 });
    // The older name answers "they have their spot" both times.
    assert.equal(await lib.reserveBookingSlot(date, who("pi_twice")), true);
    assert.deepEqual(await state(date), { booked: 1, rows: 1 });
  });

  test("the same payment 12 times at the same moment: still one booking and one count", async () => {
    const date = freshDay();
    const results = await Promise.all(Array.from({ length: 12 }, () => lib.reserveBookingSlotOnce(date, who("pi_storm"))));
    assert.equal(results.filter((r) => r === "reserved").length, 1);
    assert.equal(results.filter((r) => r === "already").length, 11);
    assert.deepEqual(await state(date), { booked: 1, rows: 1 });
  });

  test("a replay on a day that has since filled is 'already', not 'full': the person who has the last spot isn't refunded", async () => {
    const date = freshDay();
    const spots = await fill(date, "pi_fill");
    assert.deepEqual(await state(date), { booked: spots, rows: spots }, "a refused booking leaves no row behind");
    for (let i = 0; i < spots; i++) assert.equal(await lib.reserveBookingSlotOnce(date, who(`pi_fill_${i}`)), "already");
    assert.equal(await lib.reserveBookingSlotOnce(date, who("pi_latecomer")), "full");
    assert.equal(await lib.reserveBookingSlot(date, who("pi_latecomer")), false);
    assert.deepEqual(await state(date), { booked: spots, rows: spots });
  });

  test("more people than spots at the same moment: exactly the spots are sold, each once", async () => {
    const probe = freshDay();
    const spots = await fill(probe, "pi_probe");
    const date = freshDay();
    const results = await Promise.all(Array.from({ length: spots + 7 }, (_, i) => lib.reserveBookingSlotOnce(date, who(`pi_rush_${i}`))));
    assert.equal(results.filter((r) => r === "reserved").length, spots);
    assert.equal(results.filter((r) => r === "full").length, 7);
    assert.deepEqual(await state(date), { booked: spots, rows: spots });
  });

  // ---- Through the webhook route: Stripe's own event, signed, delivered again ----

  const stripe = new Stripe("sk_test_booking_replay");
  const deliver = (event: object) => {
    const body = JSON.stringify(event);
    return POST(new Request("http://localhost/api/stripe-webhook", {
      method: "POST",
      body,
      headers: { "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET }) },
    }));
  };
  const paid = (pi: string, date: string) => ({
    id: `evt_${pi}`,
    object: "event",
    type: "payment_intent.succeeded",
    data: { object: { id: pi, object: "payment_intent", amount: 1500, currency: "nzd", receipt_email: null, customer: null, metadata: { type: "casual", sessionDate: date, firstName: "Casey", lastName: "Casual", email: `${pi}@replay.test` } } },
  });

  test("the webhook: one event delivered three times books once and confirms once", async () => {
    const date = freshDay();
    effects.clearCapturedOutbox();
    for (let i = 0; i < 3; i++) assert.equal((await deliver(paid("pi_hook", date))).status, 200);
    assert.deepEqual(await state(date), { booked: 1, rows: 1 });
    const mail = effects.capturedOutbox().filter((m) => m.to.includes("pi_hook@replay.test"));
    assert.equal(mail.length, 1, `one confirmation email, got: ${mail.map((m) => m.subject).join(" | ")}`);
  });

  test("the webhook: a replay after the day filled changes nothing, refunds nobody and alerts nobody", async () => {
    const date = freshDay();
    assert.equal((await deliver(paid("pi_last_spot", date))).status, 200);
    await fill(date, "pi_rest");
    const before = await state(date);
    effects.clearCapturedOutbox();
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      assert.equal((await deliver(paid("pi_last_spot", date))).status, 200);
    } finally {
      console.error = originalError;
    }
    assert.deepEqual(await state(date), before);
    // The "full" path logs, tries a refund and emails the person and the admins; none of that happened.
    assert.deepEqual(errors, []);
    assert.deepEqual(effects.capturedOutbox().map((m) => m.subject), []);
    assert.equal((await c.query(`SELECT status FROM bookings WHERE payment_intent_id = 'pi_last_spot'`)).rows[0].status, "confirmed");
  });

  test("the webhook: a bad signature is refused before anything is read", async () => {
    const date = freshDay();
    const r = await POST(new Request("http://localhost/api/stripe-webhook", { method: "POST", body: JSON.stringify(paid("pi_forged", date)), headers: { "stripe-signature": "t=1,v1=00" } }));
    assert.equal(r.status, 400);
    assert.deepEqual(await state(date), { booked: 0, rows: 0 });
  });
});

if (!BASE_URL && REQUIRE_DB) {
  test("the booking replay tests are required in CI", () => assert.fail("DATA_GUARD_REQUIRE_DB=1 but DATA_GUARD_TEST_URL is not set"));
}
