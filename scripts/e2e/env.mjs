// End-to-end test environment: a fresh local Postgres database, the
// WebSocket bridge, the built app (`next start`) with email captured and side
// effects off, then synthetic people and play days (test plan §7: synthetic
// data only). The schema comes from the migrations; roles from the real grant script.
//
//   npm run build && node scripts/e2e/env.mjs        (prints the base URL, keeps running)
//
// Needs a local Postgres (E2E_PG_URL, default postgres://postgres:postgres@localhost:5432).
import { spawn, spawnSync } from "node:child_process";
import pg from "pg";

const PG = process.env.E2E_PG_URL ?? "postgres://postgres:postgres@localhost:5432";
const DB = "tw_e2e";
const PORT = Number(process.env.E2E_PORT ?? 3100);
const WS_PORT = 5480;
export const BASE = `http://localhost:${PORT}`;
const DB_URL = `${PG.replace(/\/$/, "")}/${DB}`;

export const PEOPLE = {
  owner: { email: "olivia.owner@e2e.test", first: "Olivia", last: "Owner" },
  admin: { email: "adam.admin@e2e.test", first: "Adam", last: "Admin" },
  coach: { email: "cora.coach@e2e.test", first: "Cora", last: "Coach" },
  member: { email: "mia.member@e2e.test", first: "Mia", last: "Member" },
  player: { email: "pete.player@e2e.test", first: "Pete", last: "Player" },
  hidden: { email: "hana.hidden@e2e.test", first: "Hana", last: "Hidden" },
  owner2: { email: "otto.owner@e2e.test", first: "Otto", last: "Second" },
};

function nzDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
}
function nextWeekday(day /* 0=Sun */, fromOffset = 0) {
  for (let i = fromOffset; i < fromOffset + 14; i++) {
    const key = nzDate(i);
    if (new Date(`${key}T12:00:00Z`).getUTCDay() === day) return key;
  }
  throw new Error("no weekday");
}

async function recreateDb() {
  const admin = new pg.Client({ connectionString: `${PG.replace(/\/$/, "")}/postgres` });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
}

async function waitFor(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not come up at ${url}`);
}

async function seed() {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  const ids = {};
  for (const [key, p] of Object.entries(PEOPLE)) {
    const { rows } = await c.query(
      `INSERT INTO players (email, first_name, last_name, leaderboard_visible, claimed_at, welcome_card_dismissed_at)
       VALUES ($1, $2, $3, $4, NOW(), CASE WHEN $5 THEN NULL ELSE NOW() END)
       ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name RETURNING id`,
      [p.email, p.first, p.last, key !== "hidden", key === "player"],
    );
    ids[key] = rows[0].id;
  }
  // Play days: the next Friday and Wednesday, plus two weeks on.
  const fri = nextWeekday(5, 1);
  const wed = nextWeekday(3, 1);
  const days = [fri, wed, nextWeekday(5, 8), nextWeekday(3, 8)];
  for (const d of days) {
    const day = new Date(`${d}T12:00:00Z`).getUTCDay();
    const start = day === 5 ? "19:00" : "19:30";
    await c.query(
      `INSERT INTO sessions (date, max_spots, google_event_id, event_start_time, event_end_time, event_location)
       VALUES ($1::date, 16, 'e2e-' || $1::text, ($1::text || ' ' || $2::text || ':00 Pacific/Auckland')::timestamptz, ($1::text || ' ' || $2::text || ':00 Pacific/Auckland')::timestamptz + INTERVAL '2 hours', 'Pioneer Stadium')
       ON CONFLICT (date) DO NOTHING`,
      [d, start],
    );
  }
  // Mia: an active monthly Friday membership running past the next play days.
  await c.query(
    `INSERT INTO memberships (email, plan, first_name, last_name, period_start, period_end, status, day, recurring, stripe_subscription_id)
     VALUES ($1::text, 'monthly', 'Mia', 'Member', $2::date - 7, $2::date + 21, 'active', 'friday', TRUE, 'sub_e2e_mia')`,
    [PEOPLE.member.email, fri],
  );
  // Wolf Points: past attendance this month (counted the day after).
  const past = [nzDate(-1), nzDate(-2), nzDate(-3)].filter((d) => d.slice(0, 7) === nzDate(0).slice(0, 7));
  const pastDays = past.length ? past : [nzDate(0)];
  for (const d of pastDays) {
    for (const who of ["member", "player", "hidden", "owner"]) {
      await c.query(`INSERT INTO attendance (session_date, email, source) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`, [d, PEOPLE[who].email]);
    }
  }
  // The messages tables appear the first time a signed-in player opens their
  // profile: sign Mia in through the real code flow and open it.
  await fetch(`${BASE}/api/auth/email/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: PEOPLE.member.email }) });
  const { mail } = await (await fetch(`${BASE}/api/dev/outbox?to=${encodeURIComponent(PEOPLE.member.email)}`)).json();
  const code = `${mail.at(-1)?.subject} ${mail.at(-1)?.text}`.match(/\b(\d{6})\b/)?.[1];
  const verify = await fetch(`${BASE}/api/auth/email/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: PEOPLE.member.email, code }) });
  const cookie = verify.headers.getSetCookie().find((x) => x.startsWith("tw_player="))?.split(";")[0];
  await fetch(`${BASE}/profile`, { headers: { Cookie: cookie ?? "" } });
  await fetch(`${BASE}/api/dev/outbox`, { method: "DELETE" });
  for (let i = 0; i < 40 && (await c.query(`SELECT to_regclass('messages') AS r`)).rows[0].r === null; i++) {
    await fetch(`${BASE}/profile`, { headers: { Cookie: cookie ?? "" } });
    await new Promise((r) => setTimeout(r, 250));
  }
  // A message from the club to Mia (unread).
  const t = await c.query(
    `INSERT INTO message_threads (player_id, subject, started_by, unread_for_player) VALUES ($1, 'Welcome to Fridays', 'admin', TRUE) RETURNING id`,
    [ids.member],
  );
  await c.query(`INSERT INTO messages (thread_id, sender, body) VALUES ($1, 'admin', 'See you at Pioneer on Friday!')`, [t.rows[0].id]);
  await c.end();
  return { ids, days, threadId: t.rows[0].id };
}

function runNode(args) {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, POSTGRES_URL: DB_URL } });
  if (r.status !== 0) throw new Error(`${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

export async function startEnv({ log = console.log } = {}) {
  await recreateDb();
  // The schema comes from the versioned migrations, as in every new
  // environment (production's shape, docs/schema/production.sql).
  runNode(["scripts/db/migrate.mjs"]);
  const proxy = spawn(process.execPath, ["scripts/e2e/ws-proxy.mjs", String(WS_PORT)], { stdio: "ignore" });
  const env = {
    ...process.env,
    POSTGRES_URL: DB_URL,
    NEON_LOCAL_WS_PROXY: `localhost:${WS_PORT}`,
    RESEND_API_KEY: "re_e2e_captured",
    EMAIL_FROM: "Three Wolves <club@e2e.test>",
    E2E_OUTBOX: "1",
    PLAYER_SESSION_SECRET: "e2e-player-session-secret",
    ADMIN_PASSWORD: "e2e-break-glass",
    NEXT_PUBLIC_SITE_URL: BASE,
    PORT: String(PORT),
  };
  delete env.VERCEL_ENV;
  // Own process group, so stop() ends next-server too (killing only npx left
  // it running and held the test file open until its timeout).
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const serverLog = [];
  server.stdout.on("data", (d) => serverLog.push(String(d)));
  server.stderr.on("data", (d) => serverLog.push(String(d)));
  await waitFor(`${BASE}/login`);
  // The app creates its own tables on first use (ensureTables); warm them up.
  for (const path of ["/", "/login", "/api/health/db", "/casual-play", "/api/arena"]) await fetch(BASE + path).catch(() => {});
  await fetch(`${BASE}/api/auth/email/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "warmup@e2e.test" }) });
  // Messages and stats tables.
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  const have = async (t) => (await c.query(`SELECT to_regclass($1) AS r`, [t])).rows[0].r !== null;
  const missing = [];
  for (const t of ["players", "sessions", "memberships", "attendance", "player_absences"]) if (!(await have(t))) missing.push(t);
  await c.end();
  if (missing.length) throw new Error(`tables missing after warm-up: ${missing.join(", ")}\n` + serverLog.join(""));
  const seeded = await seed();
  // The real grant script (as in production). The Phase 1 roles tables are
  // part of the baseline migration.
  runNode(["scripts/grant-role.mjs", "--role", "owner", "--platform", "--email", PEOPLE.owner.email]);
  runNode(["scripts/grant-role.mjs", "--role", "admin", "--email", PEOPLE.admin.email]);
  runNode(["scripts/grant-role.mjs", "--role", "coach", "--email", PEOPLE.coach.email]);
  log(`e2e: app at ${BASE}, database ${DB}`);
  const stop = () => {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
    proxy.kill("SIGTERM");
  };
  return { base: BASE, dbUrl: DB_URL, seeded, stop, serverLog };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const e = await startEnv();
  console.log(JSON.stringify(e.seeded));
  process.on("SIGINT", () => {
    e.stop();
    process.exit(0);
  });
}
