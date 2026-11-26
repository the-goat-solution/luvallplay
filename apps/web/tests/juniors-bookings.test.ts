// Phase 3b step 5: a child's booking on a play day (lib/juniors/bookings.ts).
//
// A child's booking takes a place through the same guard as an adult's
// casual booking, is written once however often it is asked for, and can be
// made or cancelled only by a guardian of that child. Against a real
// Postgres, through the app's own database layer. Made-up children only.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `juniors_bookings_${process.pid}`;

describe("a child's booking", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let lib: typeof import("../lib/db.ts");
  let database: typeof import("../lib/database.ts");
  let bookings: typeof import("../lib/juniors/bookings.ts");
  let family: typeof import("../lib/juniors/family.ts");
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
  const who = (pi: string) => ({ firstName: "Casey", lastName: "Casual", email: `${pi}@jb.test`, paymentIntentId: pi });
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
    await c.query(`INSERT INTO players (id, email, first_name, last_name) VALUES (1, 'mia@jb.test', 'Mia', 'Guardian'), (2, 'pete@jb.test', 'Pete', 'Guardian'), (3, 'quinn@jb.test', 'Quinn', 'Nobody')`);
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

  test("a guardian books: one row for the child, booked by the guardian, and one place taken", async () => {
    const date = await open();
    const r = await book(MIA, tama, date);
    assert.equal(r.outcome, "booked");
    assert.deepEqual(await state(date), { booked: 1, live: 1, all: 1 });
    const row = (await c.query(`SELECT tenant_id, junior_profile_id, booked_by_user_id, status, payment_intent_id, amount_minor, currency FROM junior_bookings WHERE session_date = $1`, [date])).rows[0];
    assert.deepEqual(row, { tenant_id: 1, junior_profile_id: tama, booked_by_user_id: MIA, status: "confirmed", payment_intent_id: null, amount_minor: null, currency: null });
    // Nothing in the adults' tables: a child is never an adult's booking, on a roster or in the stats.
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM bookings WHERE session_date = $1`, [date])).rows[0].n, 0);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM attendance WHERE session_date = $1`, [date])).rows[0].n, 0);
  });

  test("asked twice, and 12 times at the same moment: still one booking and one place", async () => {
    const date = await open();
    assert.equal((await book(MIA, tama, date)).outcome, "booked");
    const again = await book(MIA, tama, date);
    assert.equal(again.outcome, "already");
    assert.deepEqual(await state(date), { booked: 1, live: 1, all: 1 });

    const other = await open();
    const results = await Promise.all(Array.from({ length: 12 }, () => book(MIA, aroha, other)));
    assert.equal(results.filter((r) => r.outcome === "booked").length, 1);
    assert.equal(results.filter((r) => r.outcome === "already").length, 11);
    assert.deepEqual(await state(other), { booked: 1, live: 1, all: 1 });
  });

  test("two children of one guardian each take their own place", async () => {
    const date = await open();
    assert.equal((await book(MIA, tama, date)).outcome, "booked");
    assert.equal((await book(MIA, aroha, date)).outcome, "booked");
    assert.deepEqual(await state(date), { booked: 2, live: 2, all: 2 });
  });

  test("only a guardian of the child, in the child's club, on a play day that exists (permission matrix: guardian, another guardian, another club)", async () => {
    const date = await open();
    assert.equal((await book(PETE, tama, date)).outcome, "not_found", "another guardian");
    assert.equal((await book(QUINN, tama, date)).outcome, "not_found", "someone with no children");
    assert.equal((await book(MIA, ben, date)).outcome, "not_found", "another guardian's child");
    assert.equal((await book(MIA, tama, date, null, club2)).outcome, "not_found", "asked through another club");
    assert.equal((await book(MIA, 987_654, date)).outcome, "not_found");
    assert.equal((await book(MIA, tama, "2031-01-01")).outcome, "not_found", "no play day that date");
    // A guardianship nobody confirmed, one that ended, and a deleted account give no right to book.
    await c.query(`INSERT INTO guardianships (tenant_id, guardian_user_id, junior_profile_id) VALUES (1, $1, $2)`, [QUINN, tama]);
    assert.equal((await book(QUINN, tama, date)).outcome, "not_found", "not confirmed");
    await c.query(`UPDATE guardianships SET consent_at = now(), ended_at = now() WHERE guardian_user_id = $1`, [QUINN]);
    assert.equal((await book(QUINN, tama, date)).outcome, "not_found", "ended");
    await c.query(`DELETE FROM guardianships WHERE guardian_user_id = $1`, [QUINN]);
    assert.deepEqual(await state(date), { booked: 0, live: 0, all: 0 }, "none of it wrote anything or took a place");
  });

  test("one capacity, shared with adults: a full day is full for a child, and a child's place counts for adults", async () => {
    const full = await open();
    let capacity = 0;
    while ((await lib.reserveBookingSlotOnce(full, who(`pi_f_${capacity}`))) === "reserved") capacity++;
    assert.ok(capacity > 2, `the day holds ${capacity}`);
    assert.equal((await book(MIA, tama, full)).outcome, "full");
    assert.deepEqual(await state(full), { booked: capacity, live: 0, all: 0 }, "the child's row went with the rollback");

    const date = await open();
    assert.equal((await book(MIA, tama, date)).outcome, "booked");
    assert.equal((await book(PETE, ben, date)).outcome, "booked");
    let adults = 0;
    while ((await lib.reserveBookingSlotOnce(date, who(`pi_g_${adults}`))) === "reserved") adults++;
    assert.equal(adults, capacity - 2, "two places were the children's");
    assert.equal((await book(MIA, aroha, date)).outcome, "full");
    assert.equal(await lib.getAvailableSpots(date), 0);
  });

  test("cancelling: the place comes back once; any guardian of the child can, nobody else; then it can be booked again", async () => {
    const date = await open();
    const made = await book(MIA, tama, date);
    assert.equal(made.outcome, "booked");
    const id = (made as { booking: { id: number } }).booking.id;
    for (const [whoId, tenant] of [[PETE, 1], [QUINN, 1], [MIA, club2]] as const) {
      assert.equal((await bookings.cancelChildBooking(database.sql, tenant, whoId, id)).outcome, "not_found");
    }
    assert.deepEqual(await state(date), { booked: 1, live: 1, all: 1 });

    const cancelled = await bookings.cancelChildBooking(database.sql, 1, MIA, id);
    assert.equal(cancelled.outcome, "cancelled");
    assert.deepEqual(await state(date), { booked: 0, live: 0, all: 1 }, "the row is kept, cancelled");
    assert.ok((await c.query(`SELECT cancelled_at FROM junior_bookings WHERE id = $1`, [id])).rows[0].cancelled_at);
    assert.equal((await bookings.cancelChildBooking(database.sql, 1, MIA, id)).outcome, "already");
    assert.deepEqual(await state(date), { booked: 0, live: 0, all: 1 }, "a second cancel frees nothing more");

    assert.equal((await book(MIA, tama, date)).outcome, "booked");
    assert.deepEqual(await state(date), { booked: 1, live: 1, all: 2 });

    // A second guardian of the same child can cancel what the first booked.
    await c.query(`INSERT INTO guardianships (tenant_id, guardian_user_id, junior_profile_id, consent_at) VALUES (1, $1, $2, now())`, [PETE, tama]);
    try {
      const live = (await c.query(`SELECT id FROM junior_bookings WHERE session_date = $1 AND status = 'confirmed'`, [date])).rows[0].id as number;
      assert.equal((await bookings.cancelChildBooking(database.sql, 1, PETE, live)).outcome, "cancelled");
      assert.deepEqual(await state(date), { booked: 0, live: 0, all: 2 });
    } finally {
      await c.query(`DELETE FROM guardianships WHERE guardian_user_id = $1 AND junior_profile_id = $2`, [PETE, tama]);
    }
  });

  test("a paid booking records what was paid, and the same payment arriving again changes nothing", async () => {
    const date = await open();
    const paid = { paymentIntentId: "pi_junior_1", amountMinor: 1000, currency: "NZD" };
    const r = await book(MIA, tama, date, paid);
    assert.equal(r.outcome, "booked");
    assert.deepEqual([(r as { booking: { amountMinor: number | null; currency: string | null } }).booking.amountMinor, (r as { booking: { currency: string | null } }).booking.currency], [1000, "NZD"]);
    assert.equal((await book(MIA, tama, date, paid)).outcome, "already");
    assert.deepEqual(await state(date), { booked: 1, live: 1, all: 1 });
    // The same payment can't book a second child or a second day either.
    const other = await open();
    assert.equal((await book(MIA, aroha, other, paid)).outcome, "not_found");
    assert.deepEqual(await state(other), { booked: 0, live: 0, all: 0 });
  });

  test("a guardian sees their own children's upcoming bookings; the play day shows a count, never a name", async () => {
    const date = await open();
    const later = await open();
    assert.equal((await book(MIA, tama, later)).outcome, "booked");
    assert.equal((await book(MIA, aroha, date)).outcome, "booked");
    assert.equal((await book(PETE, ben, date)).outcome, "booked");
    const mine = await bookings.listChildBookings(database.sql, 1, MIA, date);
    assert.deepEqual(mine.map((b) => [b.childId, b.date]), [[aroha, date], [tama, later]]);
    assert.deepEqual((await bookings.listChildBookings(database.sql, 1, PETE, date)).map((b) => b.childId), [ben]);
    assert.deepEqual(await bookings.listChildBookings(database.sql, 1, QUINN, date), []);
    assert.deepEqual(await bookings.listChildBookings(database.sql, club2, MIA, date), []);
    assert.deepEqual(await bookings.listChildBookings(database.sql, 1, MIA, "2040-01-01"), [], "nothing that far ahead");
    assert.deepEqual(await bookings.juniorCounts(database.sql, 1, [date, later, "2031-01-01"]), { [date]: 2, [later]: 1 });
    assert.deepEqual(await bookings.juniorCounts(database.sql, club2, [date, later]), {});
    assert.deepEqual(await bookings.juniorCounts(database.sql, 1, []), {});
  });
});
