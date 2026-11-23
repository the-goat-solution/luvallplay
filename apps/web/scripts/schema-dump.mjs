// Schema-only dump built from the Postgres catalog: tables, columns,
// defaults, constraints, indexes and sequences, in a stable order. No data.
// Works where pg_dump can't connect (DB_DRIVER=neon-ws, see db-client.mjs).
// Used for the schema drift check (test plan §3.3).
//
//   POSTGRES_URL=... node scripts/schema-dump.mjs > docs/schema/<name>.sql
import { dbClient } from "./db-client.mjs";
import { dumpSchema } from "./db/dump-schema.mjs";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}
const c = await dbClient(url, "schema-dump");
await c.connect();
try {
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const text = await dumpSchema(c);
  await c.query("ROLLBACK");
  process.stdout.write(text);
} finally {
  await c.end();
}
