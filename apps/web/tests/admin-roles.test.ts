// Admin access by account (build plan §2.4, test plan §3.6 / §4.5).
//
// Pure rules first (no database), then the real migration and grant script
// against the production-shaped fixture on Postgres: the data-guard rehearsal
// must report zero problems, and the role guardrails (last owner, invites,
// audit, handoff) are exercised on real tables.
//
// Needs DATA_GUARD_TEST_URL for the database part (CI sets it and
// DATA_GUARD_REQUIRE_DB=1, so it can't be skipped silently).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import {
  adminApiAllowed,
  adminPathAllowed,
  canManageAdmins,
  consumeHandoff,
  createHandoff,
  getAccess,
  isLastOwner,
  isStepUpFresh,
  listAdmins,
  listAudit,
  removeRole,
  revokeInvite,
  RoleError,
  setPlatformAdmin,
  setRoleByEmail,
  setRoleForPlayer,
  summarizeAdminRequest,
  AUDIT_FIELD_ALLOW_LIST,
  auditFields,
  auditTarget,
  STEP_UP_MAX_AGE_MS,
  type Access,
  type Actor,
  type Db,
} from "../lib/admin-roles.ts";

const MIGRATION = "scripts/migrations/2026-11-phase1-admin-roles.sql";
// The app's code names today's key for the roles table; the Phase 1 migration predates it.
const CURRENT_KEYS = "tests/fixtures/roles-current-keys.sql";
const EXPECT = "scripts/data-guard/expectations/2026-11-phase1-admin-roles.json";

// ---------------------------------------------------------------------------
// Rules (no database)
// ---------------------------------------------------------------------------

const A = (role: Access["role"], platformAdmin = false): Access => ({ role, platformAdmin });

test("rules: who reaches which admin page", () => {
  const none = A(null);
  assert.equal(adminPathAllowed(none, "/admin/members"), false);
  assert.equal(adminPathAllowed(A("coach"), "/admin/play-days"), true);
  assert.equal(adminPathAllowed(A("coach"), "/admin/challenges"), true);
  assert.equal(adminPathAllowed(A("coach"), "/admin/play-days/schedule"), true, "coach: weekly schedule");
  assert.equal(adminPathAllowed(A("coach"), "/admin/members"), false, "coach: partial");
  assert.equal(adminPathAllowed(A("coach"), "/admin/financials"), false);
  assert.equal(adminPathAllowed(A("admin"), "/admin/financials"), true);
  assert.equal(adminPathAllowed(A("admin"), "/admin/people/admins"), false, "admins can't manage admins");
  assert.equal(adminPathAllowed(A("owner"), "/admin/people/admins"), true);
  assert.equal(adminPathAllowed(A("owner"), "/admin/platform/admins"), false);
  assert.equal(adminPathAllowed(A(null, true), "/admin/platform/admins"), true);
  assert.equal(adminPathAllowed(A(null, true), "/admin/people/admins"), true, "platform admins manage any club's admins");
  // Prefix tricks don't widen access.
  assert.equal(adminPathAllowed(A("coach"), "/admin/play-days-secret"), false);
  assert.equal(adminPathAllowed(A("admin"), "/admin/platformx"), true);
  assert.equal(adminPathAllowed(A("admin"), "/admin/platform"), false);
});

test("rules: admin API and managing admins", () => {
  assert.equal(adminApiAllowed(A("coach")), false);
  assert.equal(adminApiAllowed(A("admin")), true);
  assert.equal(adminApiAllowed(A(null, true)), true);
  assert.equal(canManageAdmins(A("admin")), false);
  assert.equal(canManageAdmins(A("owner")), true);
  assert.equal(canManageAdmins(A(null, true)), true);
});

test("step-up: a sign-in older than 12 hours needs a fresh code", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  assert.equal(isStepUpFresh(new Date(now - 60_000), now), true);
  assert.equal(isStepUpFresh(new Date(now - STEP_UP_MAX_AGE_MS + 1000), now), true);
  assert.equal(isStepUpFresh(new Date(now - STEP_UP_MAX_AGE_MS - 1000), now), false);
  assert.equal(isStepUpFresh(null, now), false);
  assert.equal(isStepUpFresh("not a date", now), false);
  assert.equal(isStepUpFresh(new Date(now + 3_600_000), now), false, "a session from the future is not trusted");
});

test("audit summary: keeps the target and allow-listed ids and choices; drops everything else (H7)", () => {
  const s = summarizeAdminRequest({
    method: "POST",
    path: "/admin/members",
    actionId: "abc123",
    fields: [
      ["1_$ACTION_ID_abc", ""],
      ["_1_$ACTION_ID_def", ""],
      ["0", '["$K1"]'],
      ["_1_memberId", "42"],
      ["plan", "x".repeat(500)],
      ["password", "hunter2"],
      // Personal details and free text never reach the log, whatever the field is called.
      ["firstName", "Mia"],
      ["phone", "021 000 000"],
      ["reason", "moved away"],
      ["body", "a private message"],
      ["medicalNotes", "asthma; carries an inhaler"],
      ["somethingNew", "a field nobody allow-listed"],
    ],
  });
  assert.equal(s.action, "POST /admin/members");
  assert.equal(s.target, "42");
  const fields = s.meta.fields as Record<string, string>;
  assert.deepEqual(Object.keys(fields).sort(), ["memberId", "plan"], "only allow-listed fields; Next.js internals dropped, prefixes stripped");
  assert.equal(fields.plan.length, 120);
  assert.equal(s.meta.serverAction, "abc123");
  assert.doesNotMatch(JSON.stringify(s), /asthma|hunter2|Mia|021|moved away|private message|nobody/);
});

test("audit allow-list: ids and choices only, never free text or personal details (H7)", () => {
  for (const banned of ["email", "phone", "firstName", "lastName", "name", "notes", "note", "reason", "body", "subject", "statement", "medicalNotes", "medical", "dob", "address", "q"]) {
    assert.equal(AUDIT_FIELD_ALLOW_LIST.has(banned), false, banned);
  }
  // The member's email may be the TARGET where a form has no id (memberships are keyed by email), never a copied field.
  assert.equal(auditTarget([["email", "mia@e2e.test"], ["reason", "x"]]), "mia@e2e.test");
  assert.deepEqual(auditFields([["email", "mia@e2e.test"], ["reason", "x"], ["role", "coach"]]), { role: "coach" });
  assert.equal(auditTarget([["reason", "x"]]), "");
});

// ---------------------------------------------------------------------------
// Database: the real migration, the grant script and the guardrails
// ---------------------------------------------------------------------------

const DB_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const FIXTURE = readFileSync(new URL("./fixtures/data-guard/club.sql", import.meta.url), "utf8");
const hasPsql = spawnSync("psql", ["--version"]).status === 0;

if (!DB_URL && REQUIRE_DB) {
  test("admin roles database tests are required in CI", () => assert.fail("DATA_GUARD_REQUIRE_DB=1 but DATA_GUARD_TEST_URL is not set"));
}

describe("admin roles on Postgres", { skip: DB_URL ? false : "set DATA_GUARD_TEST_URL" }, () => {
  const dbName = `roles_${process.pid}_${Date.now()}`;
  let branchUrl = "";
  let client: pg.Client;
  let db: Db;
  const node = (args: string[], env: Record<string, string | undefined> = {}) =>
    spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, POSTGRES_URL: branchUrl, ...env } });

  before(async () => {
    const admin = new pg.Client({ connectionString: DB_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const url = new URL(DB_URL!);
    url.pathname = `/${dbName}`;
    branchUrl = url.toString();
    client = new pg.Client({ connectionString: branchUrl });
    await client.connect();
    await client.query(FIXTURE);
    db = { query: (text, params) => client.query(text, params as unknown[]) };
  });

  after(async () => {
    await client?.end();
    const admin = new pg.Client({ connectionString: DB_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  test("before the migration: no tables means no access, not an error", async () => {
    assert.deepEqual(await getAccess(db, 1, "player1@example.test"), { role: null, platformAdmin: false });
    assert.equal(await isLastOwner(db, 1), false);
  });

  test("REHEARSAL · migration + grant of two owners: data guard reports 0 problems", { skip: hasPsql ? false : "psql not installed" }, () => {
    const dir = mkdtempSync(join(tmpdir(), "roles-"));
    const run = `node scripts/run-migration.mjs ${MIGRATION} && node scripts/run-migration.mjs ${CURRENT_KEYS} && node scripts/grant-role.mjs --role owner --platform --email player1@example.test --email ' Player2@Example.TEST '`;
    const r = spawnSync(process.execPath, ["scripts/data-guard/cli.ts", "rehearse", "--expect", EXPECT, "--out-dir", dir, "--run", run], {
      encoding: "utf8",
      env: { ...process.env, POSTGRES_URL: undefined, DATA_GUARD_URL: branchUrl },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /RESULT: ✔ passed/);
    const report = readFileSync(join(dir, "report.md"), "utf8");
    for (const bad of ["AFTER_NO_ADMIN", "NO_ADMIN", "SIGNED_OUT", "DATA_LOST", "ROWS_LOST", "ACCOUNT_", "EMAIL_CHANGED", "VALUES_CHANGED"]) {
      assert.ok(!report.includes(bad), `report has no ${bad}:\n${report}`);
    }
    // Emails are masked in the script's output and in the report (it goes on the pull request).
    assert.ok(!r.stdout.includes("player1@example.test"));
    assert.ok(!report.includes("player1@example.test") && !report.toLowerCase().includes("player2@example.test"), "report masks emails");
    assert.match(report, /p\*\*\*@example\.test/);
    writeFileSync(join(tmpdir(), "phase1-roles-fixture-report.md"), report);
  });

  test("migration is idempotent and the grant is too", () => {
    const m = node(["scripts/run-migration.mjs", MIGRATION]);
    assert.equal(m.status, 0, m.stderr);
    const k = node(["scripts/run-migration.mjs", CURRENT_KEYS]);
    assert.equal(k.status, 0, k.stderr);
    const g = node(["scripts/grant-role.mjs", "--role", "owner", "--platform", "--email", "player1@example.test"]);
    assert.equal(g.status, 0, g.stderr);
    assert.match(g.stdout, /already owner/);
    assert.match(g.stdout, /platform admin already/);
  });

  test("access: owners and platform admins, case-insensitive email", async () => {
    assert.deepEqual(await getAccess(db, 1), { role: "owner", platformAdmin: true });
    assert.deepEqual(await getAccess(db, 2), { role: "owner", platformAdmin: true });
    assert.deepEqual(await getAccess(db, 3), { role: null, platformAdmin: false });
  });

  const owner = (id: number): Actor => ({ kind: "player", playerId: id, access: { role: "owner", platformAdmin: false } });
  const adminActor = (id: number): Actor => ({ kind: "player", playerId: id, access: { role: "admin", platformAdmin: false } });

  test("owner adds an existing account as admin, changes it, removes it", async () => {
    const r = await setRoleByEmail(db, owner(1), { email: "PLAYER3@example.test", role: "admin" });
    assert.equal(r.kind, "granted");
    assert.deepEqual(await getAccess(db, 3), { role: "admin", platformAdmin: false });
    const c = await setRoleForPlayer(db, owner(1), 3, "coach");
    assert.equal(c.kind, "granted");
    assert.equal((await setRoleForPlayer(db, owner(1), 3, "coach")).kind, "unchanged");
    assert.deepEqual(await removeRole(db, owner(1), 3), { removed: "coach" });
    assert.deepEqual(await getAccess(db, 3), { role: null, platformAdmin: false });
  });

  test("an admin (not owner) can't manage admins", async () => {
    await assert.rejects(setRoleByEmail(db, adminActor(3), { email: "player4@example.test", role: "admin" }), (e: unknown) => e instanceof RoleError && e.code === "forbidden");
    await assert.rejects(removeRole(db, adminActor(3), 1), (e: unknown) => e instanceof RoleError && e.code === "forbidden");
  });

  test("bad input is refused", async () => {
    await assert.rejects(setRoleByEmail(db, owner(1), { email: "player4@example.test", role: "superuser" }), (e: unknown) => e instanceof RoleError && e.code === "invalid_role");
    await assert.rejects(setRoleByEmail(db, owner(1), { email: "not an email", role: "admin" }), (e: unknown) => e instanceof RoleError && e.code === "invalid_email");
  });

  test("LAST OWNER · can't be removed or demoted; can once another owner exists", async () => {
    // Two owners: demoting one is fine.
    await setRoleForPlayer(db, owner(1), 2, "admin");
    assert.equal(await isLastOwner(db, 1), true);
    await assert.rejects(setRoleForPlayer(db, owner(1), 1, "admin"), (e: unknown) => e instanceof RoleError && e.code === "last_owner");
    await assert.rejects(removeRole(db, owner(1), 1), (e: unknown) => e instanceof RoleError && e.code === "last_owner");
    assert.deepEqual(await getAccess(db, 1), { role: "owner", platformAdmin: true }, "still owner");
    // A soft-deleted owner doesn't count as the other owner.
    await client.query(`INSERT INTO club_roles (player_id, role) VALUES (199, 'owner') ON CONFLICT (player_id) DO UPDATE SET role = 'owner';`);
    const deleted = await client.query(`SELECT deleted_at IS NOT NULL AS d FROM players WHERE id = 199`);
    if (deleted.rows[0]?.d) await assert.rejects(removeRole(db, owner(1), 1), (e: unknown) => e instanceof RoleError && e.code === "last_owner");
    await client.query(`DELETE FROM club_roles WHERE player_id = 199`);
    // Promote 2 again, then 1 can step down.
    await setRoleForPlayer(db, owner(1), 2, "owner");
    assert.equal((await setRoleForPlayer(db, owner(2), 1, "admin")).kind, "granted");
    await setRoleForPlayer(db, owner(2), 1, "owner");
  });

  test("LAST OWNER · two owners demoting each other at the same moment: one wins", async () => {
    const c2 = new pg.Client({ connectionString: branchUrl });
    await c2.connect();
    const db2: Db = { query: (t, p) => c2.query(t, p as unknown[]) };
    try {
      const results = await Promise.allSettled([setRoleForPlayer(db, owner(1), 2, "admin"), setRoleForPlayer(db2, owner(2), 1, "admin")]);
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM club_roles WHERE role = 'owner'`);
      assert.ok(rows[0].n >= 1, "at least one owner remains");
      assert.ok(results.some((r) => r.status === "fulfilled"));
    } finally {
      await c2.end();
      await setRoleForPlayer(db, { kind: "script" }, 1, "owner");
      await setRoleForPlayer(db, { kind: "script" }, 2, "owner");
    }
  });

  test("INVITE · email without an account: applied on first sign-in, once", async () => {
    const r = await setRoleByEmail(db, owner(1), { email: "New.Coach@Example.test", role: "coach" });
    assert.equal(r.kind, "invited");
    const { admins, invites } = await listAdmins(db);
    assert.ok(invites.some((i) => i.email === "new.coach@example.test" && i.role === "coach"));
    assert.ok(admins.some((a) => a.playerId === 1 && a.role === "owner" && a.platformAdmin));
    // Re-inviting replaces the pending invite (one pending per email).
    await setRoleByEmail(db, owner(1), { email: "new.coach@example.test", role: "admin" });
    assert.equal((await listAdmins(db)).invites.filter((i) => i.email === "new.coach@example.test").length, 1);
    // First sign-in: the account is created, then access is read.
    const { rows } = await client.query(`INSERT INTO players (email, first_name, last_name) VALUES ('new.coach@example.test', 'New', 'Coach') RETURNING id`);
    const id = Number(rows[0].id);
    assert.deepEqual(await getAccess(db, id, "New.Coach@example.test"), { role: "admin", platformAdmin: false });
    assert.equal((await listAdmins(db)).invites.length, 0);
    // A revoked invite is never applied.
    const inv = await setRoleByEmail(db, owner(1), { email: "someone.else@example.test", role: "admin" });
    assert.equal(inv.kind, "invited");
    if (inv.kind === "invited") assert.equal(await revokeInvite(db, owner(1), inv.inviteId), true);
    const other = await client.query(`INSERT INTO players (email, first_name, last_name) VALUES ('someone.else@example.test', 'S', 'E') RETURNING id`);
    assert.deepEqual(await getAccess(db, Number(other.rows[0].id), "someone.else@example.test"), { role: null, platformAdmin: false });
  });

  test("PLATFORM · only platform admins change the list; the last one stays", async () => {
    await assert.rejects(setPlatformAdmin(db, owner(1), 3, true), (e: unknown) => e instanceof RoleError && e.code === "forbidden");
    const plat: Actor = { kind: "player", playerId: 1, access: { role: "owner", platformAdmin: true } };
    assert.equal(await setPlatformAdmin(db, plat, 3, true), true);
    assert.equal(await setPlatformAdmin(db, plat, 3, false), true);
    await assert.rejects(setPlatformAdmin(db, plat, 1, false), (e: unknown) => e instanceof RoleError && e.code === "self");
  });

  test("AUDIT · every change above is on record with who, what and whom", async () => {
    const log = await listAudit(db, 200);
    const actions = new Set(log.map((l) => l.action));
    for (const a of ["admin.granted", "admin.role_changed", "admin.removed", "admin.invited", "admin.invite_accepted", "admin.invite_revoked", "platform.granted", "platform.removed"]) {
      assert.ok(actions.has(a), `audit has ${a}`);
    }
    const script = log.filter((l) => l.actorKind === "script");
    assert.ok(script.length >= 4, "the grant script's changes are attributed to 'script'");
    const removed = log.find((l) => l.action === "admin.removed")!;
    assert.equal(removed.actorPlayerId, 1);
    assert.equal(removed.target, "player:3");
  });

  test("HANDOFF · single use and gone after 60 seconds", async () => {
    const { token, expiresInSeconds } = await createHandoff(db, 1);
    assert.equal(expiresInSeconds, 60);
    assert.equal(await consumeHandoff(db, token), 1);
    assert.equal(await consumeHandoff(db, token), null, "replay refused");
    assert.equal(await consumeHandoff(db, "made-up"), null);
    const old = await createHandoff(db, 1);
    await client.query(`UPDATE admin_handoffs SET expires_at = NOW() - INTERVAL '1 second' WHERE used_at IS NULL`);
    assert.equal(await consumeHandoff(db, old.token), null, "expired");
    const { rows } = await client.query(`SELECT token_hash FROM admin_handoffs`);
    assert.ok(rows.every((r) => r.token_hash !== token && r.token_hash !== old.token), "only hashes stored");
  });
});
