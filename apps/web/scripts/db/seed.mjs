// Default settings for a new database (db/seed/defaults.sql). Idempotent.
// Refuses production hosts (PRODUCTION_DATABASE_HOSTS): production already
// has these rows, and its data only changes through the rehearsed protocol.
//
//   POSTGRES_URL=... npm run db:seed
import { readFileSync } from "node:fs";
import { dbClient } from "../db-client.mjs";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}
const endpoint = (h) => h.trim().toLowerCase().split(".")[0].replace(/-pooler$/, "");
const prod = (process.env.PRODUCTION_DATABASE_HOSTS ?? "").split(",").filter(Boolean).map(endpoint);
if (prod.includes(endpoint(new URL(url).hostname))) {
  console.error("Refusing to seed a production database.");
  process.exit(2);
}
const c = await dbClient(url, "db-seed");
await c.connect();
try {
  await c.query(readFileSync(new URL("../../../../packages/db/seed/defaults.sql", import.meta.url), "utf8"));
  console.log("Seeded default settings (existing rows kept).");
} finally {
  await c.end();
}
