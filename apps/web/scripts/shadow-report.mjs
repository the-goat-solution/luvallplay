// The record of shadow reads (lib/shadow-log.ts), one line per day.
//
//   node --import ./tests/register.mjs scripts/shadow-report.mjs [days]
//
// Read-only. Seven days with "clean" rows and no "differ" row is the
// evidence the Phase 3 gate asks for before reads switch. POSTGRES_URL
// chooses the database; DB_DRIVER=neon-ws works as in the other scripts.
import { dbClient } from "./db-client.mjs";
import { shadowReport } from "../lib/shadow-log.ts";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}
const days = Number(process.argv[2] ?? 14);
const client = await dbClient(url, "shadow-report");
await client.connect();
try {
  const rows = await shadowReport({ query: (t, p) => client.query(t, p) }, days);
  if (rows.length === 0) console.log(`No shadow reads recorded in the last ${days} days.`);
  for (const r of rows) console.log(`${r.day}  ${r.what.padEnd(12)} clean ${r.clean}  differ ${r.differ}  unavailable ${r.unavailable}`);
  const bad = rows.filter((r) => r.differ > 0);
  const cleanDays = new Set(rows.filter((r) => r.clean > 0 && r.differ === 0).map((r) => r.day)).size;
  console.log(`\n${cleanDays} clean day(s); ${bad.length} day(s) with a difference.`);
  process.exitCode = bad.length ? 1 : 0;
} finally {
  await client.end();
}
