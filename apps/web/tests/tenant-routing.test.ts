// Phase 3 step 6: host → club → region, failing closed (build plan §6.4 and
// §6.9; test plan §3.16 "Routing" and journey R1).
//
// Synthetic clubs live only in this test's scratch database.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { classifyHost, decideHost, hostKey, hostsForTenant, normalizeHost, refusalStatus, type LookupResult, type RoutingOptions } from "@luvallplay/core/host-routing";
import { migrate } from "../scripts/db/migrate.mjs";
import { databaseLookup, edgeConfigLookup, hostLookup, resetRoutingCache, routeHost, routingMode, routingSelfCheck } from "../lib/tenant-routing.ts";

const OPTIONS: RoutingOptions = {
  region: "syd",
  platformDomains: ["luvallplay.com", "luvallplay.org"],
  deploymentHosts: ["club-abc123.vercel.app"],
  deploymentTenant: "three-wolves",
};
const TABLE: Record<string, LookupResult> = {
  "threewolvesbadminton.org": { tenant: "three-wolves", region: "syd" },
  "three-wolves.luvallplay.com": { tenant: "three-wolves", region: "syd" },
  "hanoi-smash.luvallplay.com": { tenant: "hanoi-smash", region: "han" },
  "mars.luvallplay.com": { tenant: "mars", region: "mars-1" },
};
const lookup = async (host: string) => (host in TABLE ? TABLE[host] : null);

test("hosts are normalised before anything looks them up", () => {
  assert.equal(normalizeHost("WWW.ThreeWolvesBadminton.org:443"), "threewolvesbadminton.org");
  assert.equal(normalizeHost("three-wolves.luvallplay.com."), "three-wolves.luvallplay.com");
  for (const bad of [null, "", "a b.com", "evil.com/path", "user@evil.com", "[::1]:3000", "-bad.com", "a..b", "x".repeat(260)]) {
    assert.equal(normalizeHost(bad), null, String(bad));
  }
  assert.equal(hostKey("three-wolves.luvallplay.com"), "host_three-wolves_luvallplay_com");
  assert.deepEqual(hostsForTenant({ slug: "three-wolves", customDomain: "ThreeWolvesBadminton.org" }, "luvallplay.com"), ["three-wolves.luvallplay.com", "threewolvesbadminton.org"]);
});

test("every host type is told apart", () => {
  const kind = (h: string) => classifyHost(h, OPTIONS);
  assert.deepEqual(kind("luvallplay.com"), { kind: "marketing" });
  assert.deepEqual(kind("luvallplay.org"), { kind: "marketing" });
  assert.deepEqual(kind("app.luvallplay.com"), { kind: "app" });
  assert.deepEqual(kind("admin.luvallplay.com"), { kind: "admin" });
  assert.deepEqual(kind("api.luvallplay.com"), { kind: "api" });
  assert.deepEqual(kind("three-wolves.luvallplay.com"), { kind: "club-subdomain", slug: "three-wolves" });
  // Clubs live under the first platform domain only, and never on a reserved name.
  assert.deepEqual(kind("three-wolves.luvallplay.org"), { kind: "marketing" });
  assert.deepEqual(kind("status.luvallplay.com"), { kind: "marketing" });
  assert.deepEqual(kind("a.b.luvallplay.com"), { kind: "marketing" });
  assert.deepEqual(kind("threewolvesbadminton.org"), { kind: "custom-domain" });
  assert.deepEqual(kind("club-abc123.vercel.app"), { kind: "deployment" });
  // A look-alike isn't the platform.
  assert.deepEqual(kind("notluvallplay.com"), { kind: "custom-domain" });
});

test("R1: a club's host resolves to its region, and only that region serves it", async () => {
  const d = (host: string | null, options = OPTIONS) => decideHost(host, lookup, options);
  assert.deepEqual(await d("www.threewolvesbadminton.org"), { action: "serve", kind: "custom-domain", tenant: "three-wolves", region: "syd" });
  assert.deepEqual(await d("three-wolves.luvallplay.com:443"), { action: "serve", kind: "club-subdomain", tenant: "three-wolves", region: "syd" });
  assert.deepEqual(await d("club-abc123.vercel.app"), { action: "serve", kind: "deployment", tenant: "three-wolves", region: "syd" });
  assert.deepEqual(await d("app.luvallplay.com"), { action: "platform", kind: "app" });

  // A club in another region is refused here, and served there.
  const other = await d("hanoi-smash.luvallplay.com");
  assert.deepEqual(other, { action: "wrong-region", tenant: "hanoi-smash", region: "han" });
  assert.equal(refusalStatus(other), 421);
  assert.deepEqual(await d("hanoi-smash.luvallplay.com", { ...OPTIONS, region: "han" }), { action: "serve", kind: "club-subdomain", tenant: "hanoi-smash", region: "han" });
  // And Sydney's club is refused by the Hanoi deployment.
  assert.equal((await d("threewolvesbadminton.org", { ...OPTIONS, region: "han" })).action, "wrong-region");
});

test("it fails closed", async () => {
  const d = (host: string | null, l = lookup, options = OPTIONS) => decideHost(host, l, options);
  // Nobody registered this host.
  assert.deepEqual(await d("someone-else.example"), { action: "refuse", reason: "unknown-host" });
  assert.deepEqual(await d("no-such-club.luvallplay.com"), { action: "refuse", reason: "unknown-host" });
  // The club's row names a region this code doesn't know.
  assert.deepEqual(await d("mars.luvallplay.com"), { action: "refuse", reason: "unknown-region" });
  // This deployment doesn't know its own region.
  assert.deepEqual(await d("threewolvesbadminton.org", lookup, { ...OPTIONS, region: "" }), { action: "refuse", reason: "unknown-region" });
  assert.deepEqual(await d("threewolvesbadminton.org", lookup, { ...OPTIONS, region: "atlantis" }), { action: "refuse", reason: "unknown-region" });
  // The lookup can't answer, or throws.
  const down = await d("threewolvesbadminton.org", async () => undefined);
  assert.deepEqual(down, { action: "refuse", reason: "lookup-unavailable" });
  assert.equal(refusalStatus(down), 503);
  assert.deepEqual(await d("threewolvesbadminton.org", async () => { throw new Error("boom"); }), { action: "refuse", reason: "lookup-unavailable" });
  // No host, or not a host.
  assert.deepEqual(await d(null), { action: "refuse", reason: "bad-host" });
  assert.deepEqual(await d("evil.com/../three-wolves"), { action: "refuse", reason: "bad-host" });
  // A deployment host with no club named for it.
  assert.deepEqual(await d("club-abc123.vercel.app", lookup, { ...OPTIONS, deploymentTenant: undefined }), { action: "refuse", reason: "unknown-host" });
  assert.equal(refusalStatus({ action: "refuse", reason: "unknown-host" }), 404);
});

test("the mode: off by default, and anything unrecognised enforces", () => {
  const was = process.env.TENANT_ROUTING;
  try {
    delete process.env.TENANT_ROUTING;
    assert.equal(routingMode(), "off");
    for (const [v, mode] of [["off", "off"], ["shadow", "shadow"], ["enforce", "enforce"], ["ENFORCE", "enforce"], ["on", "enforce"], ["shadwo", "enforce"]] as const) {
      process.env.TENANT_ROUTING = v;
      assert.equal(routingMode(), mode, v);
    }
  } finally {
    if (was === undefined) delete process.env.TENANT_ROUTING;
    else process.env.TENANT_ROUTING = was;
  }
});

test("Edge Config: found, missing, and every way it can fail", async () => {
  const conn = "https://edge-config.example/ecfg_test?token=secret";
  const seen: string[] = [];
  const reply = (status: number, body: unknown) => async (url: string) => {
    seen.push(url);
    return { status, json: async () => body };
  };
  assert.deepEqual(await edgeConfigLookup(conn, "threewolvesbadminton.org", reply(200, { tenant: "three-wolves", region: "syd" })), { tenant: "three-wolves", region: "syd" });
  assert.equal(seen[0], "https://edge-config.example/ecfg_test/item/host_threewolvesbadminton_org?token=secret");
  assert.equal(await edgeConfigLookup(conn, "nobody.example", reply(404, {})), null);
  assert.equal(await edgeConfigLookup(conn, "x.example", reply(500, {})), undefined);
  assert.equal(await edgeConfigLookup(conn, "x.example", reply(200, { tenant: 7 })), undefined);
  assert.equal(await edgeConfigLookup(conn, "x.example", async () => { throw new Error("network"); }), undefined);
  assert.equal(await edgeConfigLookup("not a url", "x.example", reply(200, {})), undefined);
  assert.equal(await edgeConfigLookup("https://edge-config.example/ecfg_test", "x.example", reply(200, {})), undefined, "no token");
});

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `tenant_routing_${process.pid}`;

describe("routing against the tenants table", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const env = { ...process.env };

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
    // Two synthetic clubs beside Three Wolves: one in the same region, one in Hanoi.
    await c.query(
      `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms, custom_domain)
       SELECT v.slug, v.name, t.status, v.country, v.region, v.timezone, v.currency, t.languages, t.sports, t.payment_mode, t.incorporated, 'none', '{}'::jsonb, t.theme, t.terms, v.custom_domain
       FROM tenants t, (VALUES
         ('sydney-shuttlers', 'Sydney Shuttlers', 'AU', 'syd', 'Australia/Sydney', 'AUD', 'sydneyshuttlers.example'),
         ('hanoi-smash', 'Hanoi Smash', 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', NULL)
       ) AS v(slug, name, country, region, timezone, currency, custom_domain)
       WHERE t.slug = 'three-wolves'`,
    );
  });
  after(async () => {
    process.env = env;
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });
  beforeEach(() => {
    resetRoutingCache();
    delete process.env.EDGE_CONFIG;
  });

  test("the database answers for custom domains and club subdomains", async () => {
    assert.deepEqual(await databaseLookup(c, "threewolvesbadminton.org", OPTIONS), { tenant: "three-wolves", region: "syd" });
    assert.deepEqual(await databaseLookup(c, "three-wolves.luvallplay.com", OPTIONS), { tenant: "three-wolves", region: "syd" });
    assert.deepEqual(await databaseLookup(c, "hanoi-smash.luvallplay.com", OPTIONS), { tenant: "hanoi-smash", region: "han" });
    assert.equal(await databaseLookup(c, "nobody.example", OPTIONS), null);
    assert.equal(await databaseLookup({ query: async () => { throw new Error("down"); } }, "threewolvesbadminton.org", OPTIONS), undefined);
  });

  test("R1 on this deployment: its own club is served, every other host is refused", async () => {
    const verdict = async (host: string) => {
      const v = await routeHost(c, host, OPTIONS);
      return v.serve ? "serve" : `${v.status} ${v.reason}`;
    };
    assert.equal(await verdict("www.threewolvesbadminton.org"), "serve");
    assert.equal(await verdict("three-wolves.luvallplay.com"), "serve");
    assert.equal(await verdict("club-abc123.vercel.app"), "serve");
    // Another region's club: refused, and nothing about it is served.
    assert.equal(await verdict("hanoi-smash.luvallplay.com"), "421 wrong-region");
    // A club in this region that isn't this deployment's (until reads are tenant-aware).
    assert.equal(await verdict("sydneyshuttlers.example"), "404 another-club");
    assert.equal(await verdict("sydney-shuttlers.luvallplay.com"), "404 another-club");
    assert.equal(await verdict("nobody.example"), "404 unknown-host");
    assert.equal(await verdict("admin.luvallplay.com"), "404 platform-admin");
    // The Hanoi deployment refuses Sydney's clubs the same way.
    const han = await routeHost(c, "threewolvesbadminton.org", { ...OPTIONS, region: "han", deploymentTenant: "hanoi-smash" });
    assert.equal(han.serve, false);
    assert.equal(!han.serve && han.status, 421);
  });

  test("Edge Config first, the database when the copy has no answer, closed when neither can answer", async () => {
    process.env.EDGE_CONFIG = "https://edge-config.example/ecfg_test?token=secret";
    let calls = 0;
    const edge = (status: number, body: unknown = {}) => async () => {
      calls++;
      return { status, json: async () => body };
    };
    let clock = 1_000_000;
    const now = () => clock;
    // In the copy: the database isn't asked.
    const noDb = { query: async () => { throw new Error("database must not be asked"); } };
    assert.deepEqual(await hostLookup(noDb, OPTIONS, now, edge(200, { tenant: "three-wolves", region: "syd" }))("threewolvesbadminton.org"), { tenant: "three-wolves", region: "syd" });
    // Remembered for a minute, then asked again.
    assert.deepEqual(await hostLookup(noDb, OPTIONS, now, edge(500))("threewolvesbadminton.org"), { tenant: "three-wolves", region: "syd" });
    assert.equal(calls, 1);
    clock += 61_000;
    // The copy is down: the database answers.
    assert.deepEqual(await hostLookup(c, OPTIONS, now, edge(500))("threewolvesbadminton.org"), { tenant: "three-wolves", region: "syd" });
    // Not in the copy yet (a club added a minute ago): the database answers.
    assert.deepEqual(await hostLookup(c, OPTIONS, now, edge(404))("sydneyshuttlers.example"), { tenant: "sydney-shuttlers", region: "syd" });
    // In neither: unknown.
    assert.equal(await hostLookup(c, OPTIONS, now, edge(404))("nobody.example"), null);
    // Both down: no answer, the request is refused, and the failure isn't remembered.
    resetRoutingCache();
    const down = hostLookup(noDb, OPTIONS, now, edge(500));
    assert.equal(await down("threewolvesbadminton.org"), undefined);
    const v = await routeHost(noDb, "threewolvesbadminton.org", OPTIONS, down);
    assert.equal(v.serve, false);
    assert.equal(!v.serve && v.status, 503);
    assert.deepEqual(await hostLookup(c, OPTIONS, now, edge(500))("threewolvesbadminton.org"), { tenant: "three-wolves", region: "syd" });
  });

  test("the daily self-check: the club's own hosts resolve to it", async () => {
    assert.deepEqual(await routingSelfCheck(c, OPTIONS), {
      checked: ["three-wolves.luvallplay.com", "threewolvesbadminton.org", "www.threewolvesbadminton.org"],
      differences: [],
    });
    resetRoutingCache();
    const wrong = await routingSelfCheck(c, { ...OPTIONS, region: "han" });
    assert.equal(wrong.differences.length, 3);
    assert.match(wrong.differences[0], /wrong-region \(421\)/);
  });
});
