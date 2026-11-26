// Phase 3b step 7: a guardian exports and deletes their child's information
// (lib/juniors/data-rights.ts). Against a real Postgres, through the app's
// own database layer. Made-up children only.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `juniors_rights_${process.pid}`;

describe("a guardian exports and deletes their child's information", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let lib: typeof import("../lib/db.ts");
  let database: typeof import("../lib/database.ts");
  let bookings: typeof import("../lib/juniors/bookings.ts");
  let family: typeof import("../lib/juniors/family.ts");
  let care: typeof import("../lib/juniors/care.ts");
  let forms: typeof import("../lib/juniors/forms.ts");
  let rights: typeof import("../lib/juniors/data-rights.ts");
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
    await c.query(`INSERT INTO players (id, email, first_name, last_name) VALUES (1, 'mia@jr.test', 'Mia', 'Guardian'), (2, 'pete@jr.test', 'Pete', 'Guardian'), (3, 'quinn@jr.test', 'Quinn', 'Nobody')`);
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    delete process.env.VERCEL_ENV;
    database = await import("../lib/database.ts");
    lib = await import("../lib/db.ts");
    bookings = await import("../lib/juniors/bookings.ts");
    family = await import("../lib/juniors/family.ts");
    care = await import("../lib/juniors/care.ts");
    forms = await import("../lib/juniors/forms.ts");
    rights = await import("../lib/juniors/data-rights.ts");
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
  const vault = () => care.juniorsVault(ENV);
  const OWNER = { playerId: 3, access: { role: "owner", platformAdmin: false } as never };
  const TODAY = "2031-01-01";
  const ok = <T,>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
    assert.ok(r.ok, JSON.stringify(r));
    return r.value;
  };
  const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);
  /** Everything a child can have: contacts, a note, a signature, a past booking with a mark, a coming booking. */
  const fill = async (guardian: number, child: number) => {
    ok(await care.setEmergencyContacts(c, 1, guardian, child, [{ name: "Nan Guardian", phone: "021 555 0101", relationship: "Grandmother" }]));
    ok(await care.setMedicalNotes(c, vault(), 1, guardian, child, "Asthma: blue inhaler.", ENV));
    const slug = `waiver-${child}`;
    const form = ok(await forms.publishForm(c, 1, OWNER, { slug, kind: "waiver", title: "Junior waiver", body: "Words." }));
    ok(await forms.signForm(c, 1, guardian, child, form.id, "Mia Guardian"));
    const past = await open();
    assert.equal((await book(guardian, child, past, { paymentIntentId: `pi_${child}_${past}`, amountMinor: 1000, currency: "NZD" })).outcome, "booked");
    await c.query(`INSERT INTO junior_attendance (tenant_id, session_date, junior_profile_id, source, recorded_by_user_id) VALUES (1, $1, $2, 'coach', 3)`, [past, child]);
    return { past };
  };
  const rowsFor = async (child: number) => {
    const n = async (t: string) => (await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE junior_profile_id = $1`, [child])).rows[0].n as number;
    return { notes: await n("junior_medical_notes"), contacts: await n("junior_emergency_contacts"), signatures: await n("form_signatures"), bookings: await n("junior_bookings"), attendance: await n("junior_attendance") };
  };

  test("the export holds everything about the child, the medical note in plain words; only their guardian can ask", async () => {
    const { past } = await fill(MIA, tama);
    const e = ok(await rights.exportChild(c, vault(), 1, MIA, tama, { now: new Date("2031-06-01T00:00:00Z"), env: ENV }));
    assert.equal(e.exportedAt, "2031-06-01T00:00:00.000Z");
    assert.deepEqual([e.child.name, e.child.birthYear, e.guardians], ["Tama Testchild", 2019, 1]);
    assert.deepEqual([e.consent.leaderboard, e.consent.photos, e.consent.vision, !!e.consent.confirmedAt], [false, false, false, true]);
    assert.deepEqual(e.bookings.map((b) => [b.date, b.status, b.amountMinor, b.currency]), [[past, "confirmed", 1000, "NZD"]]);
    assert.deepEqual(e.attendance.map((a) => a.date), [past]);
    assert.deepEqual(e.emergencyContacts, [{ position: 1, name: "Nan Guardian", phone: "021 555 0101", relationship: "Grandmother" }]);
    assert.deepEqual(e.medicalNotes, { notes: "Asthma: blue inhaler." });
    assert.deepEqual(e.forms.map((f) => [f.title, f.kind, f.version, f.signedName]), [["Junior waiver", "waiver", 1, "Mia Guardian"]]);
    // No key on the deployment: the export still comes, and says the note couldn't be opened.
    assert.deepEqual(ok(await rights.exportChild(c, care.juniorsVault({}), 1, MIA, tama, { env: {} })).medicalNotes, { unavailable: true });
    // Someone else, another club, no such child.
    assert.equal(code(await rights.exportChild(c, vault(), 1, PETE, tama, { env: ENV })), "not_found");
    assert.equal(code(await rights.exportChild(c, vault(), 2, MIA, tama, { env: ENV })), "not_found");
    assert.equal(code(await rights.exportChild(c, vault(), 1, MIA, 999999, { env: ENV })), "not_found");
    // A child with nothing recorded exports empty lists and no note.
    const bare = ok(await rights.exportChild(c, vault(), 1, PETE, ben, { env: ENV }));
    assert.deepEqual([bare.bookings, bare.attendance, bare.emergencyContacts, bare.medicalNotes, bare.forms], [[], [], [], null, []]);
  });

  test("deleting: refused without the confirmation, for someone else's child, and while a coming place is held", async () => {
    await fill(PETE, ben);
    const coming = await open();
    assert.equal((await book(PETE, ben, coming)).outcome, "booked");
    const before = await rowsFor(ben);
    assert.equal(code(await rights.deleteChild(database.sql, 1, PETE, ben, { confirm: false, today: TODAY })), "confirm_required");
    assert.equal(code(await rights.deleteChild(database.sql, 1, PETE, ben, { confirm: "yes" as never, today: TODAY })), "confirm_required");
    assert.equal(code(await rights.deleteChild(database.sql, 1, MIA, ben, { confirm: true, today: TODAY })), "not_found");
    assert.equal(code(await rights.deleteChild(database.sql, 2, PETE, ben, { confirm: true, today: TODAY })), "not_found");
    assert.equal(code(await rights.deleteChild(database.sql, 1, PETE, ben, { confirm: true, today: TODAY })), "has_bookings");
    assert.deepEqual(await rowsFor(ben), before, "nothing was removed");
    assert.equal((await c.query(`SELECT name FROM junior_profiles WHERE id = $1`, [ben])).rows[0].name, "Ben Testchild");
    // The coming place cancelled: now it goes through (next test covers what it does).
    const id = (await c.query(`SELECT id FROM junior_bookings WHERE junior_profile_id = $1 AND session_date = $2`, [ben, coming])).rows[0].id;
    assert.equal((await bookings.cancelChildBooking(database.sql, 1, PETE, id)).outcome, "cancelled");
    // Still refused while "today" is before the other place the child holds; once that day has passed it goes through.
    assert.equal(code(await rights.deleteChild(database.sql, 1, PETE, ben, { confirm: true, today: TODAY })), "has_bookings");
    ok(await rights.deleteChild(database.sql, 1, PETE, ben, { confirm: true, today: "2040-01-01" }));
  });

  test("deleting removes the note, contacts and signatures, empties the profile, ends the guardianship; dated records stay with nothing that names the child", async () => {
    const mine = (await family.listChildren(c, 1, MIA)).find((ch) => ch.id === tama)!;
    assert.equal(mine.name, "Tama Testchild");
    const r = ok(await rights.deleteChild(database.sql, 1, MIA, tama, { confirm: true, today: "2040-01-01" }));
    assert.deepEqual(r, { removed: { medicalNotes: 1, emergencyContacts: 1, signatures: 1 }, kept: { bookings: 1, attendance: 1 } });
    assert.deepEqual(await rowsFor(tama), { notes: 0, contacts: 0, signatures: 0, bookings: 1, attendance: 1 });
    const profile = (await c.query(`SELECT name, birth_year, deleted_at IS NOT NULL AS deleted FROM junior_profiles WHERE id = $1`, [tama])).rows[0];
    assert.deepEqual(profile, { name: rights.DELETED_CHILD_NAME, birth_year: null, deleted: true });
    const g = (await c.query(`SELECT ended_at IS NOT NULL AS ended, consent_scope FROM guardianships WHERE junior_profile_id = $1`, [tama])).rows;
    assert.deepEqual(g, [{ ended: true, consent_scope: {} }]);
    // The child's name is nowhere in the database any more.
    const hits = (await c.query(`SELECT (SELECT count(*) FROM junior_profiles WHERE name ILIKE '%Tama%')::int AS n`)).rows[0].n;
    assert.equal(hits, 0);
    // Gone for the guardian: not listed, can't be exported, booked, or deleted twice.
    assert.equal((await family.listChildren(c, 1, MIA)).some((ch) => ch.id === tama), false);
    assert.equal(code(await rights.exportChild(c, vault(), 1, MIA, tama, { env: ENV })), "not_found");
    assert.equal((await book(MIA, tama, await open())).outcome, "not_found");
    assert.equal(code(await rights.deleteChild(database.sql, 1, MIA, tama, { confirm: true, today: TODAY })), "not_found");
    // The day's count of places is untouched by a deletion.
    const past = (await c.query(`SELECT session_date::text AS d FROM junior_bookings WHERE junior_profile_id = $1`, [tama])).rows[0].d;
    assert.equal((await c.query(`SELECT booked_spots FROM sessions WHERE date = $1`, [past])).rows[0].booked_spots, 1);
  });

  test("two guardians: either can delete, and it ends it for both", async () => {
    const kid = await (async () => {
      const r = await family.addChild(c, 1, MIA, { name: "Shared Testchild", birthYear: 2019, guardianConfirmed: true }, { year: 2031 });
      assert.ok(r.ok);
      return r.value.id;
    })();
    await c.query(`INSERT INTO guardianships (tenant_id, guardian_user_id, junior_profile_id, consent_at, consent_scope) SELECT tenant_id, $2, junior_profile_id, now(), consent_scope FROM guardianships WHERE junior_profile_id = $1`, [kid, PETE]);
    assert.equal(ok(await rights.exportChild(c, vault(), 1, PETE, kid, { env: ENV })).guardians, 2);
    ok(await rights.deleteChild(database.sql, 1, PETE, kid, { confirm: true, today: TODAY }));
    assert.equal((await family.listChildren(c, 1, MIA)).some((ch) => ch.id === kid), false);
    assert.deepEqual((await c.query(`SELECT count(*)::int AS n FROM guardianships WHERE junior_profile_id = $1 AND ended_at IS NULL`, [kid])).rows[0], { n: 0 });
  });
});
