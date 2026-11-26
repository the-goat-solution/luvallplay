// Phase 3b step 4: a club's forms and waivers and a guardian's signatures
// (lib/juniors/forms.ts). The words of a form are never edited; a new version
// asks every guardian again. Against a real Postgres. Made-up children only.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";
import { addChild } from "../lib/juniors/family.ts";
import { FORM_BODY_MAX, listChildForms, listCurrentForms, mayManageForms, publishForm, retireForm, signForm, unsignedCount } from "../lib/juniors/forms.ts";
import { scopePool } from "../lib/tenant-scope.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `juniors_forms_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const YEAR = 2026;
const OWNER = { playerId: 1, access: { role: "owner", platformAdmin: false } as never };
const ADMIN = { playerId: 1, access: { role: "admin", platformAdmin: false } as never };
const WAIVER = { slug: "junior-waiver", kind: "waiver", title: "Junior waiver", body: "I accept the risks of playing badminton for my child." };

test("who may publish a club's forms: owners and admins of the club, nobody else", () => {
  assert.equal(mayManageForms(OWNER.access), true);
  assert.equal(mayManageForms(ADMIN.access), true);
  for (const access of [{ role: "coach", platformAdmin: false }, { role: null, platformAdmin: false }, { role: null, platformAdmin: true }]) assert.equal(mayManageForms(access as never), false, JSON.stringify(access));
});

describe("a club's forms and a guardian's signatures", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
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
    await c.query(`DELETE FROM form_signatures`);
    await c.query(`DELETE FROM club_forms`);
    await c.query(`DELETE FROM guardianships`);
    await c.query(`DELETE FROM junior_profiles`);
    tama = value(await add(MIA, { name: "Tama Testchild" })).id;
    ben = value(await add(PETE, { name: "Ben Testchild" })).id;
  });

  test("publishing: version 1, then new wording is version 2 and only that one is asked for; the same words again publish nothing", async () => {
    const v1 = value(await publishForm(c, 1, OWNER, { ...WAIVER, title: "  Junior   waiver " }));
    assert.deepEqual([v1.slug, v1.version, v1.kind, v1.title, v1.body], ["junior-waiver", 1, "waiver", "Junior waiver", WAIVER.body]);
    assert.equal(code(await publishForm(c, 1, ADMIN, WAIVER)), "unchanged");
    const v2 = value(await publishForm(c, 1, ADMIN, { ...WAIVER, body: "New wording." }));
    assert.equal(v2.version, 2);
    assert.deepEqual((await listCurrentForms(c, 1)).map((f) => [f.id, f.version]), [[v2.id, 2]]);
    // Version 1's words are still there, untouched.
    assert.equal((await c.query(`SELECT body FROM club_forms WHERE id = $1`, [v1.id])).rows[0].body, WAIVER.body);
    assert.deepEqual(await listCurrentForms(c, club2), [], "another club has none of it");
  });

  test("publishing: what is refused, and that a refusal writes nothing", async () => {
    assert.equal(code(await publishForm(c, 1, { playerId: 1, access: { role: "coach", platformAdmin: false } as never }, WAIVER)), "forbidden");
    assert.equal(code(await publishForm(c, 1, { playerId: 1, access: { role: null, platformAdmin: true } as never }, WAIVER)), "forbidden");
    for (const slug of ["", "Junior Waiver", "-x", "x--y", "x".repeat(61)]) assert.equal(code(await publishForm(c, 1, OWNER, { ...WAIVER, slug })), "slug_invalid", slug);
    assert.equal(code(await publishForm(c, 1, OWNER, { ...WAIVER, kind: "contract" })), "kind_invalid");
    assert.equal(code(await publishForm(c, 1, OWNER, { ...WAIVER, title: " " })), "title_required");
    assert.equal(code(await publishForm(c, 1, OWNER, { ...WAIVER, title: "x".repeat(121) })), "title_too_long");
    assert.equal(code(await publishForm(c, 1, OWNER, { ...WAIVER, body: "" })), "body_required");
    assert.equal(code(await publishForm(c, 1, OWNER, { ...WAIVER, body: "x".repeat(FORM_BODY_MAX + 1) })), "body_too_long");
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM club_forms`)).rows[0].n, 0);
  });

  test("a guardian signs the current form for their child, once; signing again changes nothing", async () => {
    const form = value(await publishForm(c, 1, OWNER, WAIVER));
    assert.equal(await unsignedCount(c, 1, MIA, tama), 1);
    const signed = value(await signForm(c, 1, MIA, tama, form.id, "  Mia   Guardian "));
    assert.deepEqual([signed.id, signed.signedName, !!signed.signedAt], [form.id, "Mia Guardian", true]);
    const again = value(await signForm(c, 1, MIA, tama, form.id, "Someone Else"));
    assert.deepEqual([again.signedName, again.signedAt], [signed.signedName, signed.signedAt], "the first signature stands");
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM form_signatures`)).rows[0].n, 1);
    assert.equal(await unsignedCount(c, 1, MIA, tama), 0);
    assert.deepEqual(value(await listChildForms(c, 1, MIA, tama)).map((f) => [f.slug, f.version, f.signedName]), [["junior-waiver", 1, "Mia Guardian"]]);
    // Pete's child is not signed for by Mia's signature.
    assert.equal(await unsignedCount(c, 1, PETE, ben), 1);
  });

  test("new wording asks again: the older signature is kept as a record but no longer counts", async () => {
    const v1 = value(await publishForm(c, 1, OWNER, WAIVER));
    value(await signForm(c, 1, MIA, tama, v1.id, "Mia Guardian"));
    const v2 = value(await publishForm(c, 1, OWNER, { ...WAIVER, body: "New wording." }));
    assert.equal(await unsignedCount(c, 1, MIA, tama), 1);
    assert.equal(code(await signForm(c, 1, MIA, tama, v1.id, "Mia Guardian")), "not_current");
    value(await signForm(c, 1, MIA, tama, v2.id, "Mia Guardian"));
    assert.deepEqual((await c.query(`SELECT form_id FROM form_signatures ORDER BY form_id`)).rows.map((r) => r.form_id), [v1.id, v2.id]);
    assert.equal(await unsignedCount(c, 1, MIA, tama), 0);
  });

  test("signing: what is refused, and that a refusal writes nothing", async () => {
    const form = value(await publishForm(c, 1, OWNER, WAIVER));
    assert.equal(code(await signForm(c, 1, MIA, tama, form.id, " ")), "name_required");
    assert.equal(code(await signForm(c, 1, MIA, tama, form.id, "x".repeat(121))), "name_too_long");
    assert.equal(code(await signForm(c, 1, PETE, tama, form.id, "Pete Guardian")), "not_found", "not this child's guardian");
    assert.equal(code(await signForm(c, club2, MIA, tama, form.id, "Mia Guardian")), "not_found", "another club");
    assert.equal(code(await signForm(c, 1, MIA, tama, 999999, "Mia Guardian")), "not_found", "no such form");
    assert.equal(code(await listChildForms(c, 1, PETE, tama)), "not_found");
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM form_signatures`)).rows[0].n, 0);
  });

  test("retiring a form: no longer asked for or signable; its signatures stay; only owners and admins", async () => {
    const form = value(await publishForm(c, 1, OWNER, WAIVER));
    value(await signForm(c, 1, MIA, tama, form.id, "Mia Guardian"));
    assert.equal(code(await retireForm(c, 1, { access: { role: "coach", platformAdmin: false } as never }, WAIVER.slug)), "forbidden");
    assert.equal(code(await retireForm(c, 1, OWNER, "no-such-form")), "not_found");
    assert.deepEqual(value(await retireForm(c, 1, OWNER, WAIVER.slug)), { retired: true });
    assert.deepEqual(value(await retireForm(c, 1, OWNER, WAIVER.slug)), { retired: false });
    assert.deepEqual(await listCurrentForms(c, 1), []);
    assert.equal(await unsignedCount(c, 1, PETE, ben), 0);
    assert.equal(code(await signForm(c, 1, PETE, ben, form.id, "Pete Guardian")), "not_current");
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM form_signatures`)).rows[0].n, 1);
    // Publishing it again is a new version, asked for again.
    assert.equal(value(await publishForm(c, 1, OWNER, WAIVER)).version, 2);
    assert.equal(await unsignedCount(c, 1, MIA, tama), 1);
  });

  test("the app's database role: rows only inside the club, and a signature can't be edited", async () => {
    const form = value(await publishForm(c, 1, OWNER, WAIVER));
    value(await signForm(c, 1, MIA, tama, form.id, "Mia Guardian"));
    const as = (tenant: number) => scopePool(pool, async () => tenant);
    for (const table of ["club_forms", "form_signatures"]) {
      assert.equal((await as(1).query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 1, table);
      assert.equal((await as(club2).query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, table);
    }
    await assert.rejects(as(1).query(`UPDATE form_signatures SET signed_name = 'Changed'`), /permission denied/);
    await assert.rejects(as(1).query(`DELETE FROM club_forms`), /permission denied/);
  });
});
