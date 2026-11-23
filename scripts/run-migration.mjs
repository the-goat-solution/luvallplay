// Runs one reviewed migration file (scripts/migrations/*.sql) in a single
// transaction against POSTGRES_URL (or DATA_GUARD_URL inside a data-guard
// rehearsal, which exports it as POSTGRES_URL).
//
//   node scripts/run-migration.mjs scripts/migrations/<file>.sql
//
// Migrations are idempotent and forward-only (test plan §4.2). Nothing here
// runs at request time.
import { readFileSync } from "node:fs";
import { dbClient } from "./db-client.mjs";

const file = process.argv[2];
const url = process.env.POSTGRES_URL;
if (!file) {
  console.error("Usage: node scripts/run-migration.mjs <file.sql>");
  process.exit(2);
}
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}

const sqlText = readFileSync(file, "utf8");
const client = await dbClient(url, "run-migration");
const started = Date.now();
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(sqlText);
  await client.query("COMMIT");
  const host = new URL(url).hostname;
  console.log(`Applied ${file} to ${host} in ${Date.now() - started} ms.`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`Migration failed, rolled back: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
