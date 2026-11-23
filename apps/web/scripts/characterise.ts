// Characterisation check (test plan §4.4, T−4): each account's views of the
// app, before and after a data change, must be identical.
//
//   node --import ./tests/register.mjs scripts/characterise.ts snapshot --out before.json
//   …the change…
//   node --import ./tests/register.mjs scripts/characterise.ts snapshot --out after.json
//   node --import ./tests/register.mjs scripts/characterise.ts diff before.json after.json
//
// For every live account it calls the app's OWN data functions, the ones the
// pages and the API call: the account, the Me page (membership, play days
// left, calendar, quick stats, orders, message threads), Stats, the points
// board and rank, admin access, and "Download my data". Then the club-wide
// boards. Each view is stored as a hash, so the file holds no personal data
// (the same rule as the data guard's snapshots).
//
// Run it on a rehearsal branch, not on production: a few of these functions
// bring derived tables up to date as they read (roster attendance, Arena
// sync). Take the first snapshot twice; the second is the baseline.
//
// POSTGRES_URL chooses the database (a Neon branch). DB_DRIVER=neon-ws sends
// the driver's WebSocket through HTTPS_PROXY, as in the operator scripts;
// set NODE_USE_ENV_PROXY=1 too, so the driver's HTTP queries use the proxy.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { proxyAppDatabaseClient } from "./db-client.mjs";

// The app's modules import next/server for after(); give them a stand-in.
register("../tests/golden/hook.mjs", import.meta.url);

type Views = Record<string, string>;
type Snapshot = { version: 1; takenAt: string; database: string; accounts: Record<string, Views>; club: Views };

function stable(v: unknown): unknown {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Invalid Date" : v.toISOString();
  if (typeof v === "bigint") return `${v}n`;
  if (v instanceof Map) return { "<map>": [...v.entries()].map(([k, x]) => [stable(k), stable(x)]).sort((a, b) => (JSON.stringify(a[0]) < JSON.stringify(b[0]) ? -1 : 1)) };
  if (v instanceof Set) return { "<set>": [...v.values()].map(stable) };
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = stable((v as Record<string, unknown>)[k]);
    return out;
  }
  return typeof v === "function" ? "<function>" : v;
}
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(stable(v)) ?? "undefined").digest("hex").slice(0, 16);

async function snapshot(out: string) {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is not set.");
  const host = new URL(url).hostname;
  const prod = (process.env.PRODUCTION_DATABASE_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (prod.includes(host)) throw new Error(`Refusing to characterise ${host}: it is production. Use a rehearsal branch.`);
  await proxyAppDatabaseClient();

  const database = await import("../lib/database.ts");
  const playerDb = await import("../lib/player-db.ts");
  const self = await import("../lib/membership-self-service.ts");
  const dayRequests = await import("../lib/day-requests.ts");
  const meData = await import("../lib/me-data.ts");
  const stats = await import("../lib/stats-db.ts");
  const arena = await import("../lib/arena-db.ts");
  const shop = await import("../lib/shop-db.ts");
  const messages = await import("../lib/messages-db.ts");
  const exporter = await import("../lib/player-export.ts");
  const periods = await import("../lib/stats-periods.ts");

  const view = async (fn: () => Promise<unknown>) => {
    try {
      return hash(await fn());
    } catch (err) {
      // An error is a view too: it must be the same error before and after.
      return `error:${hash(String((err as Error)?.message ?? err))}`;
    }
  };

  const dates = await import("../lib/dates.ts");
  const today = dates.getClubToday().dateKey;
  const range = periods.periodRange("lifetime", today);
  const month = periods.periodRange("month", today);
  const pausedDays = await dayRequests.getPausedDays();
  const { rows } = await database.sql.query(`SELECT id FROM players WHERE deleted_at IS NULL ORDER BY id`);
  const accounts: Record<string, Views> = {};
  for (const { id } of rows as { id: number }[]) {
    const player = await playerDb.getPlayerById(id);
    if (!player) continue;
    const membership = await self.getCurrentMembership(player.email);
    accounts[String(id)] = {
      account: hash(player),
      membership: hash(membership),
      playDaysLeft: await view(async () => (membership ? self.playDaysLeft(membership) : 0)),
      calendar: await view(() => meData.calendarFor(player.email, membership, pausedDays)),
      quickStats: await view(() => stats.getQuickStats(player)),
      stats: await view(() => stats.getPlayerStats(player)),
      orders: await view(() => shop.listOrdersForPlayer(id)),
      threads: await view(() => messages.listThreadsForPlayer(id)),
      pointsBoard: await view(() => arena.getPointsBoard("all", range, id)),
      pointsBoardMonth: await view(() => arena.getPointsBoard("all", month, id)),
      // Read-only: getAccess would also apply a pending invite.
      access: await view(async () => (await database.sql.query(
        `SELECT (SELECT role FROM club_roles WHERE player_id = $1) AS role, EXISTS (SELECT 1 FROM platform_admins WHERE player_id = $1) AS platform`, [id])).rows[0]),
      // Without the export's own timestamp, which is the time of the run.
      export: await view(async () => ({ ...(await exporter.collectPlayerData(player)), exportedAt: null })),
    };
  }
  const club: Views = {
    leaderboardAttendance: await view(() => stats.getLeaderboard("attendance", range)),
    leaderboardRoundRobin: await view(() => stats.getLeaderboard("rr", month)),
    pointsBoard: await view(() => arena.getPointsBoard("all", range)),
    rankBadges: await view(() => arena.getRankBadges()),
    shopProducts: await view(() => shop.listShopProductsForPlayer()),
    pausedDays: hash(pausedDays),
  };
  const snap: Snapshot = { version: 1, takenAt: new Date().toISOString(), database: host, accounts, club };
  writeFileSync(out, JSON.stringify(snap, null, 1));
  console.log(`Characterised ${Object.keys(accounts).length} live accounts (${Object.keys(Object.values(accounts)[0] ?? {}).length} views each) and ${Object.keys(club).length} club views on ${host} → ${out}`);
  await database.closeDatabase();
}

function diff(aFile: string, bFile: string) {
  const a = JSON.parse(readFileSync(aFile, "utf8")) as Snapshot;
  const b = JSON.parse(readFileSync(bFile, "utf8")) as Snapshot;
  const problems: string[] = [];
  const compare = (who: string, x: Views = {}, y: Views = {}) => {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[k] !== y[k]) problems.push(`${who}: ${k} differs`);
  };
  for (const id of new Set([...Object.keys(a.accounts), ...Object.keys(b.accounts)])) {
    if (!a.accounts[id]) problems.push(`account ${id}: only in the second snapshot`);
    else if (!b.accounts[id]) problems.push(`account ${id}: missing from the second snapshot`);
    else compare(`account ${id}`, a.accounts[id], b.accounts[id]);
  }
  compare("club", a.club, b.club);
  const n = Object.keys(a.accounts).length;
  if (problems.length) {
    console.error(`Characterisation: ${problems.length} difference(s) across ${n} accounts:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nRESULT: ✖ failed.`);
    process.exit(1);
  }
  console.log(`Characterisation: ${n} accounts, ${Object.keys(Object.values(a.accounts)[0] ?? {}).length} views each, ${Object.keys(a.club).length} club views. Identical.\n\nRESULT: ✔ passed.`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "snapshot" && rest[0] === "--out" && rest[1]) await snapshot(rest[1]);
else if (cmd === "diff" && rest[0] && rest[1]) diff(rest[0], rest[1]);
else {
  console.error("Usage: characterise.ts snapshot --out <file> | diff <before> <after>");
  process.exit(2);
}
