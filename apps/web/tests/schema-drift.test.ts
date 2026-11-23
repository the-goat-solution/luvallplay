// Schema drift check (test plan §3.3, §4.5: "ensureTables() → migrations:
// schema drift check must be empty before the switch").
//
// Needs Postgres 18, like production (CI's service container). Uses
// DATA_GUARD_TEST_URL's server and creates scratch databases next to it.
// CI sets DATA_GUARD_REQUIRE_DB=1 so this can't be skipped silently.
//
// 1. Migrations on an empty database give exactly docs/schema/production.sql,
//    and the baseline alone gives the frozen production dump it came from.
// 2. db/schema.ts (Drizzle) describes the same schema: a database built only
//    from it matches production, and Drizzle Kit sees nothing to migrate.
// 3. The runner is safe: idempotent, refuses a database with tables and no
//    history, refuses to baseline a database that has drifted, and refuses an
//    applied migration that was edited.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { dumpSchema, schemaDiff, tablesOnly } from "../scripts/db/dump-schema.mjs";
import { loadMigrations, migrate, markBaseline, plan, BASELINE_DUMP, EXPECTED_DUMP, MIGRATIONS_DIR } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
// The Drizzle schema lives in packages/db (Phase 2 monorepo).
const DB_SCHEMA = new URL("../../../packages/db/schema.ts", import.meta.url).pathname;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const quiet = () => {};
const created: string[] = [];

function urlFor(db: string): string {
  const u = new URL(BASE_URL!);
  u.pathname = `/${db}`;
  return u.toString();
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: urlFor("postgres") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function freshDb(tag: string): Promise<string> {
  const name = `drift_${tag}_${process.pid}`;
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${name}`);
  });
  created.push(name);
  return urlFor(name);
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const dumpOf = (url: string) => withClient(url, (c) => dumpSchema(c));

function assertNoDrift(expectedFile: string, actual: string, what: string) {
  const drift = schemaDiff(readFileSync(expectedFile, "utf8"), actual);
  assert.deepEqual(drift, [], `${what} differs from ${expectedFile} (- expected, + actual):\n${drift.join("\n")}`);
}

describe("schema drift", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL to a scratch Postgres 18" : false }, () => {
  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const version = await admin(async (c) => Number((await c.query(`SHOW server_version_num`)).rows[0].server_version_num));
    // Postgres 18 lists NOT NULL constraints in the catalog; the dump of
    // production (18) includes them, so compare like with like.
    assert.ok(version >= 180000, `the drift check needs Postgres 18 like production (found ${version})`);
  });

  after(async () => {
    await admin(async (c) => {
      for (const name of created) await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    });
  });

  test("migrations on an empty database give exactly the production schema", async () => {
    const url = await freshDb("migrations");
    const applied = await withClient(url, (c) => migrate(c, { log: quiet }));
    assert.deepEqual(applied, loadMigrations().map((m) => m.tag));
    assertNoDrift(EXPECTED_DUMP, await dumpOf(url), "the schema after all migrations");
  });

  test("the baseline alone reproduces the frozen production dump it came from", async () => {
    const url = await freshDb("baseline");
    const [base] = loadMigrations();
    await withClient(url, (c) => migrate(c, { migrations: [base], log: quiet }));
    assertNoDrift(BASELINE_DUMP, await dumpOf(url), "the baseline migration");
  });

  test("db/schema.ts builds the same schema, and Drizzle Kit sees nothing to migrate", async () => {
    const out = mkdtempSync(join(tmpdir(), "drizzle-gen-"));
    try {
      // From scratch: the whole schema as Drizzle Kit would create it.
      const gen = spawnSync("npx", ["drizzle-kit", "generate", "--dialect", "postgresql", "--schema", DB_SCHEMA, "--out", out, "--name", "from_schema"], { encoding: "utf8" });
      assert.equal(gen.status, 0, gen.stdout + gen.stderr);
      const url = await freshDb("schema_ts");
      const text = readFileSync(join(out, "0000_from_schema.sql"), "utf8");
      await withClient(url, async (c) => {
        // tenant_id's default calls this function, which a Drizzle schema can't describe (migration 0007 creates it).
        await c.query(`CREATE FUNCTION app_tenant_id() RETURNS integer LANGUAGE sql STABLE AS $fn$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer $fn$`);
        for (const s of text.split("--> statement-breakpoint").map((x) => x.trim()).filter(Boolean)) await c.query(s);
      });
      // Migrations after the baseline change the schema; only compare to the
      // latest dump.
      // Tables, indexes and sequences: a Drizzle schema can't describe the
      // functions and triggers, which the migrations test above covers.
      const drift = schemaDiff(tablesOnly(readFileSync(EXPECTED_DUMP, "utf8")), await dumpOf(url));
      assert.deepEqual(drift, [], `a database built from db/schema.ts differs from ${EXPECTED_DUMP} (- expected, + actual):\n${drift.join("\n")}`);

      // Against the committed migrations: nothing new.
      const copy = mkdtempSync(join(tmpdir(), "drizzle-migs-"));
      cpSync(MIGRATIONS_DIR, copy, { recursive: true });
      const check = spawnSync("npx", ["drizzle-kit", "generate", "--dialect", "postgresql", "--schema", DB_SCHEMA, "--out", copy], { encoding: "utf8" });
      const files = readdirSync(copy).filter((f) => f.endsWith(".sql"));
      rmSync(copy, { recursive: true, force: true });
      assert.equal(check.status, 0, check.stdout + check.stderr);
      assert.deepEqual(files, readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")), `db/schema.ts and db/migrations disagree (Drizzle Kit wrote a new migration); run npx drizzle-kit generate:\n${check.stdout}${check.stderr}`);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("migrating twice is a no-op", async () => {
    const url = await freshDb("twice");
    await withClient(url, (c) => migrate(c, { log: quiet }));
    const again = await withClient(url, (c) => migrate(c, { log: quiet }));
    assert.deepEqual(again, []);
  });

  test("a database with tables but no history is refused; --baseline checks the schema first", async () => {
    // Production-shaped database without a history: the baseline applied by hand.
    const prodLike = await freshDb("prod_like");
    const [base] = loadMigrations();
    await withClient(prodLike, async (c) => {
      for (const s of base.statements) await c.query(s);
    });
    await withClient(prodLike, async (c) => {
      await assert.rejects(plan(c), /no migration history/);
      await markBaseline(c, { log: quiet });
      const { pending } = await plan(c);
      assert.deepEqual(pending.map((m) => m.tag), loadMigrations().slice(1).map((m) => m.tag));
    });

    // A drifted copy (one column missing) can't be marked.
    const drifted = await freshDb("drifted");
    await withClient(drifted, async (c) => {
      for (const s of base.statements) await c.query(s);
      await c.query(`ALTER TABLE players DROP COLUMN phone_e164 CASCADE`);
      await assert.rejects(markBaseline(c, { log: quiet }), /Schema drift[\s\S]*phone_e164/);
      assert.equal((await c.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS r`)).rows[0].r, null, "nothing recorded");
    });
  });

  test("an applied migration that was edited afterwards is refused", async () => {
    const url = await freshDb("edited");
    const migrations = loadMigrations();
    await withClient(url, (c) => migrate(c, { migrations, log: quiet }));
    const edited = migrations.map((m, i) => (i === 0 ? { ...m, hash: "0".repeat(64) } : m));
    await withClient(url, async (c) => assert.rejects(plan(c, edited), /changed after it was applied/));
  });

  test("a failing migration rolls back completely", async () => {
    const url = await freshDb("rollback");
    const migrations = loadMigrations();
    await withClient(url, (c) => migrate(c, { migrations, log: quiet }));
    const bad = { tag: "9999_bad", when: Date.now() + 1, hash: "f".repeat(64), text: "", noTransaction: false, statements: ["CREATE TABLE zz_new (id int)", "SELECT * FROM no_such_table"] };
    await withClient(url, async (c) => {
      await assert.rejects(migrate(c, { migrations: [...migrations, bad], log: quiet }), /9999_bad failed and was rolled back/);
      assert.equal((await c.query(`SELECT to_regclass('zz_new') AS r`)).rows[0].r, null);
      const { pending } = await plan(c, [...migrations, bad]);
      assert.deepEqual(pending.map((m) => m.tag), ["9999_bad"]);
    });
  });

  test("preview builds migrate the preview's own database, and never production", async () => {
    const run = (extra: Record<string, string | undefined>) =>
      spawnSync(process.execPath, ["scripts/db/preview-migrate.mjs"], {
        encoding: "utf8",
        env: { ...process.env, VERCEL_ENV: undefined, DATABASE_URL_VAR: undefined, POSTGRES_URL_NON_POOLING: undefined, ...extra },
      });
    // A branch of production made before production had a migration history.
    const branch = await freshDb("preview_branch");
    const [base] = loadMigrations();
    await withClient(branch, async (c) => {
      for (const s of base.statements) await c.query(s);
    });
    const host = new URL(branch).hostname;

    // Not a preview: nothing happens.
    let r = run({ POSTGRES_URL: branch });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(await withClient(branch, async (c) => (await c.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS r`)).rows[0].r), null);

    // A preview pointed at production: refused by the guard, nothing happens.
    r = run({ VERCEL_ENV: "preview", POSTGRES_URL: branch, PRODUCTION_DATABASE_HOSTS: host });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /skipped: this preview is connected to the production database/);
    assert.equal(await withClient(branch, async (c) => (await c.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS r`)).rows[0].r), null);

    // Its own branch: baselined (schema checked) and migrated.
    r = run({ VERCEL_ENV: "preview", POSTGRES_URL: branch, PRODUCTION_DATABASE_HOSTS: "ep-prod-1234.example.neon.tech" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Marked 0000_baseline as applied/);
    assertNoDrift(EXPECTED_DUMP, await dumpOf(branch), "the preview branch after preview-migrate");
    r = run({ VERCEL_ENV: "preview", POSTGRES_URL: branch, PRODUCTION_DATABASE_HOSTS: "ep-prod-1234.example.neon.tech" });
    assert.match(r.stdout, /Nothing to migrate/);
  });

  test("default seed matches the app's defaults and is safe to run twice", async () => {
    const { DEFAULT_PAUSED_DAYS } = await import("../lib/constants.ts");
    const { SIZES, FITS } = await import("../lib/shop-db.ts");
    const url = await freshDb("seed");
    await withClient(url, (c) => migrate(c, { log: quiet }));
    const seed = readFileSync(new URL("../../../packages/db/seed/defaults.sql", import.meta.url), "utf8");
    await withClient(url, async (c) => {
      await c.query(seed);
      await c.query(`UPDATE day_signup_settings SET paused = FALSE WHERE day = 'wednesday'`);
      await c.query(seed);
      const days = (await c.query(`SELECT day, paused FROM day_signup_settings ORDER BY day`)).rows;
      assert.deepEqual(days.map((d) => d.day).sort(), [...DEFAULT_PAUSED_DAYS].sort());
      assert.ok(days.every((d) => d.paused === false), "an admin's choice is never undone");
      const variants = (await c.query(`SELECT fit, size FROM shop_variants ORDER BY id`)).rows;
      assert.deepEqual(variants.map((v) => `${v.fit}:${v.size}`), FITS.flatMap((f) => SIZES.map((sz) => `${f}:${sz}`)));
    });
  });

  test("the drift checker itself notices a changed default, a missing index and reordered columns", () => {
    const base = readFileSync(EXPECTED_DUMP, "utf8");
    assert.deepEqual(schemaDiff(base, base), []);
    assert.ok(schemaDiff(base, base.replace("max_spots integer DEFAULT 8", "max_spots integer DEFAULT 12")).length > 0);
    const noIndex = base.split("\n").filter((l) => !l.startsWith("CREATE INDEX admin_audit_log_at")).join("\n");
    assert.ok(schemaDiff(base, noIndex).length > 0);
    const lines = base.split("\n");
    const i = lines.findIndex((l) => l.startsWith("  id integer DEFAULT nextval('api_tokens_id_seq"));
    [lines[i], lines[i + 1]] = [lines[i + 1], lines[i]];
    assert.deepEqual(schemaDiff(base, lines.join("\n")), ["~ same statements in a different order"]);
  });
});
