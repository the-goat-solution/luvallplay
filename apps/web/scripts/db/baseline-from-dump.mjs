// Turns the committed production schema dump into the baseline migration
// (db/migrations/0000_baseline.sql). Run once, when the baseline was made;
// kept so the step is reviewable and repeatable.
//
//   node scripts/db/baseline-from-dump.mjs docs/schema/production-2026-11.sql > db/migrations/0000_baseline.sql
//
// Order: sequences → tables (columns, primary keys, unique and check
// constraints) → foreign keys → indexes → sequence ownership. Plain CREATE
// statements, no IF NOT EXISTS: the baseline only ever runs on an empty
// database (production is marked as already at the baseline, never re-run),
// and anything that already exists is an error worth seeing.
//
// The schema drift check (tests/schema-drift.test.ts) proves that applying
// this file to an empty database gives back the production dump exactly.
import { readFileSync } from "node:fs";

const dump = readFileSync(process.argv[2] ?? new URL("../../../../docs/schema/production-2026-11.sql", import.meta.url), "utf8");

const sequences = [];
const owners = [];
const tables = [];
const foreignKeys = [];
const indexes = [];

for (const block of dump.split(/\n(?=CREATE TABLE )/)) {
  const m = block.match(/^CREATE TABLE (\w+) \(\n([\s\S]*?)\n\);/m);
  if (!m) continue;
  const [, name, body] = m;
  const kept = [];
  for (const raw of body.split(",\n")) {
    const line = raw.trim();
    // Named NOT NULL constraints (Postgres 18 lists them in the catalog) carry
    // the default names; the inline NOT NULL on the column recreates them.
    if (/^CONSTRAINT \w+ NOT NULL \w+$/.test(line)) continue;
    if (/^CONSTRAINT \w+ FOREIGN KEY /.test(line)) {
      foreignKeys.push(`ALTER TABLE ${name} ADD ${line};`);
      continue;
    }
    kept.push(`  ${line}`);
  }
  tables.push(`CREATE TABLE ${name} (\n${kept.join(",\n")}\n);`);
  for (const idx of block.matchAll(/^(CREATE (?:UNIQUE )?INDEX [^\n]+;)$/gm)) indexes.push(idx[1]);
}

for (const s of dump.matchAll(/^CREATE SEQUENCE (\w+) AS (\w+)([^;]*?)(?: OWNED BY (\w+\.\w+))?;$/gm)) {
  const [, name, type, extra, owner] = s;
  sequences.push(`CREATE SEQUENCE ${name} AS ${type}${extra};`);
  if (owner) owners.push(`ALTER SEQUENCE ${name} OWNED BY ${owner};`);
}

const sections = [
  [
    "-- Baseline: the production schema as of the Phase 2 start (Nov 2026),",
    "-- generated from docs/schema/production-2026-11.sql by",
    "-- scripts/db/baseline-from-dump.mjs. Production is marked as already at",
    "-- this migration (npm run db:migrate -- --baseline); it only runs on empty",
    "-- databases (CI, local, new environments).",
    "",
    "SET lock_timeout = '3s';",
    "SET statement_timeout = '120s';",
  ].join("\n"),
  sequences.join("\n"),
  tables.join("\n\n"),
  foreignKeys.join("\n"),
  indexes.join("\n"),
  owners.join("\n"),
];
// Drizzle's migrator splits files on this marker; each part runs on its own.
process.stdout.write(sections.join("\n--> statement-breakpoint\n") + "\n");
