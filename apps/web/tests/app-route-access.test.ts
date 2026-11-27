// appRoute's `access` option (Social plan, Task 5; lib/app-api.ts): a check
// that decides whether an endpoint is there at all for this person. On a
// real Postgres, through the real wrapper.
//
// The order is the point. Access is asked after the session check and before
// the rate limiter, the query and the body:
// - with access refused, a body that can't be valid still gets the access
//   answer (404 module_off), the handler isn't reached, and nothing is
//   counted against the person's limit;
// - nobody signed in is still 401, and the check isn't asked;
// - what the check answers when it lets someone in is handed to the handler.
// `status` sets the status of a good answer (201 for something made).
//
// Needs Postgres (DATA_GUARD_TEST_URL's server). CI sets
// DATA_GUARD_REQUIRE_DB=1, so it can't be skipped silently.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { ENDPOINTS, type Endpoint, type EndpointId } from "@luvallplay/api/contract";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `app_route_access_${process.pid}`;

// A signed-in write with a body and a small limit, and a signed-in read.
const WRITE = "account.language" satisfies EndpointId;
const READ = "account.profile" satisfies EndpointId;

describe("appRoute: an access check that runs before parsing and the limiter", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let appRoute: typeof import("../lib/app-api.ts").appRoute;
  let fail: typeof import("../lib/app-api.ts").fail;
  const KEYS = ["RATE_LIMIT_STORE", "DATABASE_DRIVER", "POSTGRES_URL", "APP_DATABASE_URL", "TENANT_SCOPE"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const originalError = console.error;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  let people = 0;
  async function someone(): Promise<{ id: number; token: string }> {
    const n = ++people;
    const token = `app-route-access-token-${process.pid}-${n}`;
    const { rows } = await c.query(`INSERT INTO players (email, first_name, last_name) VALUES ($1, 'Ada', 'Access') RETURNING id`, [`ada${n}@access.test`]);
    await c.query(`INSERT INTO player_sessions (player_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [rows[0].id, sha(token)]);
    return { id: Number(rows[0].id), token };
  }
  const call = (id: EndpointId, token: string | null, body?: string) => {
    const e = ENDPOINTS[id] as Endpoint;
    return new Request(`http://localhost/api/v1/app${e.path}`, {
      method: e.method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
      ...(e.method === "GET" ? {} : { body: body ?? "{}" }),
    });
  };
  const said = async (r: Response) => `${r.status} ${JSON.stringify(await r.json())}`;
  const counted = async (id: EndpointId, playerId: number) => (await c.query(`SELECT count FROM rate_limits WHERE key_hash = $1`, [sha(`app:${id}:p${playerId}`)])).rows.map((r) => Number(r.count));

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
    // The shared store, so "nothing was counted" can be read from the table.
    process.env.RATE_LIMIT_STORE = "database";
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    delete process.env.APP_DATABASE_URL;
    delete process.env.TENANT_SCOPE;
    ({ appRoute, fail } = await import("../lib/app-api.ts"));
  });
  after(async () => {
    console.error = originalError;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await (await import("../lib/database.ts")).closeDatabase();
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("access refused: a bad body still gets the access answer, the handler isn't reached, and the limiter counts nothing", async () => {
    const me = await someone();
    const limit = (ENDPOINTS[WRITE] as Endpoint).rateLimit.limit;
    let reached = 0;
    let asked = 0;
    const route = appRoute(WRITE, async () => (reached++, fail(418, "reached")), { access: async () => (asked++, fail(404, "module_off")) });
    for (const body of ["{", '"not a body"', "[]", '{"lang":5}', "{}"]) {
      assert.equal(await said(await route.handle(call(WRITE, me.token, body))), '404 {"error":"module_off"}', body);
    }
    // Far past the endpoint's limit: never a 429, because nothing is counted.
    for (let i = 0; i < limit + 3; i++) assert.equal((await route.handle(call(WRITE, me.token, "{"))).status, 404);
    assert.equal(reached, 0);
    assert.equal(asked, 5 + limit + 3);
    assert.deepEqual(await counted(WRITE, me.id), []);
    // The same route without the check, for the same person: the body is looked at, and the request is counted.
    const open = appRoute(WRITE, async () => fail(418, "reached"));
    assert.equal(await said(await open.handle(call(WRITE, me.token, "{"))), '400 {"error":"bad_request"}');
    assert.deepEqual(await counted(WRITE, me.id), [1]);
  });

  test("access refused on a read: the query isn't looked at either, and the read isn't counted on this instance", async () => {
    const me = await someone();
    const limit = (ENDPOINTS[READ] as Endpoint).rateLimit.limit;
    const route = appRoute(READ, async () => fail(418, "reached"), { access: async () => fail(404, "module_off") });
    for (let i = 0; i < limit + 3; i++) assert.equal(await said(await route.handle(call(READ, me.token))), '404 {"error":"module_off"}');
    // The limit is untouched: the same person still gets through on the open route.
    assert.equal((await appRoute(READ, async () => fail(418, "reached")).handle(call(READ, me.token))).status, 418);
  });

  test("the session comes first: nobody signed in is 401 and the check isn't asked", async () => {
    let asked = 0;
    const route = appRoute(WRITE, async () => fail(418, "reached"), { access: async () => (asked++, fail(404, "module_off")) });
    assert.equal(await said(await route.handle(call(WRITE, null, "{"))), '401 {"error":"unauthorized"}');
    assert.equal(await said(await route.handle(call(WRITE, "made-up-token", "{"))), '401 {"error":"unauthorized"}');
    assert.equal(asked, 0);
  });

  test("access given: the check is told who is asking, its answer reaches the handler, and the limiter and the body checks run as ever", async () => {
    const me = await someone();
    const seen: unknown[] = [];
    const route = appRoute(
      WRITE,
      async ({ access, player }) => (seen.push([access, player.id]), fail(418, "reached")),
      { access: async ({ player, session, request }) => ({ clubs: [7], who: player.id, via: session.via, method: request.method }) },
    );
    assert.equal(await said(await route.handle(call(WRITE, me.token, "{"))), '400 {"error":"bad_request"}');
    assert.deepEqual(seen, []);
    assert.equal(await said(await route.handle(call(WRITE, me.token, '{"lang":"vi"}'))), '418 {"error":"reached"}');
    assert.deepEqual(seen, [[{ clubs: [7], who: me.id, via: "bearer", method: "POST" }, me.id]]);
    assert.deepEqual(await counted(WRITE, me.id), [2]);
    // A route without the option gets no `access`.
    let plain: unknown = "unset";
    await appRoute(WRITE, async (ctx) => ((plain = (ctx as { access?: unknown }).access), fail(418, "reached"))).handle(call(WRITE, me.token, '{"lang":"vi"}'));
    assert.equal(plain, undefined);
  });

  test("a check that throws is a 500, not a way in; one that throws a contract error answers with it", async () => {
    const me = await someone();
    let reached = 0;
    console.error = () => {};
    try {
      const broken = appRoute(WRITE, async () => (reached++, fail(418, "reached")), { access: async () => { throw new Error("database is away"); } });
      assert.equal(await said(await broken.handle(call(WRITE, me.token, '{"lang":"vi"}'))), '500 {"error":"failed"}');
    } finally {
      console.error = originalError;
    }
    const thrown = appRoute(WRITE, async () => (reached++, fail(418, "reached")), { access: async () => { throw fail(403, "suspended"); } });
    assert.equal(await said(await thrown.handle(call(WRITE, me.token, '{"lang":"vi"}'))), '403 {"error":"suspended"}');
    assert.equal(reached, 0);
    assert.deepEqual(await counted(WRITE, me.id), []);
  });

  test("`status` is the status of a good answer; errors keep their own", async () => {
    const me = await someone();
    const made = appRoute(WRITE, async () => ({ ok: true as const }), { status: 201 });
    const r = await made.handle(call(WRITE, me.token, '{"lang":"vi"}'));
    assert.equal(await said(r), '201 {"ok":true}');
    assert.equal(await said(await made.handle(call(WRITE, me.token, "{"))), '400 {"error":"bad_request"}');
    assert.equal((await appRoute(WRITE, async () => ({ ok: true as const })).handle(call(WRITE, me.token, '{"lang":"vi"}'))).status, 200);
  });
});
