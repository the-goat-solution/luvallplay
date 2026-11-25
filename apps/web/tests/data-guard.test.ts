// Data guard tests.
//
// Part 1 (always runs): diff rules on hand-made snapshots.
// Part 2 (needs Postgres): real migrations on a copy of the club schema
//   (tests/fixtures/data-guard/club.sql). Safe changes must pass; every
//   dangerous change must be caught. Set DATA_GUARD_TEST_URL to a scratch
//   database, e.g. postgres://postgres:postgres@localhost:5432/dg_test.
//   CI sets DATA_GUARD_REQUIRE_DB=1 so these can't be skipped silently.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import {
  DEFAULT_CONFIG,
  ExpectationsSchema,
  checkSnapshot,
  diffSnapshots,
  hasErrors,
  personHash,
  type Expectations,
  type Finding,
  type PersonSnap,
  type Snapshot,
} from "../scripts/data-guard/core.ts";
import { takeSnapshot } from "../scripts/data-guard/pg.ts";

const DB_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const FIXTURE = readFileSync(new URL("./fixtures/data-guard/club.sql", import.meta.url), "utf8");

const expect = (x: Partial<Expectations> = {}): Expectations => ExpectationsSchema.parse({ change: "test", description: "test change", ...x });
const errorCodes = (f: Finding[]) => [...new Set(f.filter((x) => x.level === "error").map((x) => x.code))].sort();
const byCode = (f: Finding[], code: string) => f.filter((x) => x.code === code);

// ---------------------------------------------------------------------------
// Part 1: rules on hand-made snapshots
// ---------------------------------------------------------------------------

function person(id: string, email: string, extra: Partial<PersonSnap> = {}): PersonSnap {
  return { id, emailHash: personHash(email), emailEmpty: !email, deleted: false, phoneHash: null, liveSessions: 0, sessionsExpireAt: null, links: {}, ...extra };
}
function snap(people: PersonSnap[], extra: Partial<Snapshot> = {}): Snapshot {
  return { version: 1, takenAt: "2026-11-22T00:00:00.000Z", label: "", identityTable: "players", tables: {}, people, orphans: {}, ...extra };
}

describe("data guard rules", () => {
  test("an identical snapshot passes", () => {
    const s = snap([person("1", "a@x.test", { liveSessions: 1, links: { "bookings.email": 3 } })]);
    assert.deepEqual(errorCodes(diffSnapshots(s, structuredClone(s))), []);
  });

  test("a natural session expiry between snapshots is not a sign-out", () => {
    const before = snap([person("1", "a@x.test", { liveSessions: 1, sessionsExpireAt: "2026-11-22T06:00:00.000Z" })]);
    const after = snap([person("1", "a@x.test")], { takenAt: "2026-11-22T07:00:00.000Z" });
    assert.deepEqual(errorCodes(diffSnapshots(before, after)), []);
    const early = snap([person("1", "a@x.test")], { takenAt: "2026-11-22T05:00:00.000Z" });
    assert.deepEqual(errorCodes(diffSnapshots(before, early)), ["SIGNED_OUT"]);
  });

  test("a deliberate sign-out of everyone needs a written reason", () => {
    const before = snap([person("1", "a@x.test", { liveSessions: 2, sessionsExpireAt: "2027-01-01T00:00:00.000Z" })]);
    const after = snap([person("1", "a@x.test")]);
    assert.deepEqual(errorCodes(diffSnapshots(before, after)), ["SIGNED_OUT"]);
    assert.deepEqual(errorCodes(diffSnapshots(before, after, expect({ allowSignOut: { reason: "Session secret rotated after a leak" } }))), []);
    assert.throws(() => expect({ allowSignOut: { reason: "x" } }));
  });

  test("every allowance must carry a reason", () => {
    assert.throws(() => expect({ allowDataLoss: [{ target: "bookings.email", reason: "" }] }));
    assert.throws(() => ExpectationsSchema.parse({ change: "x", description: "y", allowDataLoss: ["bookings.email"] }));
  });

  test("an account found again by email after an id change keeps its data checks", () => {
    const before = snap([person("7", "a@x.test", { links: { "bookings.email": 4 } })]);
    const after = snap([person("uuid-7", "a@x.test", { links: { "bookings.email": 3 } })]);
    assert.deepEqual(errorCodes(diffSnapshots(before, after)), ["DATA_LOST"]);
  });

  test("renamed tables and columns carry person links across", () => {
    const before = snap([person("1", "a@x.test", { links: { "player_photos.player_id": 2, "memberships.email[status=active]": 1 } })]);
    const after = snap([person("1", "a@x.test", { links: { "photos.user_id": 2, "memberships.email[status=active]": 1 } })], { identityTable: "users" });
    const x = expect({ renamedTables: { player_photos: "photos" }, renamedColumns: { "player_photos.player_id": "photos.user_id" } });
    assert.deepEqual(errorCodes(diffSnapshots(before, after, x)), []);
    assert.deepEqual(errorCodes(diffSnapshots(before, after)), ["DATA_LOST"]);
  });

  test("duplicate emails and verified phones are caught on any snapshot", () => {
    const s = snap([
      person("1", "a@x.test", { phoneHash: "p1" }),
      person("2", "a@x.test"),
      person("3", "b@x.test", { phoneHash: "p1" }),
      person("4", "a@x.test", { deleted: true }),
    ]);
    const f = checkSnapshot(s);
    assert.deepEqual(errorCodes(f), ["DUPLICATE_EMAIL", "DUPLICATE_VERIFIED_PHONE"]);
    assert.deepEqual(byCode(f, "DUPLICATE_EMAIL")[0].people, ["1", "2"]);
  });

  test("losing the accounts table is fatal", () => {
    const before = snap([person("1", "a@x.test")]);
    assert.deepEqual(errorCodes(diffSnapshots(before, snap([], { identityTable: null }))), ["NO_ACCOUNTS_TABLE"]);
  });

  test("account samples are capped but the full count is kept", () => {
    const people = Array.from({ length: 30 }, (_, i) => person(String(i), `p${i}@x.test`));
    const f = byCode(diffSnapshots(snap(people), snap([])), "ACCOUNT_MISSING")[0];
    assert.equal(f.count, 30);
    assert.equal(f.people?.length, 20);
  });
});

// ---------------------------------------------------------------------------
// Part 2: real migrations on Postgres
// ---------------------------------------------------------------------------

const skip = !DB_URL ? (REQUIRE_DB ? false : "set DATA_GUARD_TEST_URL to run the Postgres scenarios") : false;

if (!DB_URL && REQUIRE_DB) {
  test("Postgres scenarios are required in CI", () => assert.fail("DATA_GUARD_REQUIRE_DB=1 but DATA_GUARD_TEST_URL is not set"));
}

let counter = 0;
async function withSchema<T>(fn: (schema: string, exec: (sql: string) => Promise<void>) => Promise<T>): Promise<T> {
  const schema = `dg_${process.pid}_${Date.now()}_${counter++}`;
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  const exec = async (sql: string) => {
    await client.query(`SET search_path TO ${schema}`);
    await client.query(sql);
  };
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await exec(FIXTURE);
    return await fn(schema, exec);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
}

/** Fixture → snapshot → change → snapshot → diff. */
async function rehearse(changeSql: string, x: Partial<Expectations> = {}): Promise<{ findings: Finding[]; before: Snapshot; after: Snapshot }> {
  return withSchema(async (schema, exec) => {
    const config = { ...DEFAULT_CONFIG, schema };
    const before = await takeSnapshot(DB_URL!, { config });
    await exec(changeSql);
    const after = await takeSnapshot(DB_URL!, { config });
    return { findings: diffSnapshots(before, after, expect(x)), before, after };
  });
}

describe("data guard on Postgres", { skip }, () => {
  test("the fixture itself is healthy and fully understood", async () => {
    const { before, findings } = await rehearse("SELECT 1");
    assert.deepEqual(errorCodes(findings), []);
    assert.equal(before.people.length, 200);
    assert.equal(before.people.filter((p) => p.deleted).length, 4);
    assert.equal(before.tables.players.rows, 200);
    // Capitalised/padded emails still resolve to their account.
    const p7 = before.people.find((p) => p.id === "7")!;
    assert.equal(p7.emailHash, personHash("player7@example.test"));
    assert.ok(p7.links["attendance.email"] > 0, "attendance linked by email despite ' Player7@Example.TEST '");
    assert.equal(p7.links["memberships.email[status=active]"], 1);
    // Person links found through foreign keys and configured extras.
    const p1 = before.people.find((p) => p.id === "1")!;
    assert.ok(p1.links["player_photos.player_id"] === 2);
    assert.ok(p1.links["arena_challenges.p1"] === 1);
    assert.ok(p1.liveSessions >= 1);
    // Guests and account-less members are orphans, and the paying ones are flagged.
    assert.equal(before.orphans["memberships.email[status=active]"], 2);
    const check = checkSnapshot(before);
    assert.deepEqual(errorCodes(check), []);
    assert.equal(byCode(check, "ACTIVE_MEMBERSHIP_WITHOUT_ACCOUNT")[0].count, 2);
    // Money totals are recorded.
    assert.ok(Number(before.tables.finance_entries.columns.amount_cents.sum) > 0);
  });

  test("snapshots are deterministic and cannot write", async () => {
    await withSchema(async (schema) => {
      const config = { ...DEFAULT_CONFIG, schema };
      const a = await takeSnapshot(DB_URL!, { config });
      const b = await takeSnapshot(DB_URL!, { config });
      assert.deepEqual({ ...a, takenAt: "" }, { ...b, takenAt: "" });
      // A write inside a snapshot transaction is refused by Postgres itself.
      const client = new pg.Client({ connectionString: DB_URL });
      await client.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await assert.rejects(client.query(`DELETE FROM ${schema}.players`), /read-only transaction/);
      await client.query("ROLLBACK");
      await client.end();
    });
  });

  // ---- Safe changes: must pass ----

  test("SAFE · Phase 1 roles table: Timba and Kelcee become owners", async () => {
    const { findings, after } = await rehearse(`
      CREATE TABLE club_roles (player_id INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK (role IN ('owner','admin','coach')), granted_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO club_roles (player_id, role) VALUES (1, 'owner'), (2, 'owner');
    `);
    assert.deepEqual(errorCodes(findings), []);
    assert.equal(after.people.find((p) => p.id === "1")!.links["club_roles.player_id[role=owner]"], 1);
  });

  test("SAFE · roles table with nobody in it is caught (nobody could reach admin)", async () => {
    const { findings } = await rehearse(`CREATE TABLE club_roles (player_id INT PRIMARY KEY REFERENCES players(id), role TEXT NOT NULL);`);
    assert.deepEqual(errorCodes(findings), ["AFTER_NO_ADMIN"]);
  });

  test("SAFE · Phase 3 multi-tenant backfill: tenant_id on every table, Three Wolves = club 1", async () => {
    const { findings } = await rehearse(`
      CREATE TABLE tenants (id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, timezone TEXT NOT NULL);
      INSERT INTO tenants (slug, name, timezone) VALUES ('three-wolves', 'Three Wolves Badminton Club', 'Pacific/Auckland');
      DO $$ DECLARE t TEXT; BEGIN
        FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name NOT IN ('tenants','players','legacy_notes') LOOP
          EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id INT REFERENCES tenants(id)', t);
          EXECUTE format('UPDATE %I SET tenant_id = 1', t);
          EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', t);
        END LOOP; END $$;
      -- link email-keyed rows to accounts by id, keeping the email
      ALTER TABLE memberships ADD COLUMN player_id INT REFERENCES players(id);
      UPDATE memberships m SET player_id = p.id FROM players p WHERE lower(trim(p.email)) = lower(trim(m.email)) AND p.deleted_at IS NULL;
    `);
    assert.deepEqual(errorCodes(findings), []);
  });

  test("SAFE · players renamed to users when the rename is declared", async () => {
    const sql = `ALTER TABLE players RENAME TO users; ALTER TABLE player_photos RENAME COLUMN player_id TO user_id;`;
    const declared = await rehearse(sql, { renamedTables: { players: "users" }, renamedColumns: { "player_photos.player_id": "player_photos.user_id" } });
    assert.deepEqual(errorCodes(declared.findings), []);
    assert.equal(declared.after.identityTable, "users");
    const undeclared = await rehearse(sql);
    assert.ok(errorCodes(undeclared.findings).includes("TABLE_DROPPED"));
    assert.ok(errorCodes(undeclared.findings).includes("COLUMN_DROPPED"));
  });

  test("SAFE · email clean-up (trim + lowercase) passes only when declared", async () => {
    const sql = `UPDATE players SET email = lower(trim(email));`;
    const declared = await rehearse(sql, { allowChangedColumns: [{ target: "players.email", reason: "Store emails normalised; sign-in already normalises" }] });
    assert.deepEqual(errorCodes(declared.findings), []);
    assert.deepEqual(errorCodes((await rehearse(sql)).findings), ["VALUES_CHANGED"]);
  });

  test("SAFE · reviewed duplicate merge: data moves to the kept account, the duplicate is retired", async () => {
    const sql = `
      UPDATE player_photos SET player_id = 1 WHERE player_id = 4;
      UPDATE player_sessions SET player_id = 1 WHERE player_id = 4;
      UPDATE players SET deleted_at = now() WHERE id = 4;`;
    const { findings } = await rehearse(sql, {
      allowAccountChanges: [{ target: "4", reason: "Duplicate of account 1, confirmed with the member" }],
      allowChangedColumns: [
        { target: "player_photos.player_id", reason: "Photos moved to the kept account" },
        { target: "player_sessions.player_id", reason: "Devices moved to the kept account" },
        { target: "players.deleted_at", reason: "Duplicate retired" },
      ],
    });
    assert.deepEqual(errorCodes(findings), []);
  });

  // ---- Dangerous changes: must be caught ----

  test("CAUGHT · deleting an account (cascades wipe their sessions, photos, messages)", async () => {
    const { findings } = await rehearse(`DELETE FROM players WHERE id = 10;`);
    assert.deepEqual(errorCodes(findings), ["ACCOUNT_MISSING", "ROWS_LOST"]);
    assert.deepEqual(byCode(findings, "ACCOUNT_MISSING")[0].people, ["10"]);
    // The cascade's damage is spelled out table by table.
    const lostTables = byCode(findings, "ROWS_LOST").map((f) => f.target).sort();
    assert.deepEqual(lostTables, ["message_threads", "messages", "player_photos", "player_sessions", "players"]);
  });

  test("CAUGHT · soft-deleting live accounts", async () => {
    const { findings } = await rehearse(`UPDATE players SET deleted_at = now() WHERE id IN (11, 12);`);
    assert.deepEqual(byCode(findings, "ACCOUNT_DELETED")[0].people, ["11", "12"]);
  });

  test("CAUGHT · wiping sessions signs everyone out", async () => {
    const { findings } = await rehearse(`DELETE FROM player_sessions;`);
    assert.ok(errorCodes(findings).includes("SIGNED_OUT"));
    assert.ok(byCode(findings, "SIGNED_OUT")[0].count! > 100);
  });

  test("CAUGHT · changing a sign-in email", async () => {
    const { findings } = await rehearse(`UPDATE players SET email = 'someone-else@example.test' WHERE id = 20;`);
    assert.deepEqual(byCode(findings, "EMAIL_CHANGED")[0].people, ["20"]);
  });

  test("CAUGHT · a buggy normalisation that merges two people into one email", async () => {
    // Two different accounts end up on one address: sign-in becomes ambiguous.
    const { findings } = await rehearse(`UPDATE players SET email = 'PLAYER21@example.test' WHERE id = 22;`);
    const codes = errorCodes(findings);
    assert.ok(codes.includes("EMAIL_CHANGED"));
    assert.ok(codes.includes("AFTER_DUPLICATE_EMAIL"));
  });

  test("CAUGHT · dropping the verified-phone column loses SMS sign-in", async () => {
    const { findings } = await rehearse(`ALTER TABLE players DROP COLUMN phone_verified_at;`);
    const codes = errorCodes(findings);
    assert.ok(codes.includes("COLUMN_DROPPED"));
    assert.ok(codes.includes("PHONE_SIGNIN_LOST"));
  });

  test("CAUGHT · flipping active memberships to cancelled", async () => {
    const { findings } = await rehearse(`UPDATE memberships SET status = 'cancelled' WHERE id <= 10 AND status = 'active';`);
    const lost = byCode(findings, "DATA_LOST").find((f) => f.target === "memberships.email[status=active]");
    assert.ok(lost, "active memberships lost per person");
    assert.ok(errorCodes(findings).includes("VALUES_CHANGED"));
  });

  test("CAUGHT · losing someone's attendance history", async () => {
    const { findings } = await rehearse(`DELETE FROM attendance WHERE email = 'player30@example.test';`);
    const lost = byCode(findings, "DATA_LOST").find((f) => f.target === "attendance.email");
    assert.deepEqual(lost?.people, ["30"]);
  });

  test("CAUGHT · money values rewritten (cents divided by 100)", async () => {
    const { findings } = await rehearse(`UPDATE finance_entries SET amount_cents = amount_cents / 100;`);
    const f = byCode(findings, "VALUES_CHANGED").find((x) => x.target === "finance_entries.amount_cents");
    assert.ok(f && /sum \d+ → \d+/.test(f.message), f?.message);
  });

  test("CAUGHT · rows swapped out under the same count", async () => {
    const { findings } = await rehearse(`DELETE FROM finance_entries WHERE id = 1; INSERT INTO finance_entries (id, entry_date, kind, amount_cents) VALUES (999, '2026-09-01', 'income', 1037);`);
    assert.ok(errorCodes(findings).includes("ROWS_REPLACED"));
  });

  test("CAUGHT · a careless merge without moving data", async () => {
    const { findings } = await rehearse(`UPDATE players SET deleted_at = now() WHERE id = 4;`, { allowChangedColumns: [{ target: "players.deleted_at", reason: "Retire duplicate account" }] });
    assert.ok(errorCodes(findings).includes("ACCOUNT_DELETED"));
  });

  test("CAUGHT · unlinking rows from accounts (owner column nulled)", async () => {
    const { findings } = await rehearse(`UPDATE shop_orders SET player_id = NULL WHERE id <= 5;`);
    const codes = errorCodes(findings);
    assert.ok(codes.includes("DATA_LOST"));
    assert.ok(codes.includes("VALUES_CHANGED"));
  });

  test("CAUGHT · a table without a primary key loses a row", async () => {
    const { findings } = await rehearse(`DELETE FROM legacy_notes WHERE note = 'note 3';`);
    assert.ok(errorCodes(findings).includes("ROWS_LOST"));
  });

  test("SAFE · adding a column to a table without a primary key", async () => {
    const { findings } = await rehearse(`ALTER TABLE legacy_notes ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;`);
    assert.deepEqual(errorCodes(findings), []);
  });

  // ---- Junior profiles: people without an account (Phase 3b) ----
  // Two children of account 1, the second also in the care of account 2,
  // each with bookings and attendance of their own.
  const JUNIORS = `
    CREATE TABLE junior_profiles (id serial PRIMARY KEY, guardian_user_id integer NOT NULL REFERENCES players(id), name text NOT NULL, birth_year smallint, deleted_at timestamptz);
    CREATE TABLE guardianships (guardian_user_id integer NOT NULL REFERENCES players(id), junior_profile_id integer NOT NULL REFERENCES junior_profiles(id), PRIMARY KEY (guardian_user_id, junior_profile_id));
    CREATE TABLE junior_bookings (id serial PRIMARY KEY, junior_profile_id integer NOT NULL REFERENCES junior_profiles(id), booked_by_user_id integer NOT NULL REFERENCES players(id), session_date date NOT NULL, status text NOT NULL);
    CREATE TABLE junior_attendance (junior_profile_id integer NOT NULL REFERENCES junior_profiles(id), session_date date NOT NULL, PRIMARY KEY (junior_profile_id, session_date));
    INSERT INTO junior_profiles (id, guardian_user_id, name, birth_year) VALUES (1, 1, 'Ana', 2015), (2, 1, 'Ben', 2017);
    INSERT INTO guardianships VALUES (1, 1), (1, 2), (2, 2);
    INSERT INTO junior_bookings (junior_profile_id, booked_by_user_id, session_date, status) VALUES (1, 1, '2026-11-06', 'confirmed'), (1, 1, '2026-11-13', 'confirmed'), (2, 1, '2026-11-06', 'confirmed');
    INSERT INTO junior_attendance VALUES (1, '2026-11-06'), (2, '2026-11-06');`;
  async function rehearseJuniors(changeSql: string, x: Partial<Expectations> = {}) {
    return withSchema(async (schema, exec) => {
      const config = { ...DEFAULT_CONFIG, schema };
      await exec(JUNIORS);
      const before = await takeSnapshot(DB_URL!, { config });
      await exec(changeSql);
      const after = await takeSnapshot(DB_URL!, { config });
      return { findings: diffSnapshots(before, after, expect(x)), before, after };
    });
  }

  test("JUNIORS · each profile is a person with rows of their own, and no way to sign in", async () => {
    const { before, findings } = await rehearseJuniors(`SELECT 1;`);
    const ana = before.people.find((p) => p.id === "junior:1")!;
    assert.equal(ana.kind, "dependent");
    assert.equal(ana.liveSessions, 0);
    assert.deepEqual(ana.links, {
      "guardianships.junior_profile_id": 1,
      "junior_attendance.junior_profile_id": 1,
      "junior_bookings.junior_profile_id": 2,
      "junior_bookings.junior_profile_id[status=confirmed]": 2,
    });
    // The guardian's own links name the children they look after and paid for.
    const guardian = before.people.find((p) => p.id === "1")!;
    assert.equal(guardian.links["guardianships.guardian_user_id"], 2);
    assert.equal(guardian.links["junior_bookings.booked_by_user_id"], 3);
    assert.deepEqual(errorCodes(findings), []);
    assert.match(byCode(findings, "SUMMARY")[0].message, /accounts and 2 junior profiles checked, 0 problems/);
    assert.match(byCode(checkSnapshot(before), "SUMMARY")[0].message, /; 2 junior profiles\.$/);
  });

  test("JUNIORS · SAFE · a guardian books another session", async () => {
    const { findings } = await rehearseJuniors(`INSERT INTO junior_bookings (junior_profile_id, booked_by_user_id, session_date, status) VALUES (2, 1, '2026-11-13', 'confirmed');`);
    assert.deepEqual(errorCodes(findings), []);
  });

  test("JUNIORS · CAUGHT · losing one child's attendance names that child", async () => {
    const { findings } = await rehearseJuniors(`DELETE FROM junior_attendance WHERE junior_profile_id = 2;`);
    assert.deepEqual(byCode(findings, "DATA_LOST").find((f) => f.target === "junior_attendance.junior_profile_id")?.people, ["junior:2"]);
  });

  test("JUNIORS · CAUGHT · a profile soft-deleted or gone", async () => {
    const soft = await rehearseJuniors(`UPDATE junior_profiles SET deleted_at = now() WHERE id = 1;`);
    assert.deepEqual(byCode(soft.findings, "DEPENDENT_DELETED")[0].people, ["junior:1"]);
    const hard = await rehearseJuniors(`DELETE FROM junior_attendance WHERE junior_profile_id = 1; DELETE FROM junior_bookings WHERE junior_profile_id = 1; DELETE FROM guardianships WHERE junior_profile_id = 1; DELETE FROM junior_profiles WHERE id = 1;`);
    assert.deepEqual(byCode(hard.findings, "DEPENDENT_MISSING")[0].people, ["junior:1"]);
    // An account is never reported as a junior, or the other way round.
    assert.equal(byCode(hard.findings, "ACCOUNT_MISSING").length, 0);
  });

  test("JUNIORS · CAUGHT · a child left with no guardian", async () => {
    const { findings } = await rehearseJuniors(`DELETE FROM guardianships WHERE junior_profile_id = 1;`);
    assert.deepEqual(byCode(findings, "AFTER_DEPENDENT_WITHOUT_GUARDIAN")[0].people, ["junior:1"]);
  });

  test("JUNIORS · SAFE · a guardian deletes one child's data: declared, and the other child and the guardian are intact", async () => {
    const sql = `DELETE FROM junior_attendance WHERE junior_profile_id = 1; DELETE FROM junior_bookings WHERE junior_profile_id = 1; DELETE FROM guardianships WHERE junior_profile_id = 1; DELETE FROM junior_profiles WHERE id = 1;`;
    const why = "The guardian asked for this child's data to be deleted";
    const declared = await rehearseJuniors(sql, {
      allowAccountChanges: [{ target: "junior:1", reason: why }],
      allowRowDecrease: ["junior_profiles", "guardianships", "junior_bookings", "junior_attendance"].map((target) => ({ target, reason: why })),
    });
    assert.deepEqual(errorCodes(declared.findings), []);
    // Deleting the wrong child's rows under the same declaration is still caught, per person.
    const wrong = await rehearseJuniors(sql.replace("DELETE FROM junior_attendance WHERE junior_profile_id = 1", "DELETE FROM junior_attendance"), {
      allowAccountChanges: [{ target: "junior:1", reason: why }],
      allowRowDecrease: ["junior_profiles", "guardianships", "junior_bookings"].map((target) => ({ target, reason: why })),
    });
    assert.deepEqual(byCode(wrong.findings, "DATA_LOST").find((f) => f.target === "junior_attendance.junior_profile_id")?.people, ["junior:2"]);
  });

  test("JUNIORS · CAUGHT · an allowance that names people excuses only them: another child's lost rows in an allowed table are still reported", async () => {
    const why = "The guardian asked for this child's data to be deleted";
    // Child 1 and their guardian (account 1) are named; child 2 and account 2 are not.
    const forChild1 = (tables: string[]) => ({
      allowAccountChanges: [{ target: "junior:1", reason: why }],
      allowRowDecrease: tables.map((target) => ({ target, reason: why, people: ["junior:1", "1"] })),
    });
    const all = ["junior_profiles", "guardianships", "junior_bookings", "junior_attendance"];
    const right = `DELETE FROM junior_attendance WHERE junior_profile_id = 1; DELETE FROM junior_bookings WHERE junior_profile_id = 1; DELETE FROM guardianships WHERE junior_profile_id = 1; DELETE FROM junior_profiles WHERE id = 1;`;
    assert.deepEqual(errorCodes((await rehearseJuniors(right, forChild1(all))).findings), [], "the declared deletion passes");

    // The same declaration, but the delete also takes the other child's attendance and booking.
    const tooMuch = right.replace("DELETE FROM junior_attendance WHERE junior_profile_id = 1", "DELETE FROM junior_attendance").replace("DELETE FROM junior_bookings WHERE junior_profile_id = 1", "DELETE FROM junior_bookings");
    const caught = await rehearseJuniors(tooMuch, forChild1(all));
    assert.deepEqual(byCode(caught.findings, "DATA_LOST").find((f) => f.target === "junior_attendance.junior_profile_id")?.people, ["junior:2"]);
    assert.deepEqual(byCode(caught.findings, "DATA_LOST").find((f) => f.target === "junior_bookings.junior_profile_id")?.people, ["junior:2"]);

    // The gap this closes: without names, the same allowance excuses everyone in the table.
    const unnamed = await rehearseJuniors(tooMuch, { allowAccountChanges: [{ target: "junior:1", reason: why }], allowRowDecrease: all.map((target) => ({ target, reason: why })) });
    assert.equal(byCode(unnamed.findings, "DATA_LOST").length, 0);

    // The other guardian's link to child 2 is theirs: removing it isn't covered by naming account 1.
    const otherGuardian = await rehearseJuniors(`${right} DELETE FROM guardianships WHERE guardian_user_id = 2;`, forChild1(all));
    assert.deepEqual(byCode(otherGuardian.findings, "DATA_LOST").find((f) => f.target === "guardianships.guardian_user_id")?.people, ["2"]);
  });

  // ---- The command line, end to end ----

  test("CLI rehearse: passes a safe change, fails a bad one, refuses production", { skip: spawnSync("psql", ["--version"]).status !== 0 ? "psql not installed" : false }, async () => {
    const dbName = `dg_cli_${process.pid}_${Date.now()}`;
    const admin = new pg.Client({ connectionString: DB_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(DB_URL!);
    url.pathname = `/${dbName}`;
    const branchUrl = url.toString();
    try {
      const branch = new pg.Client({ connectionString: branchUrl });
      await branch.connect();
      await branch.query(FIXTURE);
      await branch.end();
      const dir = mkdtempSync(join(tmpdir(), "dg-"));
      const xFile = join(dir, "x.json");
      writeFileSync(xFile, JSON.stringify({ change: "0001-club-roles", description: "Roles table, two owners" }));
      const cli = (args: string[], env: Record<string, string | undefined>) =>
        spawnSync(process.execPath, ["scripts/data-guard/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, POSTGRES_URL: undefined, ...env } });

      const ok = cli(
        ["rehearse", "--expect", xFile, "--out-dir", join(dir, "ok"), "--run", `psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -q -c "CREATE TABLE club_roles (player_id INT PRIMARY KEY REFERENCES players(id), role TEXT NOT NULL); INSERT INTO club_roles VALUES (1,'owner');"`],
        { DATA_GUARD_URL: branchUrl },
      );
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.match(ok.stdout, /RESULT: ✔ passed/);
      assert.ok(existsSync(join(dir, "ok", "report.md")));
      assert.ok(!readFileSync(join(dir, "ok", "before.json"), "utf8").includes("@example.test"), "snapshots hold no emails");

      const bad = cli(["rehearse", "--expect", xFile, "--out-dir", join(dir, "bad"), "--run", `psql "$POSTGRES_URL" -q -c "DELETE FROM attendance WHERE email LIKE 'player1%';"`], { DATA_GUARD_URL: branchUrl });
      assert.equal(bad.status, 1, bad.stdout + bad.stderr);
      assert.match(bad.stdout, /DATA_LOST/);
      assert.match(bad.stdout, /RESULT: ✖ FAILED/);

      const refused = cli(["rehearse", "--expect", xFile, "--run", `psql "$POSTGRES_URL" -q -c "DROP TABLE players CASCADE;"`], { DATA_GUARD_URL: branchUrl, POSTGRES_URL: branchUrl });
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /Refusing to rehearse/);
      const prodHost = cli(["rehearse", "--expect", xFile, "--run", "true"], { DATA_GUARD_URL: branchUrl, DATA_GUARD_PRODUCTION_HOSTS: url.hostname });
      assert.equal(prodHost.status, 1);
      assert.match(prodHost.stderr, /DATA_GUARD_PRODUCTION_HOSTS/);
      // The refused run never touched the data.
      const check = new pg.Client({ connectionString: branchUrl });
      await check.connect();
      const { rows } = await check.query("SELECT count(*)::int AS n FROM players");
      await check.end();
      assert.equal(rows[0].n, 200);

      // diff with a broken expectations file is rejected before anything is judged.
      writeFileSync(join(dir, "broken.json"), JSON.stringify({ change: "x", description: "y", allowDataLoss: ["attendance.email"] }));
      const broken = cli(["diff", join(dir, "ok", "before.json"), join(dir, "ok", "after.json"), "--expect", join(dir, "broken.json")], {});
      assert.equal(broken.status, 1);
      assert.match(broken.stderr, /not a valid expectations file/);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });
});

test("the hard-coded data guard config only names real columns of the fixture or future tables", () => {
  // Guards against typos in DEFAULT_CONFIG silently disabling a check.
  for (const ref of DEFAULT_CONFIG.extraPersonColumns) assert.match(ref, /^[a-z_]+\.[a-z0-9_]+$/);
  assert.ok(hasErrors([{ level: "error", code: "X", message: "x" }]));
});
