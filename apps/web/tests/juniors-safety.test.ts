// Phase 3b step 6: the safety check a club records for a coach or volunteer
// (lib/juniors/safety.ts). No valid check, no junior roster; medical notes
// are for owners and for coaches with a valid check. Against a real Postgres.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";
import {
  currentSafetyCheck,
  hasValidSafetyCheck,
  listStaffSafety,
  mayReadMedicalNotesToday,
  mayWorkWithJuniors,
  recordSafetyCheck,
  revokeSafetyCheck,
  statusOf,
  type SafetyCheck,
} from "../lib/juniors/safety.ts";
import { scopePool } from "../lib/tenant-scope.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `juniors_safety_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const TODAY = "2026-11-26";
const check = (over: Partial<SafetyCheck> = {}): SafetyCheck => ({ id: 1, userId: 1, kind: "police-vet", reference: null, checkedOn: "2026-01-10", expiresOn: "2028-01-10", revokedAt: null, ...over });

test("what a record says on a given day: valid, expiring within 30 days, expired on its last day, withdrawn, or none", () => {
  assert.equal(statusOf(null, TODAY), "none");
  assert.equal(statusOf(check(), TODAY), "valid");
  assert.equal(statusOf(check({ expiresOn: "2026-12-26" }), TODAY), "expires_soon");
  assert.equal(statusOf(check({ expiresOn: "2026-12-27" }), TODAY), "valid");
  assert.equal(statusOf(check({ expiresOn: "2026-11-27" }), TODAY), "expires_soon");
  assert.equal(statusOf(check({ expiresOn: TODAY }), TODAY), "expired", "the expiry day itself is already expired");
  assert.equal(statusOf(check({ revokedAt: "2026-11-01T00:00:00.000Z" }), TODAY), "revoked");
});

describe("safety checks, from the database", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
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
  // Seed: 1 an owner, 2 an admin. 4 becomes a coach here; 3 has no role.
  const OWNER_ID = 1;
  const ADMIN_ID = 2;
  const COACH_ID = PETE;
  const owner = { playerId: OWNER_ID, access: { role: "owner", platformAdmin: false } as never };
  const admin = { playerId: ADMIN_ID, access: { role: "admin", platformAdmin: false } as never };
  const coach = { playerId: COACH_ID, access: { role: "coach", platformAdmin: false } as never };
  const good = { userId: COACH_ID, kind: "police-vet", checkedOn: "2026-06-01", expiresOn: "2028-06-01" };
  beforeEach(async () => {
    await c.query(`TRUNCATE junior_safety_checks`);
    await c.query(`INSERT INTO club_roles (player_id, role) VALUES ($1, 'coach') ON CONFLICT DO NOTHING`, [COACH_ID]);
  });

  test("an owner records a check for a coach; from then the coach may work with juniors and read medical notes", async () => {
    assert.equal(await mayWorkWithJuniors(c, 1, coach, TODAY), false);
    assert.equal(await mayReadMedicalNotesToday(c, 1, coach, TODAY), false);
    const saved = value(await recordSafetyCheck(c, 1, owner, { ...good, reference: "  Folder  B, page 3 " }, TODAY));
    assert.deepEqual({ ...saved, id: 0 }, { id: 0, userId: COACH_ID, kind: "police-vet", reference: "Folder B, page 3", checkedOn: "2026-06-01", expiresOn: "2028-06-01", revokedAt: null });
    assert.equal(await hasValidSafetyCheck(c, 1, COACH_ID, TODAY), true);
    assert.equal(await mayWorkWithJuniors(c, 1, coach, TODAY), true);
    assert.equal(await mayReadMedicalNotesToday(c, 1, coach, TODAY), true);
    const row = (await c.query(`SELECT tenant_id, recorded_by_user_id FROM junior_safety_checks`)).rows[0];
    assert.deepEqual(row, { tenant_id: 1, recorded_by_user_id: OWNER_ID });
    // In another club the same person has no check.
    assert.equal(await hasValidSafetyCheck(c, club2, COACH_ID, TODAY), false);
  });

  test("who may do what: an owner reads notes without a check but needs one for the roster; an admin never reads notes; no role, nothing", async () => {
    assert.equal(await mayReadMedicalNotesToday(c, 1, owner, TODAY), true);
    assert.equal(await mayWorkWithJuniors(c, 1, owner, TODAY), false, "an owner without a check doesn't see the roster either");
    value(await recordSafetyCheck(c, 1, owner, { ...good, userId: ADMIN_ID }, TODAY));
    assert.equal(await mayWorkWithJuniors(c, 1, admin, TODAY), true);
    assert.equal(await mayReadMedicalNotesToday(c, 1, admin, TODAY), false);
    // A check on record doesn't help someone with no role in the club, or Luvallplay staff.
    await c.query(`INSERT INTO junior_safety_checks (tenant_id, user_id, kind, checked_on, expires_on, recorded_by_user_id) VALUES (1, $1, 'other', '2026-06-01', '2028-06-01', 1)`, [MIA]);
    assert.equal(await mayWorkWithJuniors(c, 1, { playerId: MIA, access: { role: null, platformAdmin: false } as never }, TODAY), false);
    assert.equal(await mayWorkWithJuniors(c, 1, { playerId: MIA, access: { role: null, platformAdmin: true } as never }, TODAY), false);
    assert.equal(await mayReadMedicalNotesToday(c, 1, { playerId: MIA, access: { role: null, platformAdmin: true } as never }, TODAY), false);
  });

  test("a check stops counting the day it expires, and at once when it is withdrawn; the record stays", async () => {
    const saved = value(await recordSafetyCheck(c, 1, owner, { ...good, expiresOn: "2026-12-01" }, TODAY));
    assert.equal(await mayWorkWithJuniors(c, 1, coach, "2026-11-30"), true);
    assert.equal(await mayWorkWithJuniors(c, 1, coach, "2026-12-01"), false);
    assert.equal(await mayReadMedicalNotesToday(c, 1, coach, "2026-12-01"), false);
    // A newer record counts again; withdrawing it stops it at once.
    const renewed = value(await recordSafetyCheck(c, 1, owner, { ...good, checkedOn: "2026-11-20", expiresOn: "2029-11-20" }, TODAY));
    assert.equal(await mayWorkWithJuniors(c, 1, coach, "2026-12-01"), true);
    assert.equal((await currentSafetyCheck(c, 1, COACH_ID, TODAY))?.id, renewed.id);
    assert.equal(code(await revokeSafetyCheck(c, 1, coach, renewed.id)), "forbidden");
    assert.ok(value(await revokeSafetyCheck(c, 1, owner, renewed.id)).revokedAt);
    assert.equal(await mayWorkWithJuniors(c, 1, coach, "2026-12-01"), false);
    assert.equal(await mayWorkWithJuniors(c, 1, coach, TODAY), true, "the older record still runs until its own expiry");
    assert.equal(code(await revokeSafetyCheck(c, club2, owner, saved.id)), "not_found", "another club can't withdraw it");
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_safety_checks`)).rows[0].n, 2);
  });

  test("recording: what is refused, and that a refusal writes nothing", async () => {
    assert.equal(code(await recordSafetyCheck(c, 1, admin, good, TODAY)), "forbidden");
    assert.equal(code(await recordSafetyCheck(c, 1, coach, good, TODAY)), "forbidden", "nobody records their own");
    assert.equal(code(await recordSafetyCheck(c, 1, { playerId: 9, access: { role: null, platformAdmin: true } as never }, good, TODAY)), "forbidden");
    assert.equal(code(await recordSafetyCheck(c, 1, owner, { ...good, kind: "trust-me" }, TODAY)), "kind_invalid");
    for (const [checkedOn, expiresOn, why] of [
      ["2026-11-27", "2028-01-01", "done in the future"],
      ["2026-06-01", "2026-11-26", "already expired"],
      ["2026-06-01", "2029-06-02", "longer than three years"],
      ["2026-02-30", "2027-01-01", "not a date"],
      ["01/06/2026", "2027-01-01", "not a date"],
    ]) assert.equal(code(await recordSafetyCheck(c, 1, owner, { ...good, checkedOn, expiresOn }, TODAY)), "dates_invalid", why);
    assert.equal(code(await recordSafetyCheck(c, 1, owner, { ...good, reference: "x".repeat(81) }, TODAY)), "reference_too_long");
    assert.equal(code(await recordSafetyCheck(c, 1, owner, { ...good, userId: MIA }, TODAY)), "not_staff");
    assert.equal(code(await recordSafetyCheck(c, club2, owner, good, TODAY)), "not_staff", "a coach here is not staff there");
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_safety_checks`)).rows[0].n, 0);
  });

  test("the owner's list: everyone with a role and where their check stands", async () => {
    value(await recordSafetyCheck(c, 1, owner, { ...good, expiresOn: "2026-12-10" }, TODAY));
    const list = await listStaffSafety(c, 1, TODAY);
    assert.deepEqual(list.map((s) => [s.userId, s.role, s.status]), [[OWNER_ID, "owner", "none"], [ADMIN_ID, "admin", "none"], [COACH_ID, "coach", "expires_soon"]]);
  });

  test("the app's database role: rows only inside the club, and a record can't be deleted", async () => {
    value(await recordSafetyCheck(c, 1, owner, good, TODAY));
    const as = (tenant: number) => scopePool(pool, async () => tenant);
    assert.equal((await as(1).query(`SELECT count(*)::int AS n FROM junior_safety_checks`)).rows[0].n, 1);
    assert.equal((await as(club2).query(`SELECT count(*)::int AS n FROM junior_safety_checks`)).rows[0].n, 0);
    await assert.rejects(as(1).query(`DELETE FROM junior_safety_checks`), /permission denied/);
  });
});
