// Phase 3 step 1: the tenants schema, with Three Wolves as club #1
// (build plan §6.1, §6.6 step 1; migration 0003_tenants).
//
// 1. The values arrive exactly: Three Wolves' row and module settings are
//    compared with today's constants, so the copy can't drift from the code.
// 2. Nobody's access changes: club_roles and platform_admins are untouched,
//    and the data guard reports 0 problems for the migration.
// 3. club_members has one row per account and stays in step with club_roles
//    and the leaderboard flag (the mirror, and the idempotent reconcile).
// 4. New foreign keys to accounts are ON DELETE RESTRICT.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { MODULES, THREE_WOLVES, PAYMENT_MODES } from "@luvallplay/modules";
import { threeWolves } from "@luvallplay/ui";
import { loadMigrations, migrate } from "../scripts/db/migrate.mjs";
import { ExpectationsSchema, diffSnapshots, checkSnapshot } from "../scripts/data-guard/core.ts";
import { takeSnapshot } from "../scripts/data-guard/pg.ts";
import * as C from "../lib/constants.ts";
import { BANK_ACCOUNT_NAME, BANK_ACCOUNT_NUMBER } from "../lib/jersey.ts";
import { setRoleForPlayer, removeRole } from "../lib/admin-roles.ts";
import { clubMemberDrift, defaultTenantSlug, mirrorClubMember, reconcileClubMembers } from "../lib/tenant-members.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `tenants_${process.pid}`;
const EXPECT = new URL("../scripts/data-guard/expectations/2026-11-phase3-tenants.json", import.meta.url);
const quiet = () => {};

function urlFor(db: string) {
  const u = new URL(BASE_URL!);
  u.pathname = `/${db}`;
  return u.toString();
}

test("the migration's club time zone is the one the code uses today", () => {
  // lib/dates.ts keeps the zone private; read it from the source.
  const dates = readFileSync(new URL("../lib/dates.ts", import.meta.url), "utf8");
  assert.match(dates, /const CLUB_TIME_ZONE = "Pacific\/Auckland";/);
});

describe("tenants: Three Wolves is club #1", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  const script = { kind: "script" } as const;
  const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.end();
    c = new pg.Client({ connectionString: urlFor(NAME) });
    await c.connect();

    // Production's shape before this change: everything up to 0002, with
    // accounts, roles, sessions and a paying member in place.
    const all = loadMigrations();
    const idx = all.findIndex((m) => m.tag === "0003_tenants");
    assert.ok(idx > 0, "0003_tenants is in the journal");
    await migrate(c, { migrations: all.slice(0, idx), log: quiet });
    await c.query(`INSERT INTO players (id, email, first_name, leaderboard_visible, created_at, deleted_at) VALUES
      (1, 'owner1@x.test', 'Owner', TRUE, '2026-01-01T00:00:00Z', NULL),
      (2, 'owner2@x.test', 'Second', TRUE, '2026-01-02T00:00:00Z', NULL),
      (3, 'coach@x.test', 'Coach', TRUE, '2026-02-01T00:00:00Z', NULL),
      (4, 'member@x.test', 'Member', FALSE, '2026-03-01T00:00:00Z', NULL),
      (5, 'deleted-5@deleted.invalid', '', FALSE, '2026-03-02T00:00:00Z', now())`);
    await c.query(`SELECT setval('players_id_seq', 5)`);
    await c.query(`INSERT INTO club_roles (player_id, role) VALUES (1, 'owner'), (2, 'owner'), (3, 'coach')`);
    await c.query(`INSERT INTO platform_admins (player_id) VALUES (1), (2)`);
    await c.query(`INSERT INTO player_sessions (player_id, token_hash, expires_at) VALUES (1, 'h1', now() + interval '30 days'), (4, 'h4', now() + interval '30 days')`);
  });

  after(async () => {
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("the migration passes the data guard: 0 problems, and admins keep admin", async () => {
    const rolesBefore = (await c.query(`SELECT * FROM club_roles ORDER BY player_id`)).rows;
    const platformBefore = (await c.query(`SELECT * FROM platform_admins ORDER BY player_id`)).rows;
    const snapBefore = await takeSnapshot(urlFor(NAME));
    const applied = await migrate(c, { log: quiet });
    assert.deepEqual(applied, loadMigrations().slice(loadMigrations().findIndex((m) => m.tag === "0003_tenants")).map((m) => m.tag));
    const snapAfter = await takeSnapshot(urlFor(NAME));

    const expectations = ExpectationsSchema.parse(JSON.parse(readFileSync(EXPECT, "utf8")));
    const findings = diffSnapshots(snapBefore, snapAfter, expectations);
    assert.deepEqual(findings.filter((f) => f.level !== "info"), [], "no errors and no warnings");
    assert.deepEqual(
      findings.filter((f) => f.code === "TABLE_ADDED").map((f) => f.message).sort(),
      ["club_members", "guardianships", "junior_profiles", "tenant_modules", "tenants"].map((t) => `New table ${t}.`),
    );
    assert.deepEqual(checkSnapshot(snapAfter).filter((f) => f.level === "error"), []);

    // The sources of admin access are byte-for-byte the same.
    assert.deepEqual((await c.query(`SELECT * FROM club_roles ORDER BY player_id`)).rows, rolesBefore);
    assert.deepEqual((await c.query(`SELECT * FROM platform_admins ORDER BY player_id`)).rows, platformBefore);
  });

  test("Three Wolves' row carries today's constants", async () => {
    const rows = (await c.query(`SELECT * FROM tenants`)).rows;
    assert.equal(rows.length, 1, "exactly one club: no other club is created");
    const t = rows[0];
    assert.equal(t.slug, defaultTenantSlug());
    assert.equal(t.name, threeWolves.name);
    assert.equal(t.status, "active");
    assert.deepEqual([t.country, t.region, t.timezone, t.currency], ["NZ", "syd", "Pacific/Auckland", "NZD"]);
    assert.deepEqual(t.languages, ["en", "vi"]);
    assert.deepEqual(t.sports, ["badminton"]);
    assert.equal(t.payment_mode, THREE_WOLVES.paymentMode);
    assert.ok((PAYMENT_MODES as readonly string[]).includes(t.payment_mode));
    // Online payments only for an incorporated club with its own Stripe account (decision O).
    assert.deepEqual([t.incorporated, t.stripe_status], ["yes", "connected"]);
    assert.deepEqual(t.bank_details, { account_name: BANK_ACCOUNT_NAME, account_number: BANK_ACCOUNT_NUMBER, cash_at_hall: true });
    assert.deepEqual(t.theme, { kind: "imported", brand: "three-wolves", color: threeWolves.color, font: threeWolves.font });
    assert.deepEqual(t.terms, { points_name: "Wolf Points", vision_name: "Wolf Vision" });
    assert.equal(t.custom_domain, "threewolvesbadminton.org");
  });

  test("every module the club runs today is on, with the settings that are constants today", async () => {
    const { rows } = await c.query(
      `SELECT m.module_id, m.enabled, m.settings, m.locked, m.enabled_at FROM tenant_modules m JOIN tenants t ON t.id = m.tenant_id WHERE t.slug = $1`,
      [defaultTenantSlug()],
    );
    assert.deepEqual(rows.map((r) => r.module_id).sort(), MODULES.map((m) => m.id).sort(), "one row per module in the registry");
    assert.ok(rows.every((r) => r.enabled === true && r.locked === null && r.enabled_at));
    for (const id of THREE_WOLVES.modules) assert.ok(rows.some((r) => r.module_id === id), id);

    const settings = Object.fromEntries(rows.map((r) => [r.module_id, r.settings]));
    assert.deepEqual(settings["play-days"], {
      courtsToMaxPlayers: Object.fromEntries(Object.entries(C.COURTS_TO_MAX_PLAYERS).map(([k, v]) => [String(k), v])),
      sessionCapacity: C.SESSION_CAPACITY,
      casualOnlyDefaultCourts: C.CASUAL_ONLY_DEFAULT_COURTS,
      bookingWindowDays: C.BOOKING_WINDOW_DAYS,
      bookingCutoffHour: C.BOOKING_CUTOFF_HOUR,
    });
    assert.deepEqual(settings["round-robin"], { miniGameMaxPlayers: C.MINI_GAME_MAX_PLAYERS });
    assert.deepEqual(settings.memberships, {
      days: C.MEMBERSHIP_ACCESS_DAYS,
      defaultCourts: C.MEMBERSHIP_DAY_DEFAULT_COURTS,
      cycleDays: C.MEMBERSHIP_CYCLE_DAYS,
      startSearchDays: C.MEMBERSHIP_START_SEARCH_DAYS,
      pendingHoldMinutes: C.PENDING_MEMBERSHIP_HOLD_MINUTES,
    });
    // Minor units of the club's currency (NZD: cents).
    assert.deepEqual(settings.donations, { minAmount: C.DONATION_MIN_CENTS, maxAmount: C.DONATION_MAX_CENTS });
    const withSettings = new Set(["play-days", "round-robin", "memberships", "donations"]);
    for (const r of rows) if (!withSettings.has(r.module_id)) assert.deepEqual(r.settings, {}, r.module_id);
  });

  test("every account is a club member, with its role from club_roles", async () => {
    const { rows } = await c.query(`SELECT user_id, role, status, leaderboard_visible, global_profile_visible, joined_at FROM club_members ORDER BY user_id`);
    assert.deepEqual(
      rows.map((r) => [r.user_id, r.role, r.status, r.leaderboard_visible, r.global_profile_visible]),
      [
        [1, "owner", "active", true, false],
        [2, "owner", "active", true, false],
        [3, "coach", "active", true, false],
        [4, "member", "active", false, false],
        [5, "member", "active", false, false],
      ],
    );
    assert.equal(new Date(rows[3].joined_at).toISOString(), "2026-03-01T00:00:00.000Z", "joined when the account was created");
    assert.deepEqual(await clubMemberDrift(c), []);
    assert.equal(await reconcileClubMembers(c), 0, "the backfill is idempotent: a second run writes nothing");
    assert.equal((await one(`SELECT count(*)::int AS n FROM junior_profiles`)).n + (await one(`SELECT count(*)::int AS n FROM guardianships`)).n, 0);
  });

  test("role changes are mirrored; the mirror keeps guests and disabled members as they are", async () => {
    const role = async (id: number) => (await one(`SELECT role FROM club_members WHERE user_id = $1`, [id]))?.role;

    // As the admin pages do: change the role in club_roles, then mirror it.
    await setRoleForPlayer(c, script, 4, "admin");
    assert.deepEqual((await clubMemberDrift(c)).map((d) => d.problem), ["role member should be admin"]);
    await mirrorClubMember(c, 4);
    assert.equal(await role(4), "admin");
    await setRoleForPlayer(c, script, 4, "coach");
    await mirrorClubMember(c, 4);
    assert.equal(await role(4), "coach");
    await removeRole(c, script, 4);
    assert.deepEqual((await clubMemberDrift(c)).map((d) => d.problem), ["role coach has no club_roles row"]);
    await mirrorClubMember(c, 4);
    assert.equal(await role(4), "member");
    assert.deepEqual(await clubMemberDrift(c), []);

    // A new account becomes a member; the leaderboard flag follows the account.
    await c.query(`INSERT INTO players (id, email, first_name) VALUES (6, 'new@x.test', 'New')`);
    assert.deepEqual((await clubMemberDrift(c)).map((d) => d.problem), ["missing"]);
    await mirrorClubMember(c, 6);
    assert.equal(await role(6), "member");
    await c.query(`UPDATE players SET leaderboard_visible = FALSE WHERE id = 6`);
    assert.deepEqual((await clubMemberDrift(c)).map((d) => d.problem), ["leaderboard flag differs"]);
    await mirrorClubMember(c, 6);
    assert.equal((await one(`SELECT leaderboard_visible AS v FROM club_members WHERE user_id = 6`)).v, false);

    // The club's own decisions (guest, disabled) aren't the mirror's to change.
    await c.query(`UPDATE club_members SET role = 'guest', status = 'disabled' WHERE user_id = 6`);
    assert.equal(await reconcileClubMembers(c), 0);
    assert.deepEqual(await one(`SELECT role, status FROM club_members WHERE user_id = 6`), { role: "guest", status: "disabled" });

    // Writes the mirror missed (the previous app version after a rollback) are repaired.
    await c.query(`INSERT INTO club_roles (player_id, role) VALUES (6, 'admin')`);
    await c.query(`DELETE FROM club_roles WHERE player_id = 3`);
    assert.equal((await clubMemberDrift(c)).length, 2);
    assert.equal(await reconcileClubMembers(c), 2);
    assert.deepEqual([await role(6), await role(3)], ["admin", "member"]);
    assert.equal((await one(`SELECT status FROM club_members WHERE user_id = 6`)).status, "disabled", "status untouched");
    assert.deepEqual(await clubMemberDrift(c), []);

    // The last owner still can't be removed, and the mirror agrees.
    await removeRole(c, script, 2);
    await assert.rejects(removeRole(c, script, 1), /last owner/i);
    await mirrorClubMember(c, null);
    assert.deepEqual([await role(1), await role(2)], ["owner", "member"]);
  });

  test("the mirror never throws, even before the migration has run", async () => {
    const missing = { query: async () => Promise.reject(Object.assign(new Error('relation "club_members" does not exist'), { code: "42P01" })) };
    await mirrorClubMember(missing, 1);
    const broken = { query: async () => Promise.reject(new Error("connection lost")) };
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      await mirrorClubMember(broken, 1);
    } finally {
      console.error = original;
    }
    assert.equal(errors.length, 1, "logged, not thrown");
  });

  test("accounts, clubs and junior profiles can't be hard-deleted from under their rows", async () => {
    const { rows } = await c.query(
      `SELECT conrelid::regclass::text AS t, conname, confdeltype FROM pg_constraint
       WHERE contype = 'f' AND conrelid IN ('club_members'::regclass, 'tenant_modules'::regclass, 'junior_profiles'::regclass, 'guardianships'::regclass) ORDER BY 1, 2`,
    );
    assert.equal(rows.length, 7);
    assert.deepEqual(rows.filter((r) => r.confdeltype !== "r"), [], "every new foreign key is ON DELETE RESTRICT");
    // An account whose only row elsewhere is its club membership.
    await c.query(`INSERT INTO players (id, email) VALUES (7, 'only-member@x.test')`);
    await mirrorClubMember(c, 7);
    await assert.rejects(c.query(`DELETE FROM players WHERE id = 7`), /club_members_user_id_fkey/);
    await assert.rejects(c.query(`DELETE FROM tenants`), /violates foreign key/);
  });

  test("the database refuses a malformed club", async () => {
    const insert = (cols: Record<string, unknown>) => {
      const row = { slug: "test-club", name: "Test", country: "NZ", region: "syd", timezone: "Pacific/Auckland", currency: "NZD", ...cols };
      const keys = Object.keys(row);
      return c.query(`BEGIN; INSERT INTO tenants (${keys.join(", ")}) VALUES (${keys.map((k) => `'${String(row[k as keyof typeof row])}'`).join(", ")}); ROLLBACK;`).finally(() => c.query("ROLLBACK"));
    };
    await insert({});
    await assert.rejects(insert({ slug: "Bad Slug" }), /tenants_slug_check/);
    await assert.rejects(insert({ slug: defaultTenantSlug() }), /tenants_slug_key/);
    await assert.rejects(insert({ country: "nz" }), /tenants_country_check/);
    await assert.rejects(insert({ currency: "dollars" }), /tenants_currency_check/);
    await assert.rejects(insert({ payment_mode: "card" }), /tenants_payment_mode_check/);
    await assert.rejects(insert({ custom_domain: "ThreeWolves.org" }), /tenants_custom_domain_check/);
    await assert.rejects(insert({ custom_domain: "threewolvesbadminton.org" }), /tenants_custom_domain_key/);
    await assert.rejects(c.query(`UPDATE club_members SET role = 'president' WHERE user_id = 1`), /club_members_role_check/);
  });
});
