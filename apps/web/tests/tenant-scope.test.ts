// Phase 3 steps 10 and 11: running as the app's role for one club
// (lib/tenant-scope.ts), and the shadow reads that compare it with today's
// owner connection before anything is switched.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { CLUB_OWNED_TABLES } from "@luvallplay/db/tenancy";
import { migrate } from "../scripts/db/migrate.mjs";
import { isReadOnlyStatement, probeTenantIsolation, readScoped, scopeClient, scopePool, textOf, transactionVerb } from "../lib/tenant-scope.ts";
import { shadowHeartbeat } from "../lib/shadow-log.ts";

test("statements that open or close a transaction are recognised", () => {
  for (const t of ["BEGIN", "begin;", "  BEGIN ISOLATION LEVEL SERIALIZABLE", "START TRANSACTION", "start   transaction read only"]) assert.equal(transactionVerb(t), "begin", t);
  for (const t of ["COMMIT", "commit;", "END", "ROLLBACK", "rollback;", "ABORT"]) assert.equal(transactionVerb(t), "end", t);
  for (const t of ["ROLLBACK TO SAVEPOINT a", "rollback to a", "SAVEPOINT a", "SELECT 1", "UPDATE t SET commit = 1", "SELECT 'BEGIN'", ""]) assert.equal(transactionVerb(t), null, t);
  assert.equal(textOf(["SELECT 1", [1]]), "SELECT 1");
  assert.equal(textOf([{ text: "SELECT 2", values: [] }]), "SELECT 2");
  assert.equal(textOf([undefined]), "");
});

test("only statements that can't change anything are run a second time", () => {
  for (const t of ["SELECT 1", "  select * from bookings where email = $1", "WITH x AS (SELECT 1) SELECT * FROM x", "SELECT count(*) FROM sessions;"]) assert.equal(isReadOnlyStatement(t), true, t);
  for (const t of [
    "INSERT INTO t VALUES (1)", "UPDATE t SET a = 1", "DELETE FROM t",
    "WITH x AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM x",
    "WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x",
    "SELECT nextval('s')", "SELECT set_config('app.tenant_id', '2', false)", "SELECT pg_advisory_lock(1)", "SELECT pg_advisory_xact_lock(1)",
    "SELECT * FROM t FOR UPDATE", "SELECT * FROM t FOR NO KEY UPDATE", "SELECT 1; DROP TABLE t", "BEGIN", "",
  ]) assert.equal(isReadOnlyStatement(t), false, t);
});

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `tenant_scope_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");

describe("the scoped connection", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let pool: pg.Pool;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  let club2 = 0;
  const who = `SELECT current_user AS role, current_setting('app.tenant_id', true) AS club`;
  const originalWarn = console.warn;

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
    await c.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES ($1, 'home', true)`, [club2]);
    c.release();
    console.warn = () => {};
  });
  after(async () => {
    console.warn = originalWarn;
    await pool?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });
  beforeEach(async () => {
    await pool.query(`DELETE FROM admin_audit_log WHERE action LIKE 'shadow.%'`);
  });

  test("a statement on its own runs as the app's role for the club, and leaves nothing set behind", async () => {
    const scoped = scopePool(pool, async () => 1);
    assert.deepEqual((await scoped.query(who)).rows, [{ role: "luvallplay_app", club: "1" }]);
    assert.equal((await scoped.query(`SELECT count(*)::int AS n FROM tenant_modules`)).rows[0].n, (await pool.query(`SELECT count(*)::int AS n FROM tenant_modules WHERE tenant_id = 1`)).rows[0].n);
    assert.equal((await scopePool(pool, async () => club2).query(`SELECT count(*)::int AS n FROM tenant_modules`)).rows[0].n, 1);
    // Every pooled connection is back to the owner with no club named.
    for (let i = 0; i < 8; i++) {
      const r = (await pool.query(who)).rows[0];
      assert.notEqual(r.role, "luvallplay_app");
      assert.ok(r.club === null || r.club === "", `club left set: ${r.club}`);
    }
  });

  test("the caller's own transaction gets the role and the club after its BEGIN, until COMMIT or ROLLBACK", async () => {
    const scoped = scopePool(pool, async () => 1);
    const client = await scoped.connect();
    try {
      await client.query("BEGIN");
      assert.deepEqual((await client.query(who)).rows, [{ role: "luvallplay_app", club: "1" }]);
      await client.query(`INSERT INTO usage_counters (tenant_id, metric, period, quantity) VALUES (1, 'email.sent', '2026-11-01', 5)`);
      await client.query("SAVEPOINT a");
      await assert.rejects(client.query(`INSERT INTO usage_counters (tenant_id, metric, period, quantity) VALUES ($1, 'email.sent', '2026-11-01', 5)`, [club2]), /row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT a");
      assert.deepEqual((await client.query(who)).rows, [{ role: "luvallplay_app", club: "1" }], "still scoped after a savepoint rollback");
      await client.query("COMMIT");
      // Outside a transaction each statement is scoped on its own.
      assert.deepEqual((await client.query(who)).rows, [{ role: "luvallplay_app", club: "1" }]);
      await client.query("BEGIN");
      await client.query(`UPDATE usage_counters SET quantity = 99`);
      await client.query("ROLLBACK");
      assert.equal((await client.query(`SELECT quantity::int AS q FROM usage_counters`)).rows[0].q, 5);
      // A failing statement outside a transaction doesn't leave one open.
      await assert.rejects(client.query(`SELECT * FROM no_such_table`), /does not exist/);
      assert.deepEqual((await client.query(`SELECT 1 AS ok`)).rows, [{ ok: 1 }]);
    } finally {
      client.release();
    }
    assert.equal((await pool.query(`SELECT quantity::int AS q FROM usage_counters WHERE tenant_id = 1`)).rows[0].q, 5, "the committed write is there");
    await pool.query(`DELETE FROM usage_counters`);
  });

  test("an error keeps its code, so callers that handle a duplicate or a missing table still do", async () => {
    const scoped = scopePool(pool, async () => 1);
    await scoped.query(`INSERT INTO usage_counters (tenant_id, metric, period, quantity) VALUES (1, 'sms.sent', '2026-11-01', 1)`);
    await assert.rejects(scoped.query(`INSERT INTO usage_counters (tenant_id, metric, period, quantity) VALUES (1, 'sms.sent', '2026-11-01', 1)`), (e: { code?: string }) => e.code === "23505");
    await assert.rejects(scoped.query(`SELECT * FROM no_such_table`), (e: { code?: string }) => e.code === "42P01");
    await pool.query(`DELETE FROM usage_counters`);
  });

  test("a scoped read can't write, and with no club named sees nothing", async () => {
    assert.ok((await readScoped(pool, 1, `SELECT * FROM tenant_modules`)).rows.length > 1);
    assert.equal((await readScoped(pool, null, `SELECT * FROM tenant_modules`)).rows.length, 0);
    await assert.rejects(readScoped(pool, 1, `UPDATE tenant_modules SET enabled = enabled`), /read-only transaction/);
    const one = scopeClient(await pool.connect(), 1);
    (one as unknown as pg.PoolClient).release();
  });

  test("the isolation probe is clean, and says exactly what is wrong when a policy is missing", async () => {
    assert.deepEqual(await probeTenantIsolation(pool, 1, CLUB_OWNED_TABLES), []);
    await pool.query(`DROP POLICY tenant_isolation ON tenant_modules`);
    await pool.query(`CREATE POLICY tenant_isolation ON tenant_modules FOR ALL USING (true)`);
    try {
      const differences = await probeTenantIsolation(pool, 1, CLUB_OWNED_TABLES);
      assert.equal(differences.length, 2);
      assert.match(differences[0], /^tenant_modules: the app's role sees \d+ rows, the club has \d+$/);
      assert.match(differences[1], /^tenant_modules: \d+ rows visible with no club named$/);
      // The daily heartbeat puts it on the durable record.
      const out = await shadowHeartbeat(pool, pool);
      assert.deepEqual(out.map((o) => [o.what, o.result]), [["settings", "clean"], ["routing", "clean"], ["tenant-reads", "differ"]]);
      const row = (await pool.query(`SELECT target, meta FROM admin_audit_log WHERE action = 'shadow.tenant-reads'`)).rows[0];
      assert.equal(row.target, "differ");
      assert.equal(row.meta.tables, CLUB_OWNED_TABLES.length);
    } finally {
      await pool.query(`DROP POLICY tenant_isolation ON tenant_modules`);
      await pool.query(`CREATE POLICY tenant_isolation ON tenant_modules FOR ALL USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())`);
    }
    const out = await shadowHeartbeat(pool, pool);
    assert.deepEqual(out.map((o) => [o.what, o.result]), [["settings", "clean"], ["routing", "clean"], ["tenant-reads", "clean"]]);
  });
});

describe("the database client's modes (standard-Postgres driver)", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  const DB = `tenant_scope_client_${process.pid}`;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const env = { ...process.env };
  const originalWarn = console.warn;
  let database: typeof import("../lib/database.ts");
  let admin: pg.Client;
  const who = `SELECT current_user AS role, current_setting('app.tenant_id', true) AS club`;

  before(async () => {
    const root = new pg.Client({ connectionString: urlFor("postgres") });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await root.query(`CREATE DATABASE ${DB}`);
    await root.end();
    admin = new pg.Client({ connectionString: urlFor(DB) });
    await admin.connect();
    await migrate(admin, { log: () => {} });
    await admin.query(SEED);
    process.env.POSTGRES_URL = urlFor(DB);
    process.env.DATABASE_DRIVER = "postgres";
    process.env.TENANT_SHADOW_SAMPLE = "1";
    delete process.env.TENANT_SLUG;
    database = await import("../lib/database.ts?tenant-scope-test");
    console.warn = () => {};
  });
  after(async () => {
    console.warn = originalWarn;
    await database?.closeDatabase();
    process.env = env;
    await admin?.end();
    const root = new pg.Client({ connectionString: urlFor("postgres") });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await root.end();
  });

  test("the mode: off by default, and anything unrecognised enforces", () => {
    for (const [v, mode] of [[undefined, "off"], ["off", "off"], ["shadow", "shadow"], ["enforce", "enforce"], ["ENFORCE", "enforce"], ["on", "enforce"], ["shadwo", "enforce"]] as const) {
      if (v === undefined) delete process.env.TENANT_SCOPE;
      else process.env.TENANT_SCOPE = v;
      assert.equal(database.tenantScopeMode(), mode, String(v));
    }
  });

  test("with the app's own login, every mode is enforce: that login can't read as the owner", () => {
    process.env.APP_DATABASE_URL = "postgres://luvallplay_web:x@db.example/app";
    try {
      for (const v of [undefined, "off", "shadow", "enforce"]) {
        if (v === undefined) delete process.env.TENANT_SCOPE;
        else process.env.TENANT_SCOPE = v;
        assert.equal(database.tenantScopeMode(), "enforce", String(v));
      }
    } finally {
      delete process.env.APP_DATABASE_URL;
    }
    assert.equal(database.appLogin(), null);
  });

  test("off: queries run as the connection's own role", async () => {
    process.env.TENANT_SCOPE = "off";
    const r = (await database.sql.query(who)).rows[0];
    assert.notEqual(r.role, "luvallplay_app");
  });

  test("enforce: the template, query(), connect() and the ORM all run as the app's role for the club", async () => {
    process.env.TENANT_SCOPE = "enforce";
    const want = [{ role: "luvallplay_app", club: "1" }];
    assert.deepEqual((await database.sql`SELECT current_user AS role, current_setting('app.tenant_id', true) AS club`).rows, want);
    assert.deepEqual((await database.sql.query(who)).rows, want);
    const client = await database.db.connect();
    try {
      await client.query("BEGIN");
      assert.deepEqual((await client.query(who)).rows, want);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const viaOrm = await database.orm().execute(who);
    assert.deepEqual(viaOrm.rows, want);
    const modules = await database.orm().select().from(database.schema.tenant_modules);
    assert.ok(modules.length > 5);
    assert.ok(modules.every((m) => m.tenant_id === 1));
    await database.orm().transaction(async (tx) => {
      assert.deepEqual((await tx.execute(who)).rows, want);
    });
  });

  test("shadow: reads still come from the owner, and a read the app's role would answer differently is recorded once", async () => {
    process.env.TENANT_SCOPE = "shadow";
    const shadowRows = async () => (await admin.query(`SELECT target, meta FROM admin_audit_log WHERE action = 'shadow.tenant-reads' ORDER BY id`)).rows;
    await admin.query(`DELETE FROM admin_audit_log WHERE action LIKE 'shadow.%'`);
    // Clean: the same answer both ways, nothing recorded.
    const r = await database.sql.query(`SELECT module_id FROM tenant_modules ORDER BY module_id`);
    assert.ok(r.rows.length > 5);
    await database.sql`SELECT count(*)::int AS n FROM bookings`;
    // The same rows in another order (no ORDER BY) aren't a difference.
    await database.sql.query(`SELECT module_id FROM tenant_modules`);
    await database.sql.query(`SELECT now(), random()`); // not deterministic: can't be compared, not reported
    await database.sql.query(`UPDATE tenant_modules SET enabled = enabled WHERE module_id = $1`, ["home"]); // a write is never run twice
    assert.deepEqual(await shadowRows(), []);
    // A row the app's role can't see (another club's): the difference is recorded, once.
    const club2 = (
      await admin.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, payment_mode, incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
    await admin.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES ($1, 'home', true)`, [club2]);
    const leaky = `SELECT tenant_id, module_id FROM tenant_modules ORDER BY tenant_id, module_id`;
    const first = await database.sql.query(leaky);
    assert.ok(first.rows.some((x: { tenant_id: number }) => x.tenant_id === club2), "today's owner connection sees every club: exactly what the shadow read is for");
    await database.sql.query(leaky);
    const recorded = await shadowRows();
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].target, "differ");
    assert.equal(recorded[0].meta.detail, "rows differ");
    assert.match(recorded[0].meta.statement, /^SELECT tenant_id, module_id FROM tenant_modules/);
    // A statement the app's role isn't allowed to run at all is recorded too.
    await database.sql.query(`SELECT count(*)::int AS n FROM pg_authid`);
    const withError = await shadowRows();
    assert.equal(withError.length, 2);
    assert.match(withError[1].meta.detail, /^error as the app's role: permission denied/);
    // Parameters are never written to the record.
    await database.sql.query(`SELECT tenant_id FROM tenant_modules WHERE module_id = $1 ORDER BY 1`, ["home"]);
    const last = (await shadowRows()).at(-1)!;
    assert.match(last.meta.statement, /\$1/);
    assert.doesNotMatch(JSON.stringify(last.meta), /"home"/);
  });
});
