// Phase 3b step 6: the junior roster (lib/juniors/roster.ts). No valid safety
// check, no roster. Against a real Postgres, through the app's own database
// layer. Made-up children only.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `juniors_roster_${process.pid}`;

describe("the junior roster", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let lib: typeof import("../lib/db.ts");
  let database: typeof import("../lib/database.ts");
  let bookings: typeof import("../lib/juniors/bookings.ts");
  let family: typeof import("../lib/juniors/family.ts");
  let care: typeof import("../lib/juniors/care.ts");
  let roster: typeof import("../lib/juniors/roster.ts");
  let safety: typeof import("../lib/juniors/safety.ts");
  const KEYS = ["DATABASE_DRIVER", "POSTGRES_URL", "VERCEL_ENV"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const MIA = 1;
  const PETE = 2;
  let tama = 0; // Mia's child
  let ben = 0; // Pete's child
  // Every play day used here is the same weekday (weeks apart), so each holds the same number.
  let week = 0;
  const playDay = () => {
    const d = new Date(Date.UTC(2031, 5, 4 + 7 * week++));
    return d.toISOString().slice(0, 10);
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
    await c.query(`INSERT INTO players (id, email, first_name, last_name) VALUES (1, 'mia@jo.test', 'Mia', 'Guardian'), (2, 'pete@jo.test', 'Pete', 'Guardian'), (3, 'quinn@jo.test', 'Quinn', 'Nobody')`);
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    delete process.env.VERCEL_ENV;
    database = await import("../lib/database.ts");
    lib = await import("../lib/db.ts");
    bookings = await import("../lib/juniors/bookings.ts");
    family = await import("../lib/juniors/family.ts");
    care = await import("../lib/juniors/care.ts");
    roster = await import("../lib/juniors/roster.ts");
    safety = await import("../lib/juniors/safety.ts");
    await c.query(`INSERT INTO club_roles (player_id, role) VALUES (3, 'owner')`);
    const add = async (guardian: number, name: string) => {
      const r = await family.addChild(c, 1, guardian, { name, birthYear: 2019, guardianConfirmed: true }, { year: 2031 });
      assert.ok(r.ok, JSON.stringify(r));
      return r.value.id;
    };
    tama = await add(MIA, "Tama Testchild");
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

  const ENV = { JUNIORS_KEKS: `k1:${Buffer.alloc(32, 9).toString("base64")}` };
  const TODAY = "2031-01-01";
  // 3 is an owner (set up above); 2 (Pete) becomes a coach here; 1 (Mia) is only a guardian.
  const owner = { playerId: 3, access: { role: "owner", platformAdmin: false } as never };
  const coach = { playerId: PETE, access: { role: "coach", platformAdmin: false } as never };
  const ok = <T,>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
    assert.ok(r.ok, JSON.stringify(r));
    return r.value;
  };
  const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);
  const check = (userId: number, expiresOn = "2032-06-01") => safety.recordSafetyCheck(c, 1, owner, { userId, kind: "police-vet", checkedOn: "2030-06-01", expiresOn }, TODAY);

  test("no valid safety check, no roster: not for a coach, not for an owner, not for Luvallplay staff; with one, the day's children by name", async () => {
    await c.query(`INSERT INTO club_roles (player_id, role) VALUES ($1, 'coach')`, [PETE]);
    const date = await open();
    assert.equal((await book(MIA, tama, date)).outcome, "booked");
    assert.equal((await book(PETE, ben, date, { paymentIntentId: "pi_roster", amountMinor: 1000, currency: "NZD" })).outcome, "booked");
    ok(await care.setEmergencyContacts(c, 1, MIA, tama, [{ name: "Nan Guardian", phone: "021 555 0101", relationship: "Grandmother" }]));
    ok(await care.setMedicalNotes(c, care.juniorsVault(ENV), 1, MIA, tama, "Asthma: blue inhaler.", ENV));

    for (const actor of [owner, coach, { playerId: 9, access: { role: null, platformAdmin: true } as never }, { playerId: MIA, access: { role: null, platformAdmin: false } as never }]) {
      assert.equal(code(await roster.juniorRoster(c, 1, actor, date, TODAY)), "forbidden", JSON.stringify(actor));
      assert.equal(code(await roster.rosterDays(c, 1, actor, TODAY)), "forbidden");
      assert.equal(code(await roster.markJuniorAttendance(c, 1, actor, { date, childId: tama, attended: true }, TODAY)), "forbidden");
    }

    ok(await check(PETE));
    assert.deepEqual(ok(await roster.rosterDays(c, 1, coach, TODAY)), [{ date, children: 2 }]);
    const r = ok(await roster.juniorRoster(c, 1, coach, date, TODAY));
    assert.equal(r.canReadMedicalNotes, true, "a coach with a valid check");
    assert.deepEqual(r.children.map((ch) => [ch.name, ch.birthYear, ch.paid, ch.attended, ch.hasMedicalNote]), [["Ben Testchild", 2019, true, false, false], ["Tama Testchild", 2019, false, false, true]]);
    const t = r.children.find((ch) => ch.childId === tama)!;
    assert.deepEqual(t.guardians, [{ name: "Mia Guardian", email: "mia@jo.test", phone: null }]);
    assert.deepEqual(t.emergencyContacts, [{ position: 1, name: "Nan Guardian", phone: "021 555 0101", relationship: "Grandmother" }]);
    // The roster never carries the note's words.
    assert.ok(!JSON.stringify(r).includes("Asthma"));
    // The check expires: the roster closes that day.
    assert.equal(code(await roster.juniorRoster(c, 1, coach, date, "2032-06-01")), "forbidden");
    // Another club sees none of it, whoever asks.
    assert.equal(code(await roster.juniorRoster(c, 2, coach, date, TODAY)), "forbidden");
  });

  test("an admin with a check sees the roster but may not open medical notes; an owner with a check may", async () => {
    await c.query(`INSERT INTO club_roles (player_id, role) VALUES (1, 'admin') ON CONFLICT DO NOTHING`);
    const admin = { playerId: MIA, access: { role: "admin", platformAdmin: false } as never };
    ok(await check(MIA));
    ok(await check(3));
    const date = (await c.query(`SELECT session_date::text AS d FROM junior_bookings ORDER BY session_date LIMIT 1`)).rows[0].d;
    assert.equal(ok(await roster.juniorRoster(c, 1, admin, date, TODAY)).canReadMedicalNotes, false);
    assert.equal(ok(await roster.juniorRoster(c, 1, owner, date, TODAY)).canReadMedicalNotes, true);
  });

  test("marking who came: only a booked child on that day; undone by marking again; a cancelled or deleted child leaves the roster", async () => {
    const date = (await c.query(`SELECT session_date::text AS d FROM junior_bookings ORDER BY session_date LIMIT 1`)).rows[0].d;
    assert.deepEqual(ok(await roster.markJuniorAttendance(c, 1, coach, { date, childId: tama, attended: true }, TODAY)), { attended: true });
    const row = (await c.query(`SELECT source, removed, recorded_by_user_id FROM junior_attendance WHERE junior_profile_id = $1 AND session_date = $2`, [tama, date])).rows[0];
    assert.deepEqual(row, { source: "coach", removed: false, recorded_by_user_id: PETE });
    assert.equal(ok(await roster.juniorRoster(c, 1, coach, date, TODAY)).children.find((ch) => ch.childId === tama)!.attended, true);
    ok(await roster.markJuniorAttendance(c, 1, owner, { date, childId: tama, attended: false }, TODAY));
    assert.deepEqual((await c.query(`SELECT source, removed FROM junior_attendance WHERE junior_profile_id = $1 AND session_date = $2`, [tama, date])).rows, [{ source: "admin", removed: true }]);
    assert.equal(ok(await roster.juniorRoster(c, 1, coach, date, TODAY)).children.find((ch) => ch.childId === tama)!.attended, false);
    // Not booked that day, or no such child: refused, nothing written.
    const other = await open();
    assert.equal(code(await roster.markJuniorAttendance(c, 1, coach, { date: other, childId: tama, attended: true }, TODAY)), "not_found");
    assert.equal(code(await roster.markJuniorAttendance(c, 1, coach, { date, childId: 999999, attended: true }, TODAY)), "not_found");
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_attendance`)).rows[0].n, 1);
    // A cancelled booking leaves the roster.
    const id = (await c.query(`SELECT id FROM junior_bookings WHERE junior_profile_id = $1 AND session_date = $2`, [tama, date])).rows[0].id;
    assert.equal((await bookings.cancelChildBooking(database.sql, 1, MIA, id)).outcome, "cancelled");
    assert.deepEqual(ok(await roster.juniorRoster(c, 1, coach, date, TODAY)).children.map((ch) => ch.name), ["Ben Testchild"]);
    assert.equal(code(await roster.juniorRoster(c, 1, coach, "not-a-date", TODAY)), "not_found");
  });
});
