// The record of shadow reads (lib/shadow-log.ts), and the step 11 gate.
//
//   node --import ./tests/register.mjs scripts/shadow-report.mjs [days] [--since YYYY-MM-DD] [--need 7]
//
// Read-only. Prints one line per day and check, then each day's verdict.
//
// A day is clean only when EVERY check (settings, routing, tenant-reads) has
// a clean result that day and none has a "differ" or an "unavailable" one. A
// day with nothing recorded isn't clean either. The gate is `--need` clean
// days in a row (default 7), ending at the latest day on the record.
//
//   --since   the day the clock (re)started. Days before it are ignored; any
//             day from it on that isn't clean fails the gate.
//
// Exit code: 0 when the gate is met, 1 when it isn't, 2 on a usage error.
// POSTGRES_URL chooses the database; DB_DRIVER=neon-ws works as in the other
// scripts.
import { dbClient } from "./db-client.mjs";
import { shadowReport, shadowVerdict } from "../lib/shadow-log.ts";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const [, value] = args.splice(at, 2);
  return value ?? "";
};
const since = option("--since");
const needText = option("--need");
const need = needText === undefined ? 7 : Number(needText);
if (since !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(since)))) {
  console.error("--since needs a day: YYYY-MM-DD.");
  process.exit(2);
}
if (!Number.isInteger(need) || need < 1) {
  console.error("--need needs a whole number of days, 1 or more.");
  process.exit(2);
}
const today = new Date().toISOString().slice(0, 10);
// The window always reaches back to --since, so no day of the clock is cut off.
const sinceDays = since ? Math.ceil((Date.parse(today) - Date.parse(since)) / 86_400_000) + 1 : 0;
const days = Math.max(Number(args[0] ?? 14) || 14, sinceDays);
const client = await dbClient(url, "shadow-report");
await client.connect();
try {
  const all = await shadowReport({ query: (t, p) => client.query(t, p) }, days);
  const rows = since ? all.filter((r) => r.day >= since) : all;
  if (rows.length === 0) console.log(`No shadow reads recorded ${since ? `since ${since}` : `in the last ${days} days`}.`);
  for (const r of rows) console.log(`${r.day}  ${r.what.padEnd(12)} clean ${r.clean}  differ ${r.differ}  unavailable ${r.unavailable}`);
  const verdict = shadowVerdict(rows, { today, since, need });
  console.log("");
  for (const d of [...verdict.days].reverse()) console.log(`${d.day}  ${d.clean ? "CLEAN" : `NOT CLEAN: ${d.reasons.join("; ")}`}`);
  console.log(
    `\n${verdict.streak} clean day(s) in a row${verdict.streakFrom ? ` (from ${verdict.streakFrom})` : ""}; ${verdict.failed.length} day(s) not clean${since ? ` since ${since}` : ""}. ` +
      `The gate needs ${need}: ${verdict.passed ? "MET" : "NOT MET"}.`,
  );
  process.exitCode = verdict.passed ? 0 : 1;
} finally {
  await client.end();
}
