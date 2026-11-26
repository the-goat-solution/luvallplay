// Phase 3b step 3: a guardian's family (build plan §6.8; test plan §3.17).
//
// The library every Family endpoint calls (lib/juniors/family.ts), against a
// real database. The permission-matrix rows for "guardian" and "another
// guardian / another club" are here; the hard rules too: a child has no
// email, phone or login, and nothing about a child is allowed until a
// guardian says so.
//
// Made-up children only.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";
import {
  CHILD_NAME_MAX,
  CONSENT_VERSION,
  MAX_CHILDREN_PER_GUARDIAN,
  addChild,
  childConsent,
  childNameProblem,
  cleanChildName,
  effectiveConsent,
  getChild,
  isGuardianOf,
  isJuniorBirthYear,
  juniorBirthYears,
  listChildren,
  setConsent,
  updateChild,
} from "../lib/juniors/family.ts";
import { scopePool } from "../lib/tenant-scope.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `juniors_family_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const YEAR = 2026;

test("a child's name: tidied, and never an email address, a phone number or a link", () => {
  assert.equal(cleanChildName("  Mai \n  Nguyen\t"), "Mai Nguyen");
  assert.equal(cleanChildName(42), "");
  assert.equal(childNameProblem(""), "name_required");
  for (const ok of ["Mai", "Mai Nguyen", "Nguyễn Thị Mai", "O'Neil-Smith Jr.", "Tama 2", "李小龙"]) assert.equal(childNameProblem(ok), null, ok);
  for (const bad of ["mai@example.test", "Mai 021 555 0101", "Mai +64215550101", "https://mai.example", "www.mai.example", "<b>Mai</b>", "12", "…", "x".repeat(CHILD_NAME_MAX + 1)]) {
    assert.equal(childNameProblem(bad), "name_invalid", bad);
  }
});

test("a junior is under 16: the birth years allowed follow the club's year", () => {
  assert.deepEqual(juniorBirthYears(2026), { min: 2010, max: 2026 });
  for (const y of [2010, 2015, 2026]) assert.equal(isJuniorBirthYear(y, 2026), true, String(y));
  for (const y of [2009, 1990, 2027, 2015.5, "2015", null, undefined]) assert.equal(isJuniorBirthYear(y, 2026), false, String(y));
});

test("two guardians: something is allowed only when both allow it", () => {
  const yes = { leaderboard: true, photos: true, vision: true };
  assert.deepEqual(effectiveConsent([]), { leaderboard: false, photos: false, vision: false }, "no guardian, nothing allowed");
  assert.deepEqual(effectiveConsent([yes]), yes);
  assert.deepEqual(effectiveConsent([yes, { leaderboard: true, photos: false, vision: false }]), { leaderboard: true, photos: false, vision: false });
});

describe("a guardian's family, from the database", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let pool: pg.Pool;
  let club2 = 0;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  // Seed accounts: 3 Mia (a member), 4 and 5 other players, 25 a deleted account.
  const MIA = 3;
  const PETE = 4;
  const QUINN = 5;
  const DELETED = 25;
  const NOW = new Date("2026-11-26T02:00:00.000Z");
  const add = (guardianId: number, over: Record<string, unknown> = {}, tenantId = 1) =>
    addChild(c, tenantId, guardianId, { name: "Test Child", birthYear: 2016, guardianConfirmed: true, ...over }, { year: YEAR, now: NOW });
  const value = <T,>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
    assert.ok(r.ok, JSON.stringify(r));
    return r.value;
  };
  const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

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
    await c.query(SEED);
    club2 = (
      await c.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, 'free', incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
    pool = new pg.Pool({ connectionString: urlFor(NAME), max: 2 });
  });
  after(async () => {
    await pool?.end();
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });
  beforeEach(async () => {
    await c.query(`DELETE FROM guardianships`);
    await c.query(`DELETE FROM junior_profiles`);
  });

  test("a child's profile is a name and a birth year in one club: no email, phone or sign-in anywhere", async () => {
    const { rows } = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'junior_profiles' ORDER BY column_name`);
    assert.deepEqual(rows.map((r) => r.column_name), ["birth_year", "created_at", "deleted_at", "guardian_user_id", "id", "name", "tenant_id"]);
    // Sessions, sign-in codes and messages point at accounts; nothing points them at a child.
    const fks = await c.query(
      `SELECT cl.relname AS t FROM pg_constraint k JOIN pg_class cl ON cl.oid = k.conrelid WHERE k.contype = 'f' AND k.confrelid = 'junior_profiles'::regclass ORDER BY 1`,
    );
    assert.deepEqual([...new Set(fks.rows.map((r) => r.t))], ["guardianships", "junior_attendance", "junior_bookings", "junior_emergency_contacts", "junior_medical_notes"]);
  });

  test("adding a child: stored with the guardian, everything optional off, the consent dated and versioned", async () => {
    const child = value(await add(MIA, { name: "  Mai   Golden ", birthYear: 2015 }));
    assert.deepEqual(
      { ...child, id: 0, addedAt: "" },
      { id: 0, name: "Mai Golden", birthYear: 2015, consent: { leaderboard: false, photos: false, vision: false }, consentAt: NOW.toISOString(), consentVersion: CONSENT_VERSION, addedAt: "", guardians: 1 },
    );
    // guardianships says who the guardian is; the profile's own guardian_user_id is no longer written.
    const row = (await c.query(`SELECT j.tenant_id, j.guardian_user_id, g.guardian_user_id AS g, g.tenant_id AS gt, g.ended_at, g.consent_scope FROM junior_profiles j JOIN guardianships g ON g.junior_profile_id = j.id`)).rows;
    assert.equal(row.length, 1);
    assert.deepEqual([row[0].tenant_id, row[0].guardian_user_id, row[0].g, row[0].gt, row[0].ended_at], [1, null, MIA, 1, null]);
    assert.deepEqual(row[0].consent_scope, { version: CONSENT_VERSION, items: { leaderboard: { granted: false, at: NOW.toISOString() }, photos: { granted: false, at: NOW.toISOString() }, vision: { granted: false, at: NOW.toISOString() } } });
    assert.deepEqual(await listChildren(c, 1, MIA), [child]);
    assert.deepEqual(await childConsent(c, 1, child.id), { leaderboard: false, photos: false, vision: false });
  });

  test("what is refused, and that a refusal writes nothing", async () => {
    assert.equal(code(await add(MIA, { name: "" })), "name_required");
    assert.equal(code(await add(MIA, { name: "kid@example.test" })), "name_invalid");
    assert.equal(code(await add(MIA, { birthYear: 2009 })), "birth_year");
    assert.equal(code(await add(MIA, { birthYear: "2016" })), "birth_year");
    assert.equal(code(await add(MIA, { guardianConfirmed: false })), "consent_required");
    assert.equal(code(await add(MIA, { guardianConfirmed: "true" })), "consent_required", "only a real yes");
    assert.equal(code(await add(DELETED)), "not_found", "a deleted account can't add a child");
    assert.equal(code(await add(999_999)), "not_found");
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_profiles`)).rows[0].n, 0);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM guardianships`)).rows[0].n, 0);
  });

  test("the same child twice is refused; a family has a limit", async () => {
    value(await add(MIA));
    assert.equal(code(await add(MIA, { name: "test child" })), "duplicate");
    value(await add(MIA, { birthYear: 2017 }));
    for (let i = 3; i <= MAX_CHILDREN_PER_GUARDIAN; i++) value(await add(MIA, { name: `Child ${i}` }));
    assert.equal(code(await add(MIA, { name: "One More" })), "too_many");
    assert.equal((await listChildren(c, 1, MIA)).length, MAX_CHILDREN_PER_GUARDIAN);
  });

  test("only the child's guardian, and only in the child's club (permission matrix: guardian, another guardian, another club)", async () => {
    const mine = value(await add(MIA));
    const theirs = value(await add(PETE, { name: "Pete's Child" }));
    // Another guardian.
    assert.deepEqual((await listChildren(c, 1, MIA)).map((x) => x.id), [mine.id]);
    assert.equal(await getChild(c, 1, MIA, theirs.id), null);
    assert.equal(await isGuardianOf(c, 1, MIA, theirs.id), false);
    assert.equal(await isGuardianOf(c, 1, MIA, mine.id), true);
    assert.equal(code(await updateChild(c, 1, MIA, theirs.id, { name: "Renamed" }, { year: YEAR })), "not_found");
    assert.equal(code(await setConsent(c, 1, MIA, theirs.id, { photos: true })), "not_found");
    // Someone with no children, and the same guardian asked through another club.
    assert.deepEqual(await listChildren(c, 1, QUINN), []);
    assert.deepEqual(await listChildren(c, club2, MIA), []);
    assert.equal(await getChild(c, club2, MIA, mine.id), null);
    assert.equal(await isGuardianOf(c, club2, MIA, mine.id), false);
    assert.equal(code(await updateChild(c, club2, MIA, mine.id, { name: "Renamed" }, { year: YEAR })), "not_found");
    assert.equal(code(await setConsent(c, club2, MIA, mine.id, { photos: true })), "not_found");
    assert.deepEqual(await childConsent(c, club2, mine.id), { leaderboard: false, photos: false, vision: false });
    // Nothing changed.
    assert.equal((await getChild(c, 1, PETE, theirs.id))?.name, "Pete's Child");
    assert.deepEqual((await getChild(c, 1, MIA, mine.id))?.consent, { leaderboard: false, photos: false, vision: false });
  });

  test("the same guardian can have children in two clubs, each seen only in its own", async () => {
    const here = value(await add(MIA));
    const there = value(await add(MIA, { name: "Other Club Child" }, club2));
    assert.deepEqual((await listChildren(c, 1, MIA)).map((x) => x.id), [here.id]);
    assert.deepEqual((await listChildren(c, club2, MIA)).map((x) => x.id), [there.id]);
  });

  test("as the app's own database role: one club's connection can't read or write another club's children", async () => {
    const here = value(await add(MIA));
    const asClub2 = scopePool(pool, async () => club2);
    assert.deepEqual(await listChildren(asClub2, 1, MIA), [], "even when the code names the wrong club");
    assert.equal(await getChild(asClub2, 1, MIA, here.id), null);
    await assert.rejects(addChild(asClub2, 1, MIA, { name: "Wrong Club", birthYear: 2016, guardianConfirmed: true }, { year: YEAR }), /row-level security/);
    // The guardianship itself is club-owned: the other club's connection can't see or write it.
    assert.equal((await asClub2.query(`SELECT count(*)::int AS n FROM guardianships`)).rows[0].n, 0);
    await assert.rejects(asClub2.query(`INSERT INTO guardianships (tenant_id, guardian_user_id, junior_profile_id, consent_at) VALUES (1, $1, $2, now())`, [PETE, here.id]), /row-level security/);
    await assert.rejects(c.query(`INSERT INTO guardianships (tenant_id, guardian_user_id, junior_profile_id, consent_at) VALUES ($1, $2, $3, now())`, [club2, PETE, here.id]), /guardianships_junior_in_club_fkey/, "even the owner connection can't put a guardianship in another club");
    const asClub1 = scopePool(pool, async () => 1);
    assert.deepEqual((await listChildren(asClub1, 1, MIA)).map((x) => x.id), [here.id]);
    assert.equal(code(await addChild(asClub1, 1, MIA, { name: "Second Child", birthYear: 2014, guardianConfirmed: true }, { year: YEAR })), "ok");
  });

  test("correcting a name or birth year", async () => {
    const child = value(await add(MIA));
    const other = value(await add(MIA, { name: "Sibling" }));
    assert.equal(value(await updateChild(c, 1, MIA, child.id, { name: " Tama  Golden " }, { year: YEAR })).name, "Tama Golden");
    assert.equal(value(await updateChild(c, 1, MIA, child.id, { birthYear: 2012 }, { year: YEAR })).birthYear, 2012);
    assert.equal(code(await updateChild(c, 1, MIA, child.id, { name: "a@b.test" }, { year: YEAR })), "name_invalid");
    assert.equal(code(await updateChild(c, 1, MIA, child.id, { birthYear: 2001 }, { year: YEAR })), "birth_year");
    assert.equal(code(await updateChild(c, 1, MIA, other.id, { name: "tama golden", birthYear: 2012 }, { year: YEAR })), "duplicate");
    assert.deepEqual(value(await updateChild(c, 1, MIA, child.id, {}, { year: YEAR })), await getChild(c, 1, MIA, child.id));
    assert.equal((await getChild(c, 1, MIA, other.id))?.name, "Sibling");
  });

  test("consent: item by item, dated when it changes, and withdrawn as easily as given", async () => {
    const child = value(await add(MIA, { consent: { photos: true, vision: "yes" } }));
    assert.deepEqual(child.consent, { leaderboard: false, photos: true, vision: false }, "only a real yes switches an item on");
    const later = new Date("2026-12-01T00:00:00.000Z");
    const changed = value(await setConsent(c, 1, MIA, child.id, { leaderboard: true }, { now: later }));
    assert.deepEqual(changed.consent, { leaderboard: true, photos: true, vision: false });
    const scope = (await c.query(`SELECT consent_scope FROM guardianships WHERE junior_profile_id = $1`, [child.id])).rows[0].consent_scope;
    assert.equal(scope.items.leaderboard.at, later.toISOString(), "the changed item has the new date");
    assert.equal(scope.items.photos.at, NOW.toISOString(), "an unchanged item keeps its date");
    assert.deepEqual(await childConsent(c, 1, child.id), { leaderboard: true, photos: true, vision: false });
    const withdrawn = value(await setConsent(c, 1, MIA, child.id, { photos: false, leaderboard: false }));
    assert.deepEqual(withdrawn.consent, { leaderboard: false, photos: false, vision: false });
    assert.equal(withdrawn.consentAt, NOW.toISOString(), "the guardian's own confirmation keeps its date");
  });

  test("a second guardian: both see the child, each has their own answers, and both must agree", async () => {
    const child = value(await add(MIA, { consent: { photos: true, leaderboard: true } }));
    await c.query(`INSERT INTO guardianships (tenant_id, guardian_user_id, junior_profile_id, consent_at, consent_scope) VALUES (1, $1, $2, now(), '{}'::jsonb)`, [PETE, child.id]);
    assert.equal((await getChild(c, 1, MIA, child.id))?.guardians, 2);
    assert.deepEqual((await getChild(c, 1, PETE, child.id))?.consent, { leaderboard: false, photos: false, vision: false });
    assert.deepEqual(await childConsent(c, 1, child.id), { leaderboard: false, photos: false, vision: false }, "one guardian's yes isn't enough");
    value(await setConsent(c, 1, PETE, child.id, { photos: true }));
    assert.deepEqual(await childConsent(c, 1, child.id), { leaderboard: false, photos: true, vision: false });
    assert.deepEqual((await getChild(c, 1, MIA, child.id))?.consent, { leaderboard: true, photos: true, vision: false }, "Mia's own answers are untouched");
  });

  test("a guardianship nobody confirmed gives no access; a deleted profile is gone for everyone", async () => {
    const child = value(await add(MIA));
    await c.query(`INSERT INTO guardianships (tenant_id, guardian_user_id, junior_profile_id) VALUES (1, $1, $2)`, [QUINN, child.id]);
    assert.equal(await isGuardianOf(c, 1, QUINN, child.id), false, "no consent_at, no access");
    assert.deepEqual(await listChildren(c, 1, QUINN), []);
    // A guardian who stepped away keeps their row and loses access; the child's other guardian doesn't.
    await c.query(`INSERT INTO guardianships (tenant_id, guardian_user_id, junior_profile_id, consent_at, ended_at) VALUES (1, $1, $2, now(), now())`, [PETE, child.id]);
    assert.equal(await isGuardianOf(c, 1, PETE, child.id), false, "ended, no access");
    assert.equal(code(await setConsent(c, 1, PETE, child.id, { photos: true })), "not_found");
    assert.equal((await getChild(c, 1, MIA, child.id))?.guardians, 1, "and they no longer count as a guardian");
    assert.deepEqual(await childConsent(c, 1, child.id), { leaderboard: false, photos: false, vision: false });
    await c.query(`UPDATE junior_profiles SET deleted_at = now() WHERE id = $1`, [child.id]);
    assert.deepEqual(await listChildren(c, 1, MIA), []);
    assert.equal(await isGuardianOf(c, 1, MIA, child.id), false);
    assert.equal(code(await setConsent(c, 1, MIA, child.id, { photos: true })), "not_found");
  });
});
