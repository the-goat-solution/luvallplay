// The cutover's one-time session handover (phase-4-cutover.md §4.1, gap B2),
// against a real Postgres: the token works once, for 60 seconds, for one
// person; an app token can't open admin and an admin token can't sign in to
// the app; the app session keeps the website session's sign-in time; and the
// website route is off until PLAYER_APP_URL is set.
//
// Needs Postgres (DATA_GUARD_TEST_URL's server). CI sets
// DATA_GUARD_REQUIRE_DB=1, so it can't be skipped silently.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `app_handover_${process.pid}`;
const APP = "https://app.luvallplay.example";

describe("the session handover, website → app", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let handover: typeof import("../lib/app-handover.ts");
  let auth: typeof import("../lib/player-auth.ts");
  let players: typeof import("../lib/player-db.ts");
  let admin: typeof import("../lib/admin-roles.ts");
  let access: typeof import("../lib/admin-access.ts");
  let database: typeof import("../lib/database.ts");
  let appPost: (request: Request) => Promise<Response>;
  let webGet: (request: Request) => Promise<Response>;
  const KEYS = ["DATABASE_DRIVER", "POSTGRES_URL", "PLAYER_APP_URL", "VERCEL_ENV"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  let n = 0;
  async function member() {
    const { player } = await players.ensurePlayerForEmail(`handover${++n}@example.test`, { via: "signup" });
    await c.query(`UPDATE players SET first_name = 'Hana' WHERE id = $1`, [player.id]);
    const webToken = await auth.createPlayerSession(player.id, "website");
    return { id: player.id, webToken };
  }
  // Each request from its own address: the endpoint's rate limit (per address) is not what these tests are about.
  let ip = 0;
  const swap = (token: string) =>
    appPost(new Request(`${APP}/api/v1/app/auth/handover`, { method: "POST", headers: { "content-type": "application/json", origin: APP, "x-forwarded-for": `198.51.100.${++ip % 250}` }, body: JSON.stringify({ token }) }));
  const open = (cookie: string | null, to = "/inbox/12") =>
    webGet(new Request(`https://club.example/app-handover?to=${encodeURIComponent(to)}`, { headers: cookie ? { cookie: `${auth.PLAYER_COOKIE}=${cookie}` } : {} }));
  const tokenOf = (location: string) => new URL(location).hash.match(/t=([^&]+)/)?.[1] ?? "";

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const a = new pg.Client({ connectionString: urlFor("postgres") });
    await a.connect();
    await a.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await a.query(`CREATE DATABASE ${NAME}`);
    await a.end();
    c = new pg.Client({ connectionString: urlFor(NAME) });
    await c.connect();
    await migrate(c, { log: () => {} });
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    delete process.env.VERCEL_ENV;
    process.env.PLAYER_APP_URL = APP;
    database = await import("../lib/database.ts");
    handover = await import("../lib/app-handover.ts");
    auth = await import("../lib/player-auth.ts");
    players = await import("../lib/player-db.ts");
    admin = await import("../lib/admin-roles.ts");
    access = await import("../lib/admin-access.ts");
    ({ POST: appPost } = await import("../app/api/v1/app/auth/handover/route.ts"));
    ({ GET: webGet } = await import("../app/app-handover/route.ts"));
  });
  after(async () => {
    await database?.closeDatabase();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await c?.end();
    const a = new pg.Client({ connectionString: urlFor("postgres") });
    await a.connect();
    await a.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await a.end();
  });

  test("signed in on the website: to the app's /handover with the token after #, no-store, no referrer; the app swaps it once", async () => {
    const m = await member();
    const res = await open(m.webToken);
    assert.equal(res.status, 303);
    const location = res.headers.get("location")!;
    assert.ok(location.startsWith(`${APP}/handover#t=`), location);
    assert.match(location, /&to=%2Finbox%2F12$/);
    assert.equal(new URL(location).search, "", "nothing in the query string, which servers and referrers see");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");

    const first = await swap(tokenOf(location));
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.ok, true);
    const session = await auth.sessionForToken(body.token);
    assert.equal(session?.player.id, m.id);
    assert.equal(body.needsDetails, false);

    const again = await swap(tokenOf(location));
    assert.equal(again.status, 400, "single use");
    const events = (await c.query(`SELECT event FROM player_events WHERE player_id = $1 ORDER BY id`, [m.id])).rows.map((r) => r.event);
    assert.deepEqual(events.filter((e) => e.startsWith("app_handover")), ["app_handover_made", "app_handover_used"]);
  });

  test("the app session keeps the website session's sign-in time: a handover is never a fresh sign-in", async () => {
    const m = await member();
    const signedIn = "2026-11-01T08:00:00.000Z";
    await c.query(`UPDATE player_sessions SET created_at = $2 WHERE token_hash = $1`, [auth.sha256(m.webToken), signedIn]);
    const body = await (await swap(tokenOf((await open(m.webToken)).headers.get("location")!))).json();
    const session = await auth.sessionForToken(body.token);
    assert.equal(session?.signedInAt.toISOString(), signedIn);
    assert.equal(admin.isStepUpFresh(session!.signedInAt), false);
  });

  test("60 seconds: an expired token is refused", async () => {
    const m = await member();
    const token = tokenOf((await open(m.webToken)).headers.get("location")!);
    await c.query(`UPDATE admin_handoffs SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1`, [handover.appHandoverHash(token)]);
    assert.equal((await swap(token)).status, 400);
  });

  test("ten swaps of one token at the same moment: one session", async () => {
    const m = await member();
    const token = tokenOf((await open(m.webToken)).headers.get("location")!);
    const results = await Promise.all(Array.from({ length: 10 }, () => swap(token)));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
  });

  test("the two kinds can't be swapped: an app token can't open admin, an admin token can't sign in to the app", async () => {
    const m = await member();
    const appToken = tokenOf((await open(m.webToken)).headers.get("location")!);
    assert.equal(await admin.consumeHandoff(access.db, appToken), null, "the app token as itself");
    assert.equal(await admin.consumeHandoff(access.db, `luvallplay/app-handover/v1\n${appToken}`), null, "a string built to hash to the app row");
    assert.equal((await swap(appToken)).status, 200, "and it still works where it belongs");

    const { token: adminToken } = await admin.createHandoff(access.db, m.id);
    assert.equal((await swap(adminToken)).status, 400);
    assert.equal(await admin.consumeHandoff(access.db, adminToken), m.id, "and it still works where it belongs");
  });

  test("not signed in on the website: the app's sign-in, keeping the screen; a lapsed or deleted account the same", async () => {
    const res = await open(null);
    assert.equal(res.headers.get("location"), `${APP}/signin?next=%2Finbox%2F12`);
    assert.equal((await open("not-a-session")).headers.get("location"), `${APP}/signin?next=%2Finbox%2F12`);
    assert.equal((await open(null, "/home")).headers.get("location"), `${APP}/signin`);
    const m = await member();
    const token = tokenOf((await open(m.webToken)).headers.get("location")!);
    await c.query(`UPDATE players SET deleted_at = NOW() WHERE id = $1`, [m.id]);
    assert.equal((await swap(token)).status, 400, "an account deleted after the token was made");
  });

  test("the screen must be a path of the app: anything else opens Home", async () => {
    const m = await member();
    for (const to of ["https://evil.example", "//evil.example", "/\\evil", "/api/v1/app/me", "/signin", "/handover"]) {
      const location = (await open(m.webToken, to)).headers.get("location")!;
      assert.match(location, /&to=%2Fhome$/, to);
    }
  });

  test("a malformed token is refused before the database", async () => {
    for (const bad of ["", "short", "x".repeat(44), "a".repeat(42) + "!"]) {
      const res = await swap(bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
  });

  test("off until PLAYER_APP_URL is set: the website goes to /profile, as today", async () => {
    const m = await member();
    delete process.env.PLAYER_APP_URL;
    try {
      const res = await open(m.webToken);
      assert.equal(new URL(res.headers.get("location")!).pathname, "/profile");
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM player_events WHERE player_id = $1 AND event = 'app_handover_made'`, [m.id])).rows[0].n, 0);
    } finally {
      process.env.PLAYER_APP_URL = APP;
    }
  });
});

describe("the players' app address setting", () => {
  test("https origins only (http for a local address); anything else turns the handover off", async () => {
    const { playerAppUrl } = await import("../lib/app-handover.ts");
    assert.equal(playerAppUrl("https://app.luvallplay.com/"), "https://app.luvallplay.com");
    assert.equal(playerAppUrl("https://app.luvallplay.com/some/path?x=1"), "https://app.luvallplay.com");
    assert.equal(playerAppUrl("http://localhost:5173"), "http://localhost:5173");
    for (const bad of [undefined, "", "app.luvallplay.com", "http://app.luvallplay.com", "javascript:alert(1)", "https://user:pw@app.luvallplay.com"]) assert.equal(playerAppUrl(bad), null, String(bad));
  });
});
