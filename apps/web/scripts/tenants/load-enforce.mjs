// A load test of TENANT_SCOPE=enforce against the owner's connection
// (audit, Medium: "enforce adds latency"; runbook §11).
//
//   node --import ./tests/register.mjs scripts/tenants/load-enforce.mjs [--rounds 30] [--burst 9]
//
// READ-ONLY, and meant for a rehearsal copy: it refuses a host listed in
// PRODUCTION_DATABASE_HOSTS unless --production is given. It runs through
// the app's own database client (lib/database.ts), so it measures what a
// request would: the pooled connection, and the transaction each scoped
// statement gets.
//
// One "burst" is what the Arena does when it loads: `--burst` reads fired at
// once on the pool (default 9, on a pool of 10). Each mode runs `--rounds`
// bursts after a warm-up; the report is the time for a whole burst (what a
// page waits for) and per statement, as median and 95th percentile.
//
// Exit code 1 when enforce's median burst is more than --max-ratio times
// the owner's (default 3) AND more than --max-extra-ms slower (default 150):
// both, because on a fast local database the ratio alone means nothing.
//
// POSTGRES_URL chooses the database; DB_DRIVER=neon-ws and DATABASE_DRIVER
// work as in the other scripts.
import { proxyAppDatabaseClient } from "../db-client.mjs";

const args = process.argv.slice(2);
const num = (name, fallback) => {
  const at = args.indexOf(name);
  const v = at === -1 ? fallback : Number(args[at + 1]);
  if (!Number.isFinite(v) || v <= 0) {
    console.error(`${name} needs a number above 0.`);
    process.exit(2);
  }
  return v;
};
const rounds = Math.floor(num("--rounds", 30));
const burst = Math.floor(num("--burst", 9));
const maxRatio = num("--max-ratio", 3);
const maxExtraMs = num("--max-extra-ms", 150);

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}
const short = (h) => h.trim().toLowerCase().split(".")[0].replace(/-pooler$/, "");
const production = (process.env.PRODUCTION_DATABASE_HOSTS ?? "").split(",").filter(Boolean).map(short);
if (production.includes(short(new URL(url).hostname)) && !args.includes("--production")) {
  console.error("This is a production database (PRODUCTION_DATABASE_HOSTS). Run the load test on a rehearsal copy.");
  process.exit(2);
}
if (process.env.APP_DATABASE_URL) {
  console.error("APP_DATABASE_URL is set: that login is always scoped, so there is no owner's connection to compare with. Unset it for this test.");
  process.exit(2);
}

await proxyAppDatabaseClient();
const database = await import("../../lib/database.ts");

// Reads shaped like the Arena's: club-owned tables, joins to accounts, ordered.
const READS = [
  `SELECT module_id, enabled FROM tenant_modules ORDER BY module_id`,
  `SELECT date::text AS d, booked_spots, courts FROM sessions ORDER BY date DESC LIMIT 60`,
  `SELECT a.session_date::text AS d, count(*)::int AS n FROM attendance a WHERE a.verified AND NOT a.removed GROUP BY 1 ORDER BY 1 DESC LIMIT 60`,
  `SELECT id, status, day, period_start::text AS s FROM memberships ORDER BY id DESC LIMIT 100`,
  `SELECT id, session_date::text AS d FROM bookings ORDER BY id DESC LIMIT 100`,
  `SELECT user_id, role FROM club_members ORDER BY user_id LIMIT 200`,
  `SELECT key FROM club_settings ORDER BY key`,
  `SELECT count(*)::int AS n FROM admin_audit_log`,
  `SELECT p.id FROM players p JOIN club_members m ON m.user_id = p.id WHERE p.deleted_at IS NULL ORDER BY p.id LIMIT 200`,
];
const reads = Array.from({ length: burst }, (_, i) => READS[i % READS.length]);

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const summary = (ms) => {
  const s = [...ms].sort((a, b) => a - b);
  return { median: quantile(s, 0.5), p95: quantile(s, 0.95), max: s[s.length - 1] };
};
const fmt = (n) => `${n.toFixed(1)} ms`;

async function measure(mode) {
  process.env.TENANT_SCOPE = mode;
  await database.closeDatabase();
  const bursts = [];
  const statements = [];
  let rows = 0;
  for (let round = -3; round < rounds; round++) {
    const started = performance.now();
    const results = await Promise.all(
      reads.map(async (text) => {
        const t = performance.now();
        const r = await database.sql.query(text);
        if (round >= 0) statements.push(performance.now() - t);
        return r.rows.length;
      }),
    );
    if (round >= 0) bursts.push(performance.now() - started); // the first three warm the pool up
    rows = results.reduce((a, b) => a + b, 0);
  }
  return { burst: summary(bursts), statement: summary(statements), rows };
}

try {
  console.log(`${rounds} bursts of ${burst} reads at once, per mode, on ${new URL(url).hostname} (driver: ${database.databaseDriver()}).\n`);
  // The modes alternate, so a slow minute on the network doesn't land on one of them.
  const off1 = await measure("off");
  const enforce1 = await measure("enforce");
  const off2 = await measure("off");
  const enforce2 = await measure("enforce");
  const pick = (a, b) => (a.burst.median <= b.burst.median ? a : b);
  const off = pick(off1, off2);
  const enforce = pick(enforce1, enforce2);
  for (const [name, r] of [["owner (off)", off], ["enforce", enforce]]) {
    console.log(`${name.padEnd(12)} burst: median ${fmt(r.burst.median)}, p95 ${fmt(r.burst.p95)}, max ${fmt(r.burst.max)}   statement: median ${fmt(r.statement.median)}, p95 ${fmt(r.statement.p95)}`);
  }
  if (off.rows !== enforce.rows) {
    // One club in the database: both must read the same rows. (With two clubs, the owner reads more; that is the point of enforce.)
    console.log(`\nNote: the owner read ${off.rows} rows in a burst and enforce ${enforce.rows}. Expected only when the database holds more than one club.`);
  }
  const ratio = enforce.burst.median / off.burst.median;
  const extra = enforce.burst.median - off.burst.median;
  const tooSlow = ratio > maxRatio && extra > maxExtraMs;
  console.log(`\nenforce's median burst is ${ratio.toFixed(2)}× the owner's (${extra >= 0 ? "+" : ""}${fmt(extra)}). Limit: ${maxRatio}× and +${maxExtraMs} ms together. ${tooSlow ? "TOO SLOW" : "OK"}.`);
  process.exitCode = tooSlow ? 1 : 0;
} catch (err) {
  console.error(err?.message ?? err);
  process.exitCode = 1;
} finally {
  await database.closeDatabase();
}
