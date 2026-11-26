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

  const ADMIN = { playerId: 3, access: { role: "admin", platformAdmin: false } as never };
  const FAR = "2040-01-01"; // a "today" after every play day used here
  const everywhere = async (child: number) => {
    const n = async (t: string, col = "junior_profile_id") => (await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE ${col} = $1`, [child])).rows[0].n as number;
    return {
      profile: await n("junior_profiles", "id"),
      guardianships: await n("guardianships"),
      notes: await n("junior_medical_notes"),
      contacts: await n("junior_emergency_contacts"),
      signatures: await n("form_signatures"),
      bookings: await n("junior_bookings"),
      attendance: await n("junior_attendance"),
      requests: await n("junior_deletion_requests"),
    };
  };

  test("asking: only the child's guardian, only with the confirmation, not while a coming place is held; asking removes nothing and can be withdrawn", async () => {
    await fill(PETE, ben);
    const before = await everywhere(ben);
    assert.equal(code(await rights.requestChildDeletion(c, 1, PETE, ben, { confirm: false, today: FAR })), "confirm_required");
    assert.equal(code(await rights.requestChildDeletion(c, 1, PETE, ben, { confirm: "yes" as never, today: FAR })), "confirm_required");
    assert.equal(code(await rights.requestChildDeletion(c, 1, MIA, ben, { confirm: true, today: FAR })), "not_found");
    assert.equal(code(await rights.requestChildDeletion(c, 2, PETE, ben, { confirm: true, today: FAR })), "not_found");
    assert.equal(code(await rights.requestChildDeletion(c, 1, PETE, ben, { confirm: true, today: TODAY })), "has_bookings", "the booking in 2031 is still to come on that date");
    assert.deepEqual(await everywhere(ben), before);

    const asked = ok(await rights.requestChildDeletion(c, 1, PETE, ben, { confirm: true, today: FAR }));
    assert.equal(asked.created, true);
    const again = ok(await rights.requestChildDeletion(c, 1, PETE, ben, { confirm: true, today: FAR }));
    assert.deepEqual([again.id, again.created], [asked.id, false], "asking twice is one request");
    assert.deepEqual(await everywhere(ben), { ...before, requests: 1 }, "nothing was removed");
    assert.equal((await rights.pendingDeletionRequest(c, 1, ben))?.id, asked.id);
    // Still exportable and still listed while it waits.
    assert.equal(ok(await rights.exportChild(c, vault(), 1, PETE, ben, { env: ENV })).child.name, "Ben Testchild");

    // Only the guardian withdraws; then nothing is waiting.
    assert.equal(code(await rights.cancelChildDeletion(c, 1, MIA, ben)), "not_found");
    assert.deepEqual(ok(await rights.cancelChildDeletion(c, 1, PETE, ben)), { cancelled: true });
    assert.deepEqual(ok(await rights.cancelChildDeletion(c, 1, PETE, ben)), { cancelled: false });
    assert.equal(await rights.pendingDeletionRequest(c, 1, ben), null);
    assert.equal(code(await rights.confirmChildDeletion(database.sql, 1, OWNER, asked.id, FAR)), "not_found", "a withdrawn request can't be confirmed");
    assert.deepEqual(await everywhere(ben), { ...before, requests: 1 });
  });

  test("the club's list and who may confirm: owners and admins of this club; never a coach, a guardian, Luvallplay staff or another club", async () => {
    const asked = ok(await rights.requestChildDeletion(c, 1, PETE, ben, { confirm: true, today: FAR }));
    const list = ok(await rights.listDeletionRequests(c, 1, OWNER.access));
    assert.deepEqual(list.map((r) => [r.id, r.childId, r.childName, r.guardianName]), [[asked.id, ben, "Ben Testchild", "Pete Guardian"]]);
    assert.deepEqual(ok(await rights.listDeletionRequests(c, 2, OWNER.access)), [], "another club sees none");
    for (const access of [{ role: "coach", platformAdmin: false }, { role: null, platformAdmin: false }, { role: null, platformAdmin: true }]) {
      assert.equal(code(await rights.listDeletionRequests(c, 1, access as never)), "forbidden", JSON.stringify(access));
      assert.equal(code(await rights.confirmChildDeletion(database.sql, 1, { playerId: 9, access: access as never }, asked.id, FAR)), "forbidden");
    }
    assert.equal(code(await rights.confirmChildDeletion(database.sql, 2, OWNER, asked.id, FAR)), "not_found");
    assert.equal(code(await rights.confirmChildDeletion(database.sql, 1, OWNER, 999999, FAR)), "not_found");
    // A place booked after asking still blocks the confirmation.
    assert.equal(code(await rights.confirmChildDeletion(database.sql, 1, OWNER, asked.id, TODAY)), "has_bookings");
    assert.equal((await everywhere(ben)).profile, 1, "nothing was deleted by any of that");
  });

  test("confirmed: everything about the child is gone for good; what survives names no child", async () => {
    const before = await everywhere(ben);
    assert.deepEqual([before.notes, before.contacts, before.signatures, before.bookings, before.attendance, before.guardianships], [1, 1, 1, 1, 1, 1]);
    const asked = (await rights.pendingDeletionRequest(c, 1, ben))!;
    const past = (await c.query(`SELECT session_date::text AS d, payment_intent_id AS pi FROM junior_bookings WHERE junior_profile_id = $1`, [ben])).rows[0];
    const spots = (await c.query(`SELECT booked_spots FROM sessions WHERE date = $1`, [past.d])).rows[0].booked_spots;

    const done = ok(await rights.confirmChildDeletion(database.sql, 1, ADMIN, asked.id, FAR));
    assert.deepEqual(done, { requestId: asked.id, requestedByUserId: PETE, removed: { medicalNotes: 1, emergencyContacts: 1, signatures: 1, attendance: 1, bookings: 1, guardianships: 1 }, paymentRecords: 1 });
    assert.deepEqual(await everywhere(ben), { profile: 0, guardianships: 0, notes: 0, contacts: 0, signatures: 0, bookings: 0, attendance: 0, requests: 0 });
    // The child's name is nowhere.
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_profiles WHERE name ILIKE '%Ben%'`)).rows[0].n, 0);

    // What survives: the decided request (two of them: the withdrawn one and this one), pointing at no child...
    const reqs = (await c.query(`SELECT status, junior_profile_id, requested_by_user_id, decided_by_user_id FROM junior_deletion_requests ORDER BY id`)).rows;
    assert.deepEqual(reqs, [
      { status: "cancelled", junior_profile_id: null, requested_by_user_id: PETE, decided_by_user_id: PETE },
      { status: "confirmed", junior_profile_id: null, requested_by_user_id: PETE, decided_by_user_id: 3 },
    ]);
    // ...one payment record with no child, guardian or day in it...
    const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'junior_payment_records' ORDER BY 1`)).rows.map((r) => r.column_name);
    assert.deepEqual(cols, ["amount_minor", "currency", "payment_intent_id", "recorded_at", "tenant_id"]);
    assert.deepEqual((await c.query(`SELECT tenant_id, payment_intent_id, amount_minor, currency FROM junior_payment_records`)).rows, [{ tenant_id: 1, payment_intent_id: past.pi, amount_minor: 1000, currency: "NZD" }]);
    // ...and the play day's own count of places.
    assert.equal((await c.query(`SELECT booked_spots FROM sessions WHERE date = $1`, [past.d])).rows[0].booked_spots, spots);

    // Gone for the guardian, and it can't be done twice.
    assert.equal((await family.listChildren(c, 1, PETE)).some((ch) => ch.id === ben), false);
    assert.equal(code(await rights.exportChild(c, vault(), 1, PETE, ben, { env: ENV })), "not_found");
    assert.equal(code(await rights.confirmChildDeletion(database.sql, 1, OWNER, asked.id, FAR)), "not_found");
  });

  test("two guardians: either one can ask; the club's confirmation ends it for both", async () => {
    const r = await family.addChild(c, 1, MIA, { name: "Shared Testchild", birthYear: 2019, guardianConfirmed: true }, { year: 2031 });
    assert.ok(r.ok);
    const kid = r.value.id;
    await c.query(`INSERT INTO guardianships (tenant_id, guardian_user_id, junior_profile_id, consent_at, consent_scope) SELECT tenant_id, $2, junior_profile_id, now(), consent_scope FROM guardianships WHERE junior_profile_id = $1`, [kid, PETE]);
    const asked = ok(await rights.requestChildDeletion(c, 1, PETE, kid, { confirm: true, today: FAR }));
    // The other guardian sees it is waiting, and may withdraw it too.
    assert.equal((await rights.pendingDeletionRequest(c, 1, kid))?.id, asked.id);
    ok(await rights.confirmChildDeletion(database.sql, 1, OWNER, asked.id, FAR));
    assert.equal((await family.listChildren(c, 1, MIA)).some((ch) => ch.id === kid), false);
    assert.equal((await everywhere(kid)).guardianships, 0);
  });

  test("the app's database role: a request and a payment record are kept as written (no deleting; a payment record is never changed)", async () => {
    const pool = new pg.Pool({ connectionString: urlFor(NAME), max: 1 });
    const { scopePool } = await import("../lib/tenant-scope.ts");
    try {
      const as = scopePool(pool, async () => 1);
      assert.ok((await as.query(`SELECT count(*)::int AS n FROM junior_deletion_requests`)).rows[0].n > 0);
      await assert.rejects(as.query(`DELETE FROM junior_deletion_requests`), /permission denied/);
      await assert.rejects(as.query(`UPDATE junior_payment_records SET amount_minor = 0`), /permission denied/);
      await assert.rejects(as.query(`DELETE FROM junior_payment_records`), /permission denied/);
      assert.equal((await scopePool(pool, async () => 2).query(`SELECT count(*)::int AS n FROM junior_payment_records`)).rows[0].n, 0, "another club sees none");
    } finally {
      await pool.end();
    }
  });
});
