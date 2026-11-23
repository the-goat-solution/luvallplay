// Phase 3 step 2: tenant_id on every club-owned table (migration
// 0004_tenant_id_columns; build plan §6.1, §6.6 steps 2 and 3).
//
// 1. Every table is classified: club-owned (has tenant_id) or platform-wide
//    (hasn't). A new table in neither list fails here.
// 2. The migration passes the data guard with 0 problems, and every existing
//    row reads as Three Wolves' afterwards.
// 3. Rows written by the previous app version (which doesn't know the
//    column) get the club too, so an app rollback needs no data fix.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { CLUB_OWNED_TABLES, PLATFORM_TABLES } from "@luvallplay/db/tenancy";
import { loadMigrations, migrate } from "../scripts/db/migrate.mjs";
import { ExpectationsSchema, diffSnapshots } from "../scripts/data-guard/core.ts";
import { takeSnapshot } from "../scripts/data-guard/pg.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `tenant_id_${process.pid}`;
const EXPECT = new URL("../scripts/data-guard/expectations/2026-11-phase3-tenant-id.json", import.meta.url);
const TAG = "0004_tenant_id_columns";
const quiet = () => {};

function urlFor(db: string) {
  const u = new URL(BASE_URL!);
  u.pathname = `/${db}`;
  return u.toString();
}

test("the two lists don't overlap", () => {
  const both = CLUB_OWNED_TABLES.filter((t) => (PLATFORM_TABLES as readonly string[]).includes(t));
  assert.deepEqual(both, []);
  assert.equal(new Set(CLUB_OWNED_TABLES).size, CLUB_OWNED_TABLES.length);
});

describe("tenant_id on every club-owned table", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  const n = async (sql: string) => Number((await c.query(sql)).rows[0].n);

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.end();
    c = new pg.Client({ connectionString: urlFor(NAME) });
    await c.connect();

    // Production's shape before this change, with rows in several tables.
    const all = loadMigrations();
    const idx = all.findIndex((m) => m.tag === TAG);
    assert.ok(idx > 0, `${TAG} is in the journal`);
    await migrate(c, { migrations: all.slice(0, idx), log: quiet });
    await c.query(`INSERT INTO players (id, email, first_name) VALUES (1, 'owner@x.test', 'Owner'), (2, 'member@x.test', 'Member')`);
    await c.query(`SELECT setval('players_id_seq', 2)`);
    await c.query(`INSERT INTO club_roles (player_id, role) VALUES (1, 'owner')`);
    await c.query(`INSERT INTO club_members (tenant_id, user_id, role) SELECT id, 1, 'owner' FROM tenants UNION ALL SELECT id, 2, 'member' FROM tenants`);
    await c.query(`INSERT INTO player_sessions (player_id, token_hash, expires_at) VALUES (2, 'h2', now() + interval '30 days')`);
    await c.query(`INSERT INTO sessions (date, courts, max_spots) VALUES ('2026-11-27', 2, 12)`);
    await c.query(`INSERT INTO attendance (session_date, email, source) VALUES ('2026-11-27', 'member@x.test', 'admin')`);
    await c.query(`INSERT INTO shop_orders (player_id, email, status, payment_method, total_cents) VALUES (2, 'member@x.test', 'paid', 'card', 4500)`);
    await c.query(`INSERT INTO message_threads (player_id, subject) VALUES (2, 'Hi')`);
  });

  after(async () => {
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("the migration passes the data guard: 0 problems, nothing existing changes", async () => {
    const snapBefore = await takeSnapshot(urlFor(NAME));
    await migrate(c, { migrations: loadMigrations().slice(0, loadMigrations().findIndex((m) => m.tag === TAG) + 1), log: quiet });
    const snapAfter = await takeSnapshot(urlFor(NAME));
    const findings = diffSnapshots(snapBefore, snapAfter, ExpectationsSchema.parse(JSON.parse(readFileSync(EXPECT, "utf8"))));
    assert.deepEqual(findings.filter((f) => f.level !== "info"), [], "no errors and no warnings");
    // Money totals are exactly as before.
    assert.equal(snapAfter.tables.shop_orders.columns.total_cents.sum, snapBefore.tables.shop_orders.columns.total_cents.sum);
  });

  test("every table is classified, and exactly the club-owned ones have tenant_id", async () => {
    await migrate(c, { log: quiet });
    const { rows } = await c.query(
      `SELECT c.relname AS t, EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS has
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`,
    );
    const all = rows.map((r) => r.t as string);
    const classified = new Set<string>([...CLUB_OWNED_TABLES, ...PLATFORM_TABLES]);
    assert.deepEqual(all.filter((t) => !classified.has(t)), [], "tables in neither list: add them to packages/db/tenancy.ts");
    assert.deepEqual([...classified].filter((t) => !all.includes(t)).sort(), [], "listed tables that don't exist");
    assert.deepEqual(rows.filter((r) => r.has).map((r) => r.t).sort(), [...CLUB_OWNED_TABLES].sort());
  });

  test("every existing row reads as Three Wolves' (no row was rewritten to get there)", async () => {
    const club = Number((await c.query(`SELECT id FROM tenants WHERE slug = 'three-wolves'`)).rows[0].id);
    for (const t of CLUB_OWNED_TABLES) {
      assert.equal(await n(`SELECT count(*) AS n FROM ${t} WHERE tenant_id IS DISTINCT FROM ${club}`), 0, t);
    }
    assert.equal(await n(`SELECT count(*) AS n FROM attendance WHERE tenant_id = ${club}`), 1);
    assert.equal(await n(`SELECT count(*) AS n FROM shop_orders WHERE tenant_id = ${club}`), 1);
  });

  test("a row written without tenant_id (the previous app version) gets the club", async () => {
    await c.query(`INSERT INTO bookings (session_date, first_name, last_name, email) VALUES ('2026-11-27', 'Guest', 'Player', 'guest@x.test')`);
    await c.query(`INSERT INTO waitlist (session_date, email, name) VALUES ('2026-11-27', 'wait@x.test', 'Wait')`);
    await c.query(`INSERT INTO admin_audit_log (actor_kind, action) VALUES ('system', 'test')`);
    for (const t of ["bookings", "waitlist", "admin_audit_log"]) {
      assert.equal(await n(`SELECT count(*) AS n FROM ${t} WHERE tenant_id IS NULL`), 0, t);
    }
  });

  test("the migration refuses a database with a second club (the default would be wrong)", async () => {
    const other = `${NAME}_two`;
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${other} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${other}`);
    const d = new pg.Client({ connectionString: urlFor(other) });
    await d.connect();
    try {
      const all = loadMigrations();
      const idx = all.findIndex((m) => m.tag === TAG);
      await migrate(d, { migrations: all.slice(0, idx), log: quiet });
      await d.query(`INSERT INTO tenants (slug, name, country, region, timezone, currency) VALUES ('synthetic-club', 'Synthetic', 'NZ', 'syd', 'Pacific/Auckland', 'NZD')`);
      await assert.rejects(migrate(d, { migrations: all.slice(0, idx + 1), log: quiet }), /expected exactly one club/);
      assert.equal((await d.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'tenant_id'`)).rows[0].n, 0, "rolled back");
    } finally {
      await d.end();
      await admin.query(`DROP DATABASE IF EXISTS ${other} WITH (FORCE)`);
      await admin.end();
    }
  });
});
