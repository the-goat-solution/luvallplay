// Applies scripts/schema.sql to the site's database (SITE_DATABASE_URL).
// `--if-configured`: do nothing when no database is set (CI builds, forks).
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.SITE_DATABASE_URL;
if (!url) {
  if (process.argv.includes("--if-configured")) {
    console.log("migrate: SITE_DATABASE_URL not set, skipping");
    process.exit(0);
  }
  console.error("migrate: set SITE_DATABASE_URL");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf8"));
  console.log("migrate: schema is up to date");
} finally {
  await client.end();
}
