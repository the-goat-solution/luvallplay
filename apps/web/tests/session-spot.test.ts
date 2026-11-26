// The two halves of a play day's place count (lib/db.ts): claimSessionSpot
// and releaseSessionSpot.
//
// They were taken out of the casual booking's own code so that a second kind
// of booking (a child's, Phase 3b step 5) takes a place through exactly the
// same guard. What matters here: the guard is the adults' one (the same
// capacity, shared), a claim lives and dies with its transaction, and the
// adults' functions behave as before (tests/booking-replay.test.ts and the
// golden master cover those, untouched).
//
// Needs Postgres (DATA_GUARD_TEST_URL's server). CI sets
// DATA_GUARD_REQUIRE_DB=1, so it can't be skipped silently.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `session_spot_${process.pid}`;

describe("a play day's places: claim and release", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let lib: typeof import("../lib/db.ts");
  let database: typeof import("../lib/database.ts");
  const KEYS = ["DATABASE_DRIVER", "POSTGRES_URL", "VERCEL_ENV"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  // Play days far enough ahead to be nobody's membership day in an empty club.
  let d = 0;
  const freshDay = () => `2031-04-${String(++d).padStart(2, "0")}`;
  // Two play days a week apart: the same weekday, so the same courts and the same capacity.
  let w = 9;
  const sameWeekdayPair = (): [string, string] => {
    w++;
    return [`2031-05-${String(w).padStart(2, "0")}`, `2031-05-${String(w + 7).padStart(2, "0")}`];
  };
  const who = (pi: string) => ({ firstName: "Casey", lastName: "Casual", email: `${pi}@spot.test`, paymentIntentId: pi });
  const booked = async (date: string) => ((await c.query(`SELECT booked_spots FROM sessions WHERE date = $1`, [date])).rows[0]?.booked_spots ?? 0) as number;
  /** One claim in its own transaction, committed or rolled back. */
  const claim = async (date: string, end: "COMMIT" | "ROLLBACK" = "COMMIT") => {
    const client = await database.sql.connect();
    try {
      await client.query("BEGIN");
      const ok = await lib.claimSessionSpot(client, date);
      await client.query(end);
      return ok;
    } finally {
      client.release();
    }
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
    delete process.env.VERCEL_ENV;
    database = await import("../lib/database.ts");
    lib = await import("../lib/db.ts");
  });
  after(async () => {
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

  test("a claim takes one place; rolled back, the place is free again", async () => {
    const date = freshDay();
    await lib.ensureSession(date);
    assert.equal(await claim(date), true);
    assert.equal(await booked(date), 1);
    assert.equal(await claim(date, "ROLLBACK"), true, "it was taken inside the transaction…");
    assert.equal(await booked(date), 1, "…and given back with it");
  });

  test("a play day that doesn't exist has no place to take", async () => {
    assert.equal(await claim("2031-04-30"), false);
    assert.equal(await booked("2031-04-30"), 0);
  });

  test("one capacity, shared: claims and adults' casual bookings fill the same play day", async () => {
    // How many the day holds, measured with the adults' own function.
    const [measure, date] = sameWeekdayPair();
    let capacity = 0;
    while ((await lib.reserveBookingSlotOnce(measure, who(`pi_m_${capacity}`))) === "reserved") capacity++;
    assert.ok(capacity > 2 && capacity < 200, `the day holds ${capacity}`);
    assert.equal(await claim(measure), false, "full for adults is full for a claim");
    assert.equal(await booked(measure), capacity);

    // Half by claims, the rest by adults: the day is full at the same number, for both.
    await lib.ensureSession(date);
    const half = Math.floor(capacity / 2);
    for (let i = 0; i < half; i++) assert.equal(await claim(date), true, `claim ${i}`);
    let adults = 0;
    while ((await lib.reserveBookingSlotOnce(date, who(`pi_s_${adults}`))) === "reserved") adults++;
    assert.equal(half + adults, capacity);
    assert.equal(await lib.reserveBookingSlotOnce(date, who("pi_s_one_more")), "full");
    assert.equal(await claim(date), false);
    assert.equal(await booked(date), capacity);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM bookings WHERE session_date = $1`, [date])).rows[0].n, adults, "a claim writes no adult booking");
  });

  test("many claims at the same moment never go past capacity", async () => {
    const [measure, date] = sameWeekdayPair();
    let capacity = 0;
    while ((await lib.reserveBookingSlotOnce(measure, who(`pi_c_${capacity}`))) === "reserved") capacity++;
    assert.ok(capacity > 2, `the day holds ${capacity}`);
    await lib.ensureSession(date);
    const results = await Promise.all(Array.from({ length: capacity + 6 }, () => claim(date)));
    assert.equal(results.filter(Boolean).length, capacity);
    assert.equal(await booked(date), capacity);
  });

  test("a release gives one place back and never goes below zero", async () => {
    const date = freshDay();
    await lib.ensureSession(date);
    assert.equal(await claim(date), true);
    assert.equal(await claim(date), true);
    await lib.releaseSessionSpot(database.sql, date);
    assert.equal(await booked(date), 1);
    await lib.releaseSessionSpot(database.sql, date);
    await lib.releaseSessionSpot(database.sql, date);
    assert.equal(await booked(date), 0);
    // Inside a transaction that is rolled back, the release is undone too.
    assert.equal(await claim(date), true);
    const client = await database.sql.connect();
    try {
      await client.query("BEGIN");
      await lib.releaseSessionSpot(client, date);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    assert.equal(await booked(date), 1);
  });

  test("removing an adult's booking frees its place once, and a booking that isn't there frees nothing (as before)", async () => {
    const date = freshDay();
    assert.equal(await lib.reserveBookingSlotOnce(date, who("pi_r_1")), "reserved");
    assert.equal(await lib.reserveBookingSlotOnce(date, who("pi_r_2")), "reserved");
    const id = (await c.query(`SELECT id FROM bookings WHERE payment_intent_id = 'pi_r_1'`)).rows[0].id as number;
    await lib.removeBooking(id, date);
    assert.equal(await booked(date), 1);
    await lib.removeBooking(id, date);
    await lib.removeBooking(987_654, date);
    assert.equal(await booked(date), 1, "nothing was deleted, so nothing was released");
  });
});
