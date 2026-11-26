// Phase 3b step 4: a child's emergency contacts and medical notes
// (lib/juniors/care.ts). Only the child's guardian writes them; medical notes
// are encrypted before they reach the database and read only by the guardian
// and the club's owners. Against a real Postgres. Made-up children only.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";
import { addChild } from "../lib/juniors/family.ts";
import {
  MAX_EMERGENCY_CONTACTS,
  MEDICAL_NOTES_MAX,
  juniorsVault,
  listEmergencyContacts,
  mayReadMedicalNotes,
  medicalNotesAvailable,
  readMedicalNotesAsGuardian,
  readMedicalNotesForClub,
  setEmergencyContacts,
  setMedicalNotes,
} from "../lib/juniors/care.ts";
import { scopePool } from "../lib/tenant-scope.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `juniors_care_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const YEAR = 2026;
const key = () => randomBytes(32).toString("base64");
const ENV = { JUNIORS_KEKS: `k1:${key()}` };
const vault = juniorsVault(ENV);
const NOTE = "Asthma: blue inhaler in the bag. Allergic to penicillin.";

test("medical notes need a key: with none, or a malformed one, they are unavailable (never plain text)", () => {
  assert.equal(medicalNotesAvailable({}), false);
  assert.equal(medicalNotesAvailable({ JUNIORS_KEKS: "k1:too-short" }), false);
  assert.equal(medicalNotesAvailable(ENV), true);
});

test("who on the club's side may read medical notes: owners only, and never Luvallplay staff by that alone", () => {
  assert.equal(mayReadMedicalNotes({ role: "owner", platformAdmin: false }), true);
  for (const role of ["admin", "coach", "treasurer", null] as const) assert.equal(mayReadMedicalNotes({ role, platformAdmin: false } as never), false, String(role));
  assert.equal(mayReadMedicalNotes({ role: null, platformAdmin: true } as never), false);
});

describe("a child's emergency contacts and medical notes", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
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
  let tama = 0; // Mia's child
  let ben = 0; // Pete's child
  beforeEach(async () => {
    await c.query(`DELETE FROM junior_medical_notes`);
    await c.query(`DELETE FROM junior_emergency_contacts`);
    await c.query(`DELETE FROM guardianships`);
    await c.query(`DELETE FROM junior_profiles`);
    tama = value(await add(MIA, { name: "Tama Testchild" })).id;
    ben = value(await add(PETE, { name: "Ben Testchild" })).id;
  });
  const OWNER = { role: "owner", platformAdmin: false } as never;

  test("emergency contacts: the guardian sets them in order, replaces them, and removes them", async () => {
    const set = value(await setEmergencyContacts(c, 1, MIA, tama, [{ name: "  Nan   Guardian ", phone: "021 555 0101", relationship: "Grandmother" }, { name: "Uncle Rewi", phone: "+64 (21) 555-0102" }]));
    assert.deepEqual(set, [
      { position: 1, name: "Nan Guardian", phone: "021 555 0101", relationship: "Grandmother" },
      { position: 2, name: "Uncle Rewi", phone: "+64 (21) 555-0102", relationship: null },
    ]);
    assert.deepEqual(value(await listEmergencyContacts(c, 1, MIA, tama)), set);
    const row = (await c.query(`SELECT tenant_id, updated_by_user_id FROM junior_emergency_contacts WHERE junior_profile_id = $1 AND position = 1`, [tama])).rows[0];
    assert.deepEqual(row, { tenant_id: 1, updated_by_user_id: MIA });
    // A shorter list replaces the longer one.
    assert.deepEqual(value(await setEmergencyContacts(c, 1, MIA, tama, [{ name: "Uncle Rewi", phone: "021 555 0102" }])), [{ position: 1, name: "Uncle Rewi", phone: "021 555 0102", relationship: null }]);
    assert.deepEqual(value(await setEmergencyContacts(c, 1, MIA, tama, [])), []);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_emergency_contacts`)).rows[0].n, 0);
  });

  test("emergency contacts: what is refused, and that a refusal writes nothing", async () => {
    const ok = { name: "Nan", phone: "021 555 0101" };
    assert.equal(code(await setEmergencyContacts(c, 1, MIA, tama, Array(MAX_EMERGENCY_CONTACTS + 1).fill(ok))), "too_many_contacts");
    assert.equal(code(await setEmergencyContacts(c, 1, MIA, tama, [{ ...ok, name: " " }])), "name_required");
    assert.equal(code(await setEmergencyContacts(c, 1, MIA, tama, [{ ...ok, name: "x".repeat(61) }])), "name_too_long");
    for (const phone of ["", "12345", "call me", "nan@example.test", "0".repeat(16)]) assert.equal(code(await setEmergencyContacts(c, 1, MIA, tama, [{ ...ok, phone }])), "phone_invalid", phone);
    assert.equal(code(await setEmergencyContacts(c, 1, MIA, tama, [{ ...ok, relationship: "x".repeat(41) }])), "relationship_too_long");
    // Not this child's guardian; another club; a child that isn't there.
    assert.equal(code(await setEmergencyContacts(c, 1, PETE, tama, [ok])), "not_found");
    assert.equal(code(await setEmergencyContacts(c, club2, MIA, tama, [ok])), "not_found");
    assert.equal(code(await setEmergencyContacts(c, 1, MIA, 999999, [ok])), "not_found");
    assert.equal(code(await listEmergencyContacts(c, 1, PETE, tama)), "not_found");
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_emergency_contacts`)).rows[0].n, 0);
  });

  test("a medical note is stored encrypted: the database never holds the words, and the guardian reads them back", async () => {
    assert.deepEqual(value(await setMedicalNotes(c, vault, 1, MIA, tama, `  ${NOTE}\r\n`, ENV)), { saved: true });
    const row = (await c.query(`SELECT sealed, updated_by_user_id FROM junior_medical_notes WHERE junior_profile_id = $1`, [tama])).rows[0];
    assert.equal(row.updated_by_user_id, MIA);
    assert.match(row.sealed, /^v1\.k1\./);
    for (const word of ["Asthma", "inhaler", "penicillin"]) assert.ok(!row.sealed.includes(word) && !Buffer.from(row.sealed.split(".")[3], "base64url").toString("latin1").includes(word), word);
    const read = value(await readMedicalNotesAsGuardian(c, vault, 1, MIA, tama, ENV));
    assert.equal(read.notes, NOTE);
    assert.ok(read.updatedAt);
    // Saving again replaces it (one row per child); empty text removes it.
    value(await setMedicalNotes(c, vault, 1, MIA, tama, "No known conditions.", ENV));
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_medical_notes`)).rows[0].n, 1);
    assert.equal(value(await readMedicalNotesAsGuardian(c, vault, 1, MIA, tama, ENV)).notes, "No known conditions.");
    assert.deepEqual(value(await setMedicalNotes(c, vault, 1, MIA, tama, "  ", ENV)), { saved: false });
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_medical_notes`)).rows[0].n, 0);
    assert.deepEqual(value(await readMedicalNotesAsGuardian(c, vault, 1, MIA, tama, ENV)), { notes: "", updatedAt: null });
  });

  test("the database refuses a plain-text note outright", async () => {
    await assert.rejects(c.query(`INSERT INTO junior_medical_notes (tenant_id, junior_profile_id, sealed, updated_by_user_id) VALUES (1, $1, $2, $3)`, [tama, NOTE, MIA]), /junior_medical_notes_sealed_check/);
  });

  test("a note sealed for one child can't be opened as another's, even by copying the row", async () => {
    value(await setMedicalNotes(c, vault, 1, MIA, tama, NOTE, ENV));
    await c.query(`INSERT INTO junior_medical_notes (tenant_id, junior_profile_id, sealed, updated_by_user_id) SELECT tenant_id, $2, sealed, updated_by_user_id FROM junior_medical_notes WHERE junior_profile_id = $1`, [tama, ben]);
    await assert.rejects(readMedicalNotesAsGuardian(c, vault, 1, PETE, ben, ENV), /can't be opened/);
    // A different key can't open it either.
    await assert.rejects(readMedicalNotesAsGuardian(c, juniorsVault({ JUNIORS_KEKS: `k1:${key()}` }), 1, MIA, tama, ENV), /can't be opened/);
    // A rotated key: new notes use the new key, old ones still open.
    const rotated = { JUNIORS_KEKS: `k2:${key()},${ENV.JUNIORS_KEKS}` };
    assert.equal(value(await readMedicalNotesAsGuardian(c, juniorsVault(rotated), 1, MIA, tama, rotated)).notes, NOTE);
    value(await setMedicalNotes(c, juniorsVault(rotated), 1, MIA, tama, NOTE, rotated));
    assert.match((await c.query(`SELECT sealed FROM junior_medical_notes WHERE junior_profile_id = $1`, [tama])).rows[0].sealed, /^v1\.k2\./);
  });

  test("medical notes: what is refused, and that a refusal writes nothing", async () => {
    assert.equal(code(await setMedicalNotes(c, vault, 1, MIA, tama, "x".repeat(MEDICAL_NOTES_MAX + 1), ENV)), "notes_too_long");
    assert.equal(code(await setMedicalNotes(c, vault, 1, PETE, tama, NOTE, ENV)), "not_found");
    assert.equal(code(await setMedicalNotes(c, vault, club2, MIA, tama, NOTE, ENV)), "not_found");
    // No key on the deployment: nothing is saved, and certainly not in plain text.
    assert.equal(code(await setMedicalNotes(c, juniorsVault({}), 1, MIA, tama, NOTE, {})), "notes_unavailable");
    assert.equal(code(await readMedicalNotesAsGuardian(c, juniorsVault({}), 1, MIA, tama, {})), "notes_unavailable");
    assert.equal(code(await readMedicalNotesAsGuardian(c, vault, 1, PETE, tama, ENV)), "not_found");
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_medical_notes`)).rows[0].n, 0);
  });

  test("the club's side: an owner reads a note; an admin, a coach and Luvallplay staff don't; nor an owner of another club", async () => {
    value(await setMedicalNotes(c, vault, 1, MIA, tama, NOTE, ENV));
    assert.equal(value(await readMedicalNotesForClub(c, vault, 1, OWNER, tama, ENV)).notes, NOTE);
    for (const access of [{ role: "admin", platformAdmin: false }, { role: "coach", platformAdmin: false }, { role: null, platformAdmin: true }, { role: null, platformAdmin: false }]) {
      assert.equal(code(await readMedicalNotesForClub(c, vault, 1, access as never, tama, ENV)), "forbidden", JSON.stringify(access));
    }
    assert.equal(code(await readMedicalNotesForClub(c, vault, club2, OWNER, tama, ENV)), "not_found", "the other club has no such child");
    await c.query(`UPDATE junior_profiles SET deleted_at = now() WHERE id = $1`, [tama]);
    assert.equal(code(await readMedicalNotesForClub(c, vault, 1, OWNER, tama, ENV)), "not_found", "a deleted profile");
  });

  test("row-level security: the app's database role sees a child's contacts and note only inside the child's club", async () => {
    value(await setEmergencyContacts(c, 1, MIA, tama, [{ name: "Nan", phone: "021 555 0101" }]));
    value(await setMedicalNotes(c, vault, 1, MIA, tama, NOTE, ENV));
    const count = async (tenant: number, table: string) => (await scopePool(pool, async () => tenant).query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    for (const table of ["junior_emergency_contacts", "junior_medical_notes"]) {
      assert.equal(await count(1, table), 1, table);
      assert.equal(await count(club2, table), 0, table);
    }
  });
});
