// Phase 3 permission matrix (test plan §3.6): one table, every role against
// every action, with the expected answer. Phase 1's matrix
// (tests/phase1-rules.test.ts) covers the admin routes with made-up access;
// this one resolves each person's access from the database, as the app's
// role for the club, and adds the rows Phase 3 brings: another club's admin,
// switching modules, and the platform's lock.
//
// The second club is synthetic and lives only in this test's database.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { canManageAdmins, type Access } from "@luvallplay/auth";
import { migrate } from "../scripts/db/migrate.mjs";
import { decide, type AdminContext } from "../lib/admin-access.ts";
import { getAccess, isLastOwner, listAdmins, listAudit, removeRole, setRoleByEmail, setRoleForPlayer } from "../lib/admin-roles.ts";
import { resetClubModulesCache, setClubModule, setModuleLock } from "../lib/club-modules.ts";
import { scopePool } from "../lib/tenant-scope.ts";

type Expect = "allow" | "deny" | "sign-in";
type Role = "anonymous" | "player" | "member" | "coach" | "admin" | "owner" | "otherClubAdmin" | "platform";
type Action = "clubAdminPages" | "membersAndMoney" | "manageAdmins" | "switchModule" | "switchLockedModule" | "platformAdmins";

// The table. "Player" has an account and no place in the club; "member" has
// a membership and no role. Both are denied everything here, like the plan's
// table says; so is an admin of another club.
const MATRIX: Record<Role, Record<Action, Expect>> = {
  anonymous:      { clubAdminPages: "sign-in", membersAndMoney: "sign-in", manageAdmins: "sign-in", switchModule: "sign-in", switchLockedModule: "sign-in", platformAdmins: "sign-in" },
  player:         { clubAdminPages: "deny",    membersAndMoney: "deny",    manageAdmins: "deny",    switchModule: "deny",    switchLockedModule: "deny",    platformAdmins: "deny" },
  member:         { clubAdminPages: "deny",    membersAndMoney: "deny",    manageAdmins: "deny",    switchModule: "deny",    switchLockedModule: "deny",    platformAdmins: "deny" },
  coach:          { clubAdminPages: "allow",   membersAndMoney: "deny",    manageAdmins: "deny",    switchModule: "deny",    switchLockedModule: "deny",    platformAdmins: "deny" },
  admin:          { clubAdminPages: "allow",   membersAndMoney: "allow",   manageAdmins: "deny",    switchModule: "deny",    switchLockedModule: "deny",    platformAdmins: "deny" },
  owner:          { clubAdminPages: "allow",   membersAndMoney: "allow",   manageAdmins: "allow",   switchModule: "allow",   switchLockedModule: "deny",    platformAdmins: "deny" },
  otherClubAdmin: { clubAdminPages: "deny",    membersAndMoney: "deny",    manageAdmins: "deny",    switchModule: "deny",    switchLockedModule: "deny",    platformAdmins: "deny" },
  platform:       { clubAdminPages: "allow",   membersAndMoney: "allow",   manageAdmins: "allow",   switchModule: "allow",   switchLockedModule: "allow",   platformAdmins: "allow" },
};

const PATHS: Partial<Record<Action, string>> = {
  clubAdminPages: "/admin/play-days",
  membersAndMoney: "/admin/financials",
  manageAdmins: "/admin/people/admins",
  platformAdmins: "/admin/platform/admins",
};

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `permission_matrix_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");

describe("permission matrix, from the database", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let pool: pg.Pool;
  let club2 = 0;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  // The seed's accounts: 1 is an owner and a platform admin, 2 an admin, 3 a member.
  const PLAYER: Record<Exclude<Role, "anonymous">, number> = { member: 3, coach: 4, otherClubAdmin: 5, platform: 6, owner: 7, player: 8, admin: 2 };

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: urlFor(NAME), max: 4 });
    const c = await pool.connect();
    await migrate(c, { log: () => {} });
    await c.query(SEED);
    club2 = (
      await c.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, payment_mode, incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
    await c.query(`INSERT INTO club_roles (player_id, role) VALUES ($1, 'coach'), ($2, 'owner')`, [PLAYER.coach, PLAYER.owner]);
    // An admin of the other club: their role row belongs to club 2.
    await c.query(`INSERT INTO club_roles (player_id, role, tenant_id) VALUES ($1, 'admin', $2)`, [PLAYER.otherClubAdmin, club2]);
    await c.query(`INSERT INTO platform_admins (player_id) VALUES ($1)`, [PLAYER.platform]);
    // A module the platform has locked on for this club.
    await c.query(`UPDATE tenant_modules SET locked = 'on', lock_reason = 'test' WHERE tenant_id = 1 AND module_id = 'gallery'`);
    c.release();
  });
  after(async () => {
    await pool?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  /** What the app would answer for this person and action, in club 1. */
  async function answer(role: Role, action: Action): Promise<Expect> {
    if (role === "anonymous") return "sign-in";
    const db = scopePool(pool, async () => 1);
    const access: Access = await getAccess(db, PLAYER[role]);
    const ctx: AdminContext = { kind: "player", player: { id: PLAYER[role], email: "x@example.test", firstName: "X", lastName: "Y" }, access, signedInAt: new Date(), stepUpFresh: true };
    const path = PATHS[action];
    if (path) return decide(ctx, path, false).ok ? "allow" : "deny";
    // Switching a module: the page's guard, then the registry's rules (the platform's lock holds for owners).
    if (!decide(ctx, "/admin/settings/modules", false).ok || !canManageAdmins(access)) return "deny";
    const moduleId = action === "switchLockedModule" ? "gallery" : "donations";
    resetClubModulesCache();
    const client = await pool.connect();
    try {
      // Tried inside a transaction that is rolled back, so every cell starts from the same state.
      await client.query("BEGIN");
      const result = await setClubModule({ query: (t, p) => client.query(t, p) }, { moduleId, on: false, actor: access.platformAdmin ? "platform-admin" : "owner", actorPlayerId: PLAYER[role] });
      return result.ok ? "allow" : "deny";
    } finally {
      await client.query("ROLLBACK");
      client.release();
      resetClubModulesCache();
    }
  }

  test("every role × every action gives the answer in the table", async () => {
    const failures: string[] = [];
    for (const [role, row] of Object.entries(MATRIX) as [Role, Record<Action, Expect>][]) {
      for (const [action, expected] of Object.entries(row) as [Action, Expect][]) {
        const got = await answer(role, action);
        if (got !== expected) failures.push(`${role} × ${action}: expected ${expected}, got ${got}`);
      }
    }
    assert.deepEqual(failures, []);
  });

  test("another club's admin is an admin there, and nobody here", async () => {
    const here = await getAccess(scopePool(pool, async () => 1), PLAYER.otherClubAdmin);
    const there = await getAccess(scopePool(pool, async () => club2), PLAYER.otherClubAdmin);
    assert.deepEqual(here, { role: null, platformAdmin: false });
    assert.deepEqual(there, { role: "admin", platformAdmin: false });
    // And this club's admin is nobody there.
    assert.deepEqual(await getAccess(scopePool(pool, async () => club2), PLAYER.admin), { role: null, platformAdmin: false });
    // A platform admin is one in every club: platform_admins isn't a club's table.
    assert.deepEqual(await getAccess(scopePool(pool, async () => club2), PLAYER.platform), { role: null, platformAdmin: true });
  });

  test("unscoped (TENANT_SCOPE off or shadow), roles and invites are still per club: TENANT_SLUG decides (audit C6)", async () => {
    const owner = { query: (t: string, p?: unknown[]) => pool.query(t, p) };
    const script = { kind: "script" } as const;
    const was = process.env.TENANT_SLUG;
    try {
      delete process.env.TENANT_SLUG;
      assert.deepEqual(await getAccess(owner, PLAYER.otherClubAdmin), { role: null, platformAdmin: false }, "another club's admin is nobody here");
      const here = await listAdmins(owner);
      assert.equal(here.admins.some((a) => a.playerId === PLAYER.otherClubAdmin), false, "and isn't listed here");
      process.env.TENANT_SLUG = "hanoi-smash";
      assert.deepEqual(await getAccess(owner, PLAYER.otherClubAdmin), { role: "admin", platformAdmin: false });
      assert.deepEqual(await getAccess(owner, PLAYER.owner), { role: null, platformAdmin: false }, "this club's owner is nobody there");
      assert.deepEqual((await listAdmins(owner)).admins.filter((a) => a.role).map((a) => a.playerId), [PLAYER.otherClubAdmin]);

      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const db = { query: (t: string, p?: unknown[]) => c.query(t, p) };
        // A role given in club 2 lands in club 2 (not in club 1 by the column's default).
        await setRoleForPlayer(db, script, PLAYER.member, "coach");
        assert.deepEqual((await c.query(`SELECT tenant_id FROM club_roles WHERE player_id = $1`, [PLAYER.member])).rows, [{ tenant_id: club2 }]);
        // Removing it there leaves club 1's roles alone.
        await removeRole(db, script, PLAYER.owner);
        assert.equal((await c.query(`SELECT count(*)::int AS n FROM club_roles WHERE player_id = $1 AND tenant_id = 1`, [PLAYER.owner])).rows[0].n, 1);
        // An invite belongs to club 2, and club 1 neither lists nor accepts it.
        const inv = await setRoleByEmail(db, script, { email: "invitee@example.test", role: "admin" });
        assert.equal(inv.kind, "invited");
        assert.deepEqual((await c.query(`SELECT tenant_id FROM admin_invites WHERE email = 'invitee@example.test'`)).rows, [{ tenant_id: club2 }]);
        delete process.env.TENANT_SLUG;
        assert.equal((await listAdmins(db)).invites.some((i) => i.email === "invitee@example.test"), false);
        // The audit log is the club's too.
        assert.equal((await listAudit(db)).some((r) => r.target === "email:invitee@example.test"), false);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
      // The last owner of ANY club can't delete their account.
      assert.equal(await isLastOwner(owner, PLAYER.otherClubAdmin), false, "an admin, not an owner");
      assert.equal(await isLastOwner(owner, PLAYER.owner), false, "club 1 has another owner (the seed's)");
      await pool.query(`UPDATE club_roles SET role = 'owner' WHERE player_id = $1`, [PLAYER.otherClubAdmin]);
      try {
        assert.equal(await isLastOwner(owner, PLAYER.otherClubAdmin), true, "the only owner of club 2, asked from club 1");
      } finally {
        await pool.query(`UPDATE club_roles SET role = 'admin' WHERE player_id = $1`, [PLAYER.otherClubAdmin]);
      }
    } finally {
      if (was === undefined) delete process.env.TENANT_SLUG;
      else process.env.TENANT_SLUG = was;
    }
  });

  test("the platform's lock: only staff set it, it needs a reason, it puts the module in that state, and owners can't undo it", async () => {
    const db = { query: (t: string, p?: unknown[]) => pool.query(t, p) };
    const state = async (id: string) => (await pool.query(`SELECT enabled, locked, lock_reason FROM tenant_modules WHERE tenant_id = 1 AND module_id = $1`, [id])).rows[0];
    resetClubModulesCache();
    // An owner can't lock.
    assert.deepEqual(await setModuleLock(db, { moduleId: "donations", lock: "off", reason: "x", actor: "owner", actorPlayerId: PLAYER.owner }), { ok: false, reason: "Only Luvallplay staff can lock a module." });
    // Staff need a reason, can't lock the core, and can't lock something that doesn't exist.
    const staff = { actor: "platform-admin" as const, actorPlayerId: PLAYER.platform };
    assert.equal((await setModuleLock(db, { moduleId: "donations", lock: "off", reason: " ", ...staff })).ok, false);
    assert.equal((await setModuleLock(db, { moduleId: "play-days", lock: "off", reason: "x", ...staff })).ok, false);
    assert.equal((await setModuleLock(db, { moduleId: "nope", lock: "off", reason: "x", ...staff })).ok, false);
    assert.deepEqual(await state("donations"), { enabled: true, locked: null, lock_reason: null });
    // Locked off: the module goes off, and the owner can't switch it back.
    assert.deepEqual(await setModuleLock(db, { moduleId: "donations", lock: "off", reason: "Charity registration pending", ...staff }), { ok: true, changed: true });
    assert.deepEqual(await state("donations"), { enabled: false, locked: "off", lock_reason: "Charity registration pending" });
    const tryOwner = await setClubModule(db, { moduleId: "donations", on: true, actor: "owner", actorPlayerId: PLAYER.owner });
    assert.equal(tryOwner.ok, false);
    assert.equal((await state("donations")).enabled, false);
    // The same lock again changes nothing.
    assert.deepEqual(await setModuleLock(db, { moduleId: "donations", lock: "off", reason: "Charity registration pending", ...staff }), { ok: true, changed: false });
    // Unlocked: the state stays, and the owner can switch again.
    assert.deepEqual(await setModuleLock(db, { moduleId: "donations", lock: null, ...staff }), { ok: true, changed: true });
    assert.deepEqual(await state("donations"), { enabled: false, locked: null, lock_reason: null });
    assert.deepEqual(await setClubModule(db, { moduleId: "donations", on: true, actor: "owner", actorPlayerId: PLAYER.owner }), { ok: true, changed: true });
    resetClubModulesCache();
  });

  test("the matrix has a row for every role and a cell for every action", () => {
    const actions = Object.keys(MATRIX.anonymous).sort();
    for (const [role, row] of Object.entries(MATRIX)) assert.deepEqual(Object.keys(row).sort(), actions, role);
    assert.equal(Object.keys(MATRIX).length, 8);
  });
});
