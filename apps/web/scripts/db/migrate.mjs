// Versioned migrations (test plan §0 rule 2, §4.2): the only way the schema
// changes. Never runs at request time.
//
//   npm run db:migrate                     apply pending migrations to POSTGRES_URL
//   npm run db:migrate -- --to 0012        apply pending migrations up to and
//                                          including that one, and stop (the
//                                          number or the full tag). Production
//                                          data steps run one at a time.
//   npm run db:migrate -- --status         list applied / pending, change nothing
//   npm run db:migrate -- --baseline       mark an existing database (production)
//                                          as already at the baseline, after
//                                          proving its schema matches the dump
//   npm run db:migrate -- --drift          read-only: compare the live schema
//                                          with docs/schema/production.sql
//
// Migrations live in db/migrations (Drizzle Kit's layout: meta/_journal.json
// plus <tag>.sql, statements split by "--> statement-breakpoint"). The
// applied list is kept in drizzle.__drizzle_migrations with the same hash and
// timestamp Drizzle's own migrator uses, so the two stay interchangeable.
//
// Safety:
// - Each migration runs in its own transaction with lock_timeout 3s and
//   statement_timeout 60s (a file can raise them with SET LOCAL), so a
//   migration fails fast instead of freezing the app. A file whose first line
//   is "-- migrate: no-transaction" runs statement by statement (for CREATE
//   INDEX CONCURRENTLY).
// - A database that has tables but no migration history is refused: either it
//   is production (use --baseline, which checks the schema first) or something
//   is wrong.
// - An applied migration whose file has changed since is refused.
// - A host listed in PRODUCTION_DATABASE_HOSTS needs --production.
//
// DB_DRIVER=neon-ws works here as in the other operator scripts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { dbClient } from "../db-client.mjs";
import { dumpSchema, schemaDiff } from "./dump-schema.mjs";

// apps/web/scripts/db → the repository root (docs/) and packages/db (migrations).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const MIGRATIONS_DIR = path.join(ROOT, "packages/db/migrations");
/** Production's schema when the baseline was taken (frozen; what 0000_baseline produces). */
export const BASELINE_DUMP = path.join(ROOT, "docs/schema/production-2026-11.sql");
/** Production's schema after every migration (updated with each migration; CI checks it). */
export const EXPECTED_DUMP = path.join(ROOT, "docs/schema/production.sql");

export function loadMigrations(dir = MIGRATIONS_DIR) {
  const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8"));
  return journal.entries.map((e) => {
    const text = readFileSync(path.join(dir, `${e.tag}.sql`), "utf8");
    return {
      tag: e.tag,
      when: e.when,
      hash: createHash("sha256").update(text).digest("hex"),
      text,
      noTransaction: /^-- migrate: no-transaction/.test(text),
      statements: text.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean),
    };
  });
}

async function ensureJournal(c) {
  await c.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await c.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
}

async function appliedRows(c) {
  const exists = (await c.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS r`)).rows[0].r;
  if (!exists) return [];
  return (await c.query(`SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id`)).rows;
}

async function publicTableCount(c) {
  const { rows } = await c.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p')`);
  return rows[0].n;
}

/** Works out what would run. Throws on a database that isn't safe to migrate. */
export async function plan(c, migrations = loadMigrations()) {
  const applied = await appliedRows(c);
  const byHash = new Map(applied.map((r) => [r.hash, r]));
  const last = applied.length ? Math.max(...applied.map((r) => Number(r.created_at))) : null;
  for (const m of migrations) {
    if (last !== null && m.when <= last && !byHash.has(m.hash)) {
      throw new Error(`Migration ${m.tag} was changed after it was applied (its hash no longer matches). Write a new migration instead.`);
    }
  }
  if (applied.length === 0 && (await publicTableCount(c)) > 0) {
    throw new Error(
      "This database already has tables but no migration history. If it is production at the baseline, run with --baseline (it checks the schema first). Otherwise stop and investigate.",
    );
  }
  const pending = migrations.filter((m) => last === null || m.when > last);
  return { applied, pending };
}

async function runOne(c, m, log) {
  const started = Date.now();
  if (m.noTransaction) {
    for (const s of m.statements) await c.query(s);
    await c.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`, [m.hash, m.when]);
  } else {
    await c.query("BEGIN");
    try {
      await c.query(`SET LOCAL lock_timeout = '3s'`);
      await c.query(`SET LOCAL statement_timeout = '60s'`);
      for (const s of m.statements) await c.query(s);
      await c.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`, [m.hash, m.when]);
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw new Error(`Migration ${m.tag} failed and was rolled back: ${err.message}`);
    }
  }
  log(`applied ${m.tag} (${Date.now() - started} ms)`);
}

/**
 * The migration `to` names: its full tag ("0012_junior_activity") or its
 * number ("0012", "12"). Throws when it names none, or more than one.
 */
export function resolveTarget(migrations, to) {
  const wanted = String(to ?? "").trim();
  if (!wanted) throw new Error("--to needs a migration: its number (0012) or its full tag (0012_junior_activity).");
  const exact = migrations.filter((m) => m.tag === wanted);
  const byNumber = /^\d+$/.test(wanted) ? migrations.filter((m) => Number(m.tag.split("_")[0]) === Number(wanted)) : [];
  const found = exact.length ? exact : byNumber;
  if (found.length !== 1) {
    throw new Error(`--to ${wanted}: ${found.length ? "more than one migration has that number" : "no such migration"}. Known: ${migrations.map((m) => m.tag).join(", ")}`);
  }
  return found[0];
}

/**
 * Applies pending migrations. Returns the tags applied. With `to`, stops
 * after that migration: the ones after it stay pending.
 */
export async function migrate(c, { migrations = loadMigrations(), log = console.log, to } = {}) {
  let { pending } = await plan(c, migrations);
  if (to !== undefined) {
    // Resolved before anything runs: a mistyped target must not migrate at all.
    const target = resolveTarget(migrations, to);
    const stop = pending.findIndex((m) => m.tag === target.tag);
    if (stop === -1) {
      log(`Nothing to migrate: ${target.tag} is already applied.`);
      return [];
    }
    const held = pending.slice(stop + 1);
    pending = pending.slice(0, stop + 1);
    if (held.length) log(`Stopping after ${target.tag}; left pending: ${held.map((m) => m.tag).join(", ")}`);
  }
  if (pending.length === 0) {
    log("Nothing to migrate: the database is up to date.");
    return [];
  }
  await ensureJournal(c);
  for (const m of pending) await runOne(c, m, log);
  return pending.map((m) => m.tag);
}

/**
 * Marks an existing database as already at the baseline (migration 0), after
 * checking its public schema matches the committed production dump exactly.
 * Additive: creates the drizzle schema, its journal table and one row.
 */
export async function markBaseline(c, { migrations = loadMigrations(), dumpFile = BASELINE_DUMP, log = console.log } = {}) {
  const applied = await appliedRows(c);
  if (applied.length) throw new Error("This database already has a migration history; nothing to baseline.");
  const expected = readFileSync(dumpFile, "utf8");
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const actual = await dumpSchema(c);
  await c.query("ROLLBACK");
  const drift = schemaDiff(expected, actual);
  if (drift.length) {
    throw new Error(`Schema drift: the database doesn't match ${path.relative(ROOT, dumpFile)}, so it can't be marked as at the baseline.\n${drift.slice(0, 40).join("\n")}`);
  }
  const base = migrations[0];
  await ensureJournal(c);
  await c.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`, [base.hash, base.when]);
  log(`Schema matches the baseline dump. Marked ${base.tag} as applied (nothing else ran).`);
}

function isProductionHost(url) {
  const hosts = (process.env.PRODUCTION_DATABASE_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase().split(".")[0].replace(/-pooler$/, "")).filter(Boolean);
  if (!hosts.length) return false;
  try {
    return hosts.includes(new URL(url).hostname.toLowerCase().split(".")[0].replace(/-pooler$/, ""));
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error("POSTGRES_URL is not set.");
    process.exit(2);
  }
  if (isProductionHost(url) && !args.includes("--production") && !args.includes("--status") && !args.includes("--drift")) {
    console.error("This is a production database (PRODUCTION_DATABASE_HOSTS). Add --production once the change has been rehearsed (test plan §4.4).");
    process.exit(2);
  }
  const c = await dbClient(url, "db-migrate");
  await c.connect();
  try {
    if (args.includes("--status")) {
      const migrations = loadMigrations();
      const applied = await appliedRows(c);
      const done = new Set(applied.map((r) => r.hash));
      for (const m of migrations) console.log(`${done.has(m.hash) ? "applied" : "pending"}  ${m.tag}`);
      if (!applied.length && (await publicTableCount(c)) > 0) console.log("(tables exist but there is no migration history: see --baseline)");
    } else if (args.includes("--drift")) {
      // Read-only: the live public schema against docs/schema/production.sql
      // (what the migrations produce; CI proves that side).
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const actual = await dumpSchema(c);
      await c.query("ROLLBACK");
      const drift = schemaDiff(readFileSync(EXPECTED_DUMP, "utf8"), actual);
      if (drift.length) {
        console.error(`Schema drift against ${path.relative(ROOT, EXPECTED_DUMP)} (- expected, + live):\n${drift.join("\n")}`);
        process.exitCode = 1;
      } else console.log(`No schema drift: the database matches ${path.relative(ROOT, EXPECTED_DUMP)}.`);
    } else if (args.includes("--baseline")) {
      await markBaseline(c);
    } else {
      const at = args.indexOf("--to");
      // "--to" with nothing after it is an error, not "everything".
      await migrate(c, at === -1 ? {} : { to: args[at + 1] ?? "" });
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
