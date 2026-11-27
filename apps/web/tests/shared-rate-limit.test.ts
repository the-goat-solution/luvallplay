// Limits and daily caps that hold across server instances (encryption plan
// Task 8, Review Focus 7), on a real Postgres.
//
// - Every write (non-GET) endpoint of the players' app API counts in the
//   shared store: twelve requests at once across two instances against a
//   limit of ten let exactly ten through. A GET counts on its own instance
//   unless its endpoint says `shared`.
// - "Shared" follows RATE_LIMIT_STORE, as before: without the switch nothing
//   here touches the database and every endpoint counts as it always did.
// - `failClosed`: when the store can't answer, the endpoint answers
//   503 rate_limit_unavailable instead of counting on its own instance.
//   Without it, today's fallback stays.
// - withPlayerLock(): "count, then insert" under a cap, twelve at once across
//   two instances, leaves exactly the cap. It never says "done" for work
//   that wasn't committed, refuses to be nested, and gives up on a lock it
//   has waited too long for instead of hanging.
//
// Needs Postgres (DATA_GUARD_TEST_URL's server). CI sets
// DATA_GUARD_REQUIRE_DB=1, so it can't be skipped silently.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { ENDPOINTS, type Endpoint, type EndpointId } from "@luvallplay/api/contract";
import { contractBreaks, currentSnapshot, type ContractSnapshot } from "../../../packages/api/src/snapshot.ts";
import { migrate } from "../scripts/db/migrate.mjs";
import { rateLimit } from "../lib/security.ts";
import { withPlayerLock } from "../lib/player-lock.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `shared_rate_limit_${process.pid}`;

// A write with a limit of 10 a minute, and a read, both for a signed-in person.
const WRITE = "account.adminHandoff" satisfies EndpointId;
const READ = "account.push" satisfies EndpointId;

test("the limit options are additive: the contract old apps were built against is unchanged", () => {
  const committed = JSON.parse(readFileSync(new URL("../../../packages/api/contract.snapshot.json", import.meta.url), "utf8")) as ContractSnapshot;
  assert.deepEqual(contractBreaks(committed, currentSnapshot()), []);
  assert.deepEqual(currentSnapshot(), committed);
  // An endpoint may say them; none has to.
  const limits: Endpoint["rateLimit"][] = [{ limit: 1, windowMs: 1 }, { limit: 1, windowMs: 1, shared: true, failClosed: true }];
  assert.equal(limits.length, 2);
  // Nothing built so far asks for either, so nothing built so far changes its answer to a store error.
  for (const [id, e] of Object.entries(ENDPOINTS as Record<string, Endpoint>)) {
    assert.equal(e.rateLimit.failClosed, undefined, `${id} failClosed`);
    assert.equal(e.rateLimit.shared, undefined, `${id} shared`);
  }
});

describe("withPlayerLock: what it is given, and what it does with the connection", () => {
  type Call = string;
  /** `failOn`: statements that throw. `answers`: what the server says a statement did, when not the statement's own first word. */
  const fakePool = (failOn: Record<string, Error> = {}, answers: Record<string, string> = {}) => {
    const calls: Call[] = [];
    const released: unknown[][] = [];
    const client = {
      query: async (text: string, params?: unknown[]) => {
        calls.push(params ? `${text} ${JSON.stringify(params)}` : text);
        const key = Object.keys(failOn).find((k) => text.startsWith(k));
        if (key) throw failOn[key];
        const said = Object.keys(answers).find((k) => text.startsWith(k));
        return { rows: [] as Record<string, unknown>[], command: said ? answers[said] : text.split(" ")[0] };
      },
      release: (...args: unknown[]) => void released.push(args),
    };
    let connects = 0;
    return { pool: { connect: async () => (connects++, client) }, calls, released, connects: () => connects };
  };

  test("begin, the lock for this scope and player, the work, commit, release", async () => {
    const f = fakePool();
    const out = await withPlayerLock(f.pool, 42, "social.posts", async (tx) => {
      await tx.query("SELECT 1");
      return "done";
    });
    assert.equal(out, "done");
    assert.deepEqual(f.calls, ["BEGIN", "SET LOCAL lock_timeout = '5000ms'", `SELECT pg_advisory_xact_lock(hashtext($1), $2::int4) ["social.posts",42]`, "SELECT 1", "COMMIT"]);
    assert.deepEqual(f.released, [[]]);
  });

  test("the work throws: rolled back, the same error comes out, the connection goes back to the pool", async () => {
    const f = fakePool();
    const boom = new Error("cap reached");
    await assert.rejects(withPlayerLock(f.pool, 42, "social.posts", async () => { throw boom; }), (e) => e === boom);
    assert.deepEqual(f.calls.slice(-1), ["ROLLBACK"]);
    assert.ok(!f.calls.includes("COMMIT"));
    assert.deepEqual(f.released, [[]]);
  });

  test("BEGIN fails and so does the rollback (the connection broke): released once, with the error, so the pool drops it", async () => {
    const begin = new Error("Connection terminated unexpectedly");
    const rollback = new Error("Client has encountered a connection error and is not queryable");
    const f = fakePool({ BEGIN: begin, ROLLBACK: rollback });
    let ran = false;
    await assert.rejects(withPlayerLock(f.pool, 42, "social.posts", async () => { ran = true; }), (e) => e === begin);
    assert.equal(ran, false);
    assert.deepEqual(f.released, [[rollback]]);
  });

  test("the commit fails: the error comes out, a rollback is tried, released once", async () => {
    const commit = new Error("could not serialize");
    const f = fakePool({ COMMIT: commit });
    await assert.rejects(withPlayerLock(f.pool, 42, "social.posts", async () => "x"), (e) => e === commit);
    assert.deepEqual(f.calls.slice(-2), ["COMMIT", "ROLLBACK"]);
    assert.deepEqual(f.released, [[]]);
  });

  test("the server answers COMMIT with ROLLBACK (a statement failed and the work carried on): an error, never the work's answer", async () => {
    const f = fakePool({}, { COMMIT: "ROLLBACK" });
    await assert.rejects(withPlayerLock(f.pool, 42, "social.posts", async () => "saved"), /withPlayerLock: nothing was saved/);
    assert.ok(f.calls.includes("COMMIT"));
    assert.deepEqual(f.released, [[]]);
    // A driver that doesn't say what the COMMIT did can't be taken at its word either.
    const mute = fakePool();
    const plain = { connect: async () => ({ query: async (text: string, params?: unknown[]) => ({ rows: (await (await mute.pool.connect()).query(text, params)).rows }), release: () => {} }) };
    await assert.rejects(withPlayerLock(plain, 42, "social.posts", async () => "saved"), /nothing was saved/);
  });

  test("a lock inside a lock is refused at once, before a second connection is taken", async () => {
    const f = fakePool();
    let innerRan = false;
    await assert.rejects(
      withPlayerLock(f.pool, 42, "social.posts", async () => withPlayerLock(f.pool, 42, "marketplace.listings", async () => (innerRan = true))),
      /withPlayerLock: locks must not be nested/,
    );
    assert.equal(innerRan, false);
    assert.equal(f.connects(), 1);
    assert.deepEqual(f.calls.slice(-1), ["ROLLBACK"]);
    assert.deepEqual(f.released, [[]]);
    // One after the other is not nesting, and nor are two side by side.
    assert.equal(await withPlayerLock(f.pool, 42, "marketplace.listings", async () => "after"), "after");
    assert.deepEqual(await Promise.all([withPlayerLock(f.pool, 42, "social.posts", async () => 1), withPlayerLock(f.pool, 43, "social.posts", async () => 2)]), [1, 2]);
  });

  test("the wait for a lock is bounded: 5 seconds unless the caller says, and only a sensible number of milliseconds is taken", async () => {
    const f = fakePool();
    await withPlayerLock(f.pool, 42, "social.posts", async () => "x", { lockTimeoutMs: 250 });
    assert.equal(f.calls[1], "SET LOCAL lock_timeout = '250ms'");
    const never = async () => assert.fail("must not run");
    const before = f.connects();
    for (const ms of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 60_001, "5s" as unknown as number, "1; DROP TABLE players" as unknown as number, null as unknown as number]) {
      await assert.rejects(withPlayerLock(f.pool, 42, "social.posts", never, { lockTimeoutMs: ms }), /lock timeout/, String(ms));
    }
    assert.equal(f.connects(), before);
  });

  test("a player id that isn't a positive whole number fitting the lock's 32 bits, or a scope that isn't a plain name, is refused before a connection is taken", async () => {
    const f = fakePool();
    const never = async () => assert.fail("must not run");
    for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, 2 ** 53, "7" as unknown as number, null as unknown as number]) {
      await assert.rejects(withPlayerLock(f.pool, id, "social.posts", never), /player id/, String(id));
    }
    for (const scope of ["", " ", "Social.Posts", "social posts", "posts;--", "a".repeat(65), 7 as unknown as string, undefined as unknown as string]) {
      await assert.rejects(withPlayerLock(f.pool, 42, scope, never), /scope/, String(scope));
    }
    assert.equal(f.connects(), 0);
    // The largest id the lock can take.
    assert.equal(await withPlayerLock(f.pool, 2 ** 31 - 1, "marketplace.listings", async () => "ok"), "ok");
  });
});

describe("limits and caps across two server instances", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  // Two pools stand for two server instances: separate connections, one database.
  let instanceA: pg.Pool;
  let instanceB: pg.Pool;
  let appRoute: typeof import("../lib/app-api.ts").appRoute;
  let fail: typeof import("../lib/app-api.ts").fail;
  const KEYS = ["RATE_LIMIT_STORE", "DATABASE_DRIVER", "POSTGRES_URL", "APP_DATABASE_URL", "TENANT_SCOPE"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const originalWarn = console.warn;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const stored = async () => Number((await c.query(`SELECT count(*)::int AS n FROM rate_limits`)).rows[0].n);

  // A signed-in person of their own for each test, so no test meets another's count.
  let people = 0;
  async function someone(): Promise<{ id: number; token: string }> {
    const n = ++people;
    const token = `shared-rate-limit-token-${process.pid}-${n}`;
    const { rows } = await c.query(`INSERT INTO players (email, first_name, last_name) VALUES ($1, 'Rae', 'Limit') RETURNING id`, [`rae${n}@limits.test`]);
    await c.query(`INSERT INTO player_sessions (player_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [rows[0].id, sha(token)]);
    return { id: Number(rows[0].id), token };
  }
  const call = (id: EndpointId, token: string) => {
    const e = ENDPOINTS[id] as Endpoint;
    return new Request(`http://localhost/api/v1/app${e.path}`, { method: e.method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(e.method === "GET" ? {} : { body: "{}" }) });
  };
  /** One server instance's route for an endpoint: the real wrapper; the handler only says it was reached. */
  function instance(id: EndpointId, store?: pg.Pool) {
    let reached = 0;
    const route = appRoute(id, async () => (reached++, fail(418, "reached")), store ? { rateLimitStore: store } : {});
    return { handle: route.handle, reached: () => reached };
  }
  const answers = async (responses: Promise<Response>[]) => Promise.all(responses.map(async (p) => { const r = await p; return `${r.status} ${((await r.json()) as { error: string }).error}`; }));
  /** For one test, what an endpoint declares about its limit. */
  async function declaring<T>(id: EndpointId, extra: Partial<Endpoint["rateLimit"]>, fn: () => Promise<T>): Promise<T> {
    const e = ENDPOINTS[id] as Endpoint;
    const was = e.rateLimit;
    e.rateLimit = { ...was, ...extra };
    try {
      return await fn();
    } finally {
      e.rateLimit = was;
    }
  }
  /** While `fn` runs, the store can't answer (its table is out of reach), as on a database that is down for it. */
  async function storeDown<T>(fn: () => Promise<T>): Promise<T> {
    await c.query(`ALTER TABLE rate_limits RENAME TO rate_limits_away`);
    console.warn = () => {};
    try {
      return await fn();
    } finally {
      console.warn = originalWarn;
      await c.query(`ALTER TABLE rate_limits_away RENAME TO rate_limits`);
    }
  }

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.end();
    c = new pg.Client({ connectionString: urlFor(NAME) });
    await c.connect();
    await migrate(c, { log: () => {} });
    await c.query(`CREATE TABLE cap_test_posts (id serial PRIMARY KEY, player_id integer NOT NULL, scope text NOT NULL)`);
    // Six connections each: twelve transactions can be open at the same moment.
    instanceA = new pg.Pool({ connectionString: urlFor(NAME), max: 6 });
    instanceB = new pg.Pool({ connectionString: urlFor(NAME), max: 6 });
    for (const pool of [instanceA, instanceB]) {
      const warm = await Promise.all(Array.from({ length: 6 }, () => pool.connect()));
      for (const w of warm) w.release();
    }
    process.env.RATE_LIMIT_STORE = "database";
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    delete process.env.APP_DATABASE_URL;
    delete process.env.TENANT_SCOPE;
    ({ appRoute, fail } = await import("../lib/app-api.ts"));
  });
  after(async () => {
    console.warn = originalWarn;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await instanceA?.end();
    await instanceB?.end();
    await (await import("../lib/database.ts")).closeDatabase();
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  // ── The limit of a write ──────────────────────────────────────────────────

  test("a signed-in write, 12 at once across two instances, limit 10: exactly 10 get through (Review Focus 7)", async () => {
    assert.deepEqual({ method: ENDPOINTS[WRITE].method, auth: ENDPOINTS[WRITE].auth, limit: ENDPOINTS[WRITE].rateLimit.limit }, { method: "POST", auth: "session", limit: 10 });
    const me = await someone();
    const a = instance(WRITE, instanceA);
    const b = instance(WRITE, instanceB);
    const got = await answers(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).handle(call(WRITE, me.token))));
    assert.equal(got.filter((x) => x === "418 reached").length, 10, got.join(", "));
    assert.equal(got.filter((x) => x === "429 rate_limited").length, 2, got.join(", "));
    assert.equal(a.reached() + b.reached(), 10);
    // The count is one row in the database, and it says 12.
    assert.deepEqual((await c.query(`SELECT count FROM rate_limits WHERE key_hash = $1`, [sha(`app:${WRITE}:p${me.id}`)])).rows, [{ count: 12 }]);
    // Later, on either instance, and on the route as the app builds it (its own pool): still over.
    assert.deepEqual(await answers([a.handle(call(WRITE, me.token)), b.handle(call(WRITE, me.token)), instance(WRITE).handle(call(WRITE, me.token))]), ["429 rate_limited", "429 rate_limited", "429 rate_limited"]);
    // Someone else has their own count.
    assert.deepEqual(await answers([a.handle(call(WRITE, (await someone()).token))]), ["418 reached"]);
  });

  test("the same through rateLimit() itself: 12 at once on two pools, limit 10, exactly 10", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => rateLimit("shared:twelve", 10, 60_000, i % 2 ? instanceA : instanceB)));
    assert.equal(results.filter((r) => r === true).length, 10);
    assert.equal(results.filter((r) => r === false).length, 2);
    // With failClosed and a store that answers, the answers are the same two.
    const closed = await Promise.all(Array.from({ length: 12 }, (_, i) => rateLimit("shared:twelve:closed", 10, 60_000, i % 2 ? instanceA : instanceB, { failClosed: true })));
    assert.deepEqual([closed.filter((r) => r === true).length, closed.filter((r) => r === false).length], [10, 2]);
  });

  test("a read counts on its own instance, and writes nothing to the database, unless its endpoint says shared", async () => {
    assert.equal(ENDPOINTS[READ].method, "GET");
    const me = await someone();
    const before = await stored();
    const route = instance(READ);
    assert.deepEqual(await answers([route.handle(call(READ, me.token)), route.handle(call(READ, me.token))]), ["418 reached", "418 reached"]);
    assert.equal(await stored(), before);

    await declaring(READ, { shared: true, limit: 10 }, async () => {
      const a = instance(READ, instanceA);
      const b = instance(READ, instanceB);
      const you = await someone();
      const got = await answers(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).handle(call(READ, you.token))));
      assert.equal(got.filter((x) => x === "418 reached").length, 10, got.join(", "));
      assert.deepEqual((await c.query(`SELECT count FROM rate_limits WHERE key_hash = $1`, [sha(`app:${READ}:p${you.id}`)])).rows, [{ count: 12 }]);
    });
  });

  // ── Without the switch ────────────────────────────────────────────────────

  test("without RATE_LIMIT_STORE=database nothing changes: a write counts on this instance and the database isn't asked", async () => {
    const before = await stored();
    delete process.env.RATE_LIMIT_STORE;
    try {
      const me = await someone();
      const route = instance(WRITE);
      const got = await answers(Array.from({ length: 12 }, () => route.handle(call(WRITE, me.token))));
      assert.deepEqual([got.filter((x) => x === "418 reached").length, got.filter((x) => x === "429 rate_limited").length], [10, 2]);
      // failClosed has no store to fail on: the limit is still counted here, and nobody is turned away with a 503.
      await declaring(WRITE, { failClosed: true }, async () =>
        storeDown(async () => {
          const you = await someone();
          const closed = await answers(Array.from({ length: 12 }, () => route.handle(call(WRITE, you.token))));
          assert.deepEqual([closed.filter((x) => x === "418 reached").length, closed.filter((x) => x === "429 rate_limited").length], [10, 2]);
        }),
      );
    } finally {
      process.env.RATE_LIMIT_STORE = "database";
    }
    assert.equal(await stored(), before);
  });

  // ── When the store can't answer ───────────────────────────────────────────

  test("rateLimit(): a store error with failClosed is \"unavailable\"; without it, this instance counts (as before)", async () => {
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    const broken = { query: async () => { throw new Error("connection refused (shared-rate-limit test)"); } };
    try {
      const open = [];
      for (let i = 0; i < 5; i++) open.push(await rateLimit("shared:broken:open", 3, 60_000, broken));
      assert.deepEqual(open, [true, true, true, false, false]);
      assert.deepEqual(await rateLimit("shared:broken:open2", 3, 60_000, broken, {}), true);
      assert.deepEqual(await rateLimit("shared:broken:open3", 3, 60_000, broken, { failClosed: false }), true);

      const closed = [];
      for (let i = 0; i < 5; i++) closed.push(await rateLimit("shared:broken:closed", 3, 60_000, broken, { failClosed: true }));
      assert.deepEqual(closed, ["unavailable", "unavailable", "unavailable", "unavailable", "unavailable"]);
      // And it did not count on this instance on the way: the instance's own count for that key is untouched.
      const { checkRateLimit } = await import("../lib/security.ts");
      assert.deepEqual([checkRateLimit("shared:broken:closed", 1, 60_000), checkRateLimit("shared:broken:closed", 1, 60_000)], [true, false]);
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(warnings.length >= 1 && warnings.length <= 2, `said once per kind, not on every request (${warnings.length})`);
    for (const w of warnings) assert.doesNotMatch(String(w[0]), /shared:broken/, "the key (an address or a person) isn't logged");
  });

  test("a write whose endpoint says failClosed answers 503 rate_limit_unavailable while the store is down, and the handler isn't reached", async () => {
    const me = await someone();
    await declaring(WRITE, { failClosed: true }, async () => {
      const route = instance(WRITE);
      const down = await storeDown(() => answers(Array.from({ length: 3 }, () => route.handle(call(WRITE, me.token)))));
      assert.deepEqual(down, ["503 rate_limit_unavailable", "503 rate_limit_unavailable", "503 rate_limit_unavailable"]);
      assert.equal(route.reached(), 0);
      // The store is back: served again, and the three refused requests used none of the ten.
      const got = await answers(Array.from({ length: 12 }, () => route.handle(call(WRITE, me.token))));
      assert.deepEqual([got.filter((x) => x === "418 reached").length, got.filter((x) => x === "429 rate_limited").length], [10, 2]);
    });
  });

  test("a write that doesn't say failClosed keeps being served while the store is down, counted on this instance (as before)", async () => {
    const me = await someone();
    const route = instance(WRITE);
    const got = await storeDown(() => answers(Array.from({ length: 12 }, () => route.handle(call(WRITE, me.token)))));
    assert.deepEqual([got.filter((x) => x === "418 reached").length, got.filter((x) => x === "429 rate_limited").length], [10, 2]);
    assert.ok(!got.some((x) => x.startsWith("503")), got.join(", "));
  });

  test("rateLimit(): a store that answers with no row is \"unavailable\" with failClosed; without it, refused (as before)", async () => {
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    const empty = { query: async () => ({ rows: [] as Record<string, unknown>[] }) };
    try {
      assert.deepEqual([await rateLimit("shared:empty:open", 3, 60_000, empty), await rateLimit("shared:empty:open", 3, 60_000, empty, {}), await rateLimit("shared:empty:open", 3, 60_000, empty, { failClosed: false })], [false, false, false]);
      assert.equal(await rateLimit("shared:empty:closed", 3, 60_000, empty, { failClosed: true }), "unavailable");
      // Neither counted on this instance on the way.
      const { checkRateLimit } = await import("../lib/security.ts");
      assert.deepEqual([checkRateLimit("shared:empty:open", 1, 60_000), checkRateLimit("shared:empty:closed", 1, 60_000)], [true, true]);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(warnings.length, 1, "the refusal with failClosed is said, once");
    for (const w of warnings) assert.doesNotMatch(String(w[0]), /shared:empty/);
  });

  // ── The per-player lock ───────────────────────────────────────────────────

  /** "Count, then insert" under a cap of 10, with a pause between the two so every request has counted before any has inserted. */
  const countThenInsert = (playerId: number, scope: string) => async (tx: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }) => {
    const { rows } = await tx.query(`SELECT count(*)::int AS n FROM cap_test_posts WHERE player_id = $1 AND scope = $2`, [playerId, scope]);
    await tx.query(`SELECT pg_sleep(0.05)`);
    if (Number(rows[0].n) >= 10) return false;
    await tx.query(`INSERT INTO cap_test_posts (player_id, scope) VALUES ($1, $2)`, [playerId, scope]);
    return true;
  };
  const rowsFor = async (playerId: number, scope: string) => Number((await c.query(`SELECT count(*)::int AS n FROM cap_test_posts WHERE player_id = $1 AND scope = $2`, [playerId, scope])).rows[0].n);

  test("without the lock, 12 at once against a cap of 10 all get in (what the lock is for)", async () => {
    const work = countThenInsert(501, "control");
    const results = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      const client = await (i % 2 ? instanceA : instanceB).connect();
      try {
        await client.query("BEGIN");
        const done = await work(client);
        await client.query("COMMIT");
        return done;
      } finally {
        client.release();
      }
    }));
    assert.equal(results.filter(Boolean).length, 12);
    assert.equal(await rowsFor(501, "control"), 12);
  });

  test("withPlayerLock: 12 at once across two instances against a cap of 10 leave exactly 10 rows", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => withPlayerLock(i % 2 ? instanceA : instanceB, 502, "test.posts", countThenInsert(502, "test.posts"))));
    assert.equal(results.filter(Boolean).length, 10);
    assert.equal(results.filter((r) => r === false).length, 2);
    assert.equal(await rowsFor(502, "test.posts"), 10);
    // Every connection went back: both pools are whole and idle.
    for (const pool of [instanceA, instanceB]) assert.deepEqual([pool.totalCount, pool.idleCount, pool.waitingCount], [6, 6, 0]);
  });

  test("the lock is this player's, for this scope: another player, or another cap of the same player, doesn't wait", async () => {
    const holder = await instanceA.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT pg_advisory_xact_lock(hashtext($1), $2::int4)`, ["test.posts", 503]);
      assert.equal(await withPlayerLock(instanceB, 504, "test.posts", async () => "other player"), "other player");
      assert.equal(await withPlayerLock(instanceB, 503, "test.listings", async () => "other cap"), "other cap");
      // The same player and scope waits until the holder is done.
      let entered = false;
      const waiting = withPlayerLock(instanceB, 503, "test.posts", async () => (entered = true));
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(entered, false);
      await holder.query("COMMIT");
      assert.equal(await waiting, true);
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
    }
  });

  test("the work throws: nothing it wrote stays, the lock is let go and the connection is usable again", async () => {
    await assert.rejects(
      withPlayerLock(instanceA, 505, "test.posts", async (tx) => {
        await tx.query(`INSERT INTO cap_test_posts (player_id, scope) VALUES (505, 'test.posts')`);
        throw new Error("changed my mind");
      }),
      /changed my mind/,
    );
    assert.equal(await rowsFor(505, "test.posts"), 0);
    assert.equal(await withPlayerLock(instanceB, 505, "test.posts", countThenInsert(505, "test.posts")), true);
    assert.equal(await rowsFor(505, "test.posts"), 1);
    assert.deepEqual([instanceA.idleCount, instanceA.waitingCount], [instanceA.totalCount, 0]);
  });

  /** Connections of this test's database left with a transaction open and nobody working in it. */
  const idleInTransaction = async () => Number((await c.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND state LIKE 'idle in transaction%'`, [NAME])).rows[0].n);
  const poolsWhole = () => {
    for (const pool of [instanceA, instanceB]) assert.deepEqual([pool.idleCount, pool.waitingCount], [pool.totalCount, 0]);
  };
  /** A test that must not hang: it fails if `p` hasn't settled in `ms`. */
  const within = <T>(ms: number, p: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout;
    return Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms)))]).finally(() => clearTimeout(timer));
  };

  test("the work swallows a failed statement and returns: withPlayerLock throws, and nothing it wrote is kept", { timeout: 20_000 }, async () => {
    await assert.rejects(
      within(5_000, withPlayerLock(instanceA, 506, "test.posts", async (tx) => {
        await tx.query(`INSERT INTO cap_test_posts (player_id, scope) VALUES (506, 'test.posts')`);
        // Fails, and aborts the transaction; the work carries on as if it hadn't.
        await tx.query(`INSERT INTO cap_test_posts (player_id, scope) VALUES (506, NULL)`).catch(() => {});
        return "saved";
      })),
      /withPlayerLock: nothing was saved/,
    );
    assert.equal(await rowsFor(506, "test.posts"), 0);
    poolsWhole();
    assert.equal(await idleInTransaction(), 0);
    // The connection and the lock are fine for the next request.
    assert.equal(await within(5_000, withPlayerLock(instanceA, 506, "test.posts", countThenInsert(506, "test.posts"))), true);
    assert.equal(await rowsFor(506, "test.posts"), 1);
  });

  test("a lock inside a lock (same cap, or another cap of the same player) throws at once; both connections go back and nothing is written", { timeout: 20_000 }, async () => {
    for (const [outer, inner] of [["test.posts", "test.posts"], ["test.posts", "test.listings"], ["test.listings", "test.posts"]] as const) {
      const started = Date.now();
      let innerRan = false;
      await assert.rejects(
        within(3_000, withPlayerLock(instanceA, 507, outer, async (tx) => {
          await tx.query(`INSERT INTO cap_test_posts (player_id, scope) VALUES (507, $1)`, [outer]);
          return withPlayerLock(instanceB, 507, inner, async () => (innerRan = true));
        })),
        /withPlayerLock: locks must not be nested/,
        `${outer} then ${inner}`,
      );
      assert.equal(innerRan, false);
      assert.ok(Date.now() - started < 1_000, `at once, not after a wait (${Date.now() - started} ms)`);
      poolsWhole();
    }
    assert.equal(await rowsFor(507, "test.posts") + await rowsFor(507, "test.listings"), 0);
    assert.equal(await idleInTransaction(), 0);
    // The two orders at the same moment (a then b, b then a): the deadlock Postgres couldn't see. Both refused, neither hangs.
    const crossed = await within(3_000, Promise.allSettled([
      withPlayerLock(instanceA, 507, "test.posts", async () => withPlayerLock(instanceB, 507, "test.listings", async () => "in")),
      withPlayerLock(instanceB, 507, "test.listings", async () => withPlayerLock(instanceA, 507, "test.posts", async () => "in")),
    ]));
    assert.deepEqual(crossed.map((r) => (r.status === "rejected" ? /nested/.test(String(r.reason)) : r.value)), [true, true]);
    poolsWhole();
    assert.equal(await idleInTransaction(), 0);
  });

  test("a caller that waits for the lock past the timeout gets an error, its work never runs, and no connection is left in a transaction", { timeout: 20_000 }, async () => {
    const holder = await instanceA.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT pg_advisory_xact_lock(hashtext($1), $2::int4)`, ["test.posts", 508]);
      let entered = false;
      const started = Date.now();
      await assert.rejects(
        within(5_000, withPlayerLock(instanceB, 508, "test.posts", async () => (entered = true), { lockTimeoutMs: 200 })),
        (e: Error & { cause?: { code?: string } }) => /withPlayerLock: gave up after 200 ms waiting for this player's "test\.posts" lock/.test(e.message) && e.cause?.code === "55P03",
      );
      assert.equal(entered, false);
      assert.ok(Date.now() - started >= 180 && Date.now() - started < 3_000, `${Date.now() - started} ms`);
      // The waiter's connection is back in its pool, with no transaction open; only the holder's is.
      assert.deepEqual([instanceB.idleCount, instanceB.waitingCount], [instanceB.totalCount, 0]);
      assert.equal(await idleInTransaction(), 1);
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
    }
    assert.equal(await idleInTransaction(), 0);
    poolsWhole();
    // Free again: the next request gets the lock.
    assert.equal(await within(5_000, withPlayerLock(instanceB, 508, "test.posts", async () => "got it", { lockTimeoutMs: 200 })), "got it");
  });

  test("the timeout is the transaction's own: 5 s inside the work (its statements' waits on row locks too), nothing left on the pooled connection", { timeout: 20_000 }, async () => {
    const one = new pg.Pool({ connectionString: urlFor(NAME), max: 1 });
    try {
      const show = async (tx: { query: (text: string) => Promise<{ rows: Record<string, unknown>[] }> }) => String((await tx.query("SHOW lock_timeout")).rows[0].lock_timeout);
      assert.equal(await withPlayerLock(one, 509, "test.posts", show), "5s");
      assert.equal(await withPlayerLock(one, 509, "test.posts", show, { lockTimeoutMs: 1_500 }), "1500ms");
      assert.equal(await show(one), "0");
      // A statement of the work that waits on a row someone else holds is bounded by it too, and its own error comes out.
      await c.query(`INSERT INTO cap_test_posts (player_id, scope) VALUES (509, 'held')`);
      const holder = await instanceA.connect();
      try {
        await holder.query("BEGIN");
        await holder.query(`SELECT 1 FROM cap_test_posts WHERE player_id = 509 FOR UPDATE`);
        await assert.rejects(
          within(5_000, withPlayerLock(one, 509, "test.posts", async (tx) => tx.query(`UPDATE cap_test_posts SET scope = 'mine' WHERE player_id = 509`), { lockTimeoutMs: 200 })),
          (e: Error & { code?: string }) => e.code === "55P03" && !/withPlayerLock/.test(e.message),
        );
      } finally {
        await holder.query("ROLLBACK").catch(() => {});
        holder.release();
      }
      assert.equal(await rowsFor(509, "held"), 1);
      assert.deepEqual([one.idleCount, one.waitingCount], [one.totalCount, 0]);
      assert.equal(await idleInTransaction(), 0);
    } finally {
      await one.end();
    }
  });
});

if (!BASE_URL && REQUIRE_DB) {
  test("the shared rate limit tests are required in CI", () => assert.fail("DATA_GUARD_REQUIRE_DB=1 but DATA_GUARD_TEST_URL is not set"));
}
