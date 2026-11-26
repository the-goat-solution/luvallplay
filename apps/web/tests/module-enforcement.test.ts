// Phase 3 step 5: modules are enforced (build plan §6.2.3; test plan S2).
//
// The route-level rules are in module-routes.test.ts. This file covers the
// club's switches in the database: off stops the module's routes and keeps
// its data; on brings them back; the registry's rules hold (core, needs,
// dependents, a platform lock); and a database problem never switches a
// club's features off.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { MODULES, moduleOwnedPrefixes } from "@luvallplay/modules";
import { migrate } from "../scripts/db/migrate.mjs";
import { enabledModules, listClubModules, moduleBlocking, resetClubModulesCache, setClubModule } from "../lib/club-modules.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `module_enforcement_${process.pid}`;
// Every module a club can have on. The hidden ones (Juniors, Forms & waivers) can't be
// switched by the ordinary switch at all: tests/juniors-module.test.ts covers theirs.
const OFFERED = MODULES.filter((m) => m.availability !== "hidden").map((m) => m.id);
const OPTIONAL = MODULES.filter((m) => !m.core && m.availability !== "hidden").map((m) => m.id);

test("the proxy's matcher covers every prefix a module owns", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const matcher = [...proxy.slice(proxy.indexOf("matcher: ["), proxy.indexOf("],", proxy.indexOf("matcher: ["))).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const covered = (path: string) => matcher.some((m) => m === path || (m.endsWith("/:path*") && (path === m.slice(0, -7) || path.startsWith(`${m.slice(0, -7)}/`))));
  assert.deepEqual(moduleOwnedPrefixes().filter((p) => !covered(p)), [], "add these to config.matcher in proxy.ts");
  // The bare path and everything under it.
  for (const p of moduleOwnedPrefixes().filter((x) => !x.startsWith("/api/") && !x.startsWith("/admin") && !x.startsWith("/profile"))) {
    assert.ok(matcher.includes(p) && matcher.includes(`${p}/:path*`), p);
  }
});

describe("the club's module switches", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const owner = (moduleId: string, on: boolean) => setClubModule(c, { moduleId, on, actor: "owner", actorPlayerId: 1 });
  const staff = (moduleId: string, on: boolean) => setClubModule(c, { moduleId, on, actor: "platform-admin", actorPlayerId: 1 });
  const warnings: string[] = [];
  const originalWarn = console.warn;

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
    await c.query(`INSERT INTO players (id, email) VALUES (1, 'owner@x.test')`);
    // Data that belongs to modules: it must survive being switched off.
    await c.query(`INSERT INTO arena_pairs (player_low, player_high, name) VALUES (1, 1, 'Pair')`);
    await c.query(`INSERT INTO shop_orders (player_id, email, status, payment_method, total_cents) VALUES (1, 'owner@x.test', 'paid', 'card', 4500)`);
    console.warn = (...a: unknown[]) => warnings.push(a.join(" "));
  });
  after(async () => {
    console.warn = originalWarn;
    delete process.env.MODULE_ENFORCEMENT;
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });
  beforeEach(() => {
    warnings.length = 0;
    resetClubModulesCache();
    delete process.env.MODULE_ENFORCEMENT;
  });

  test("Three Wolves starts with every module on: nothing is stopped", async () => {
    const on = await enabledModules(c);
    assert.deepEqual([...on].sort(), [...OFFERED].sort());
    for (const path of ["/admin/shop", "/api/arena", "/profile/wolf-vision", "/api/cron/sync-finance", "/gallery"]) {
      assert.equal(await moduleBlocking(c, path), null, path);
    }
  });

  for (const id of OPTIONAL) {
    test(`S2 · ${id}: off, on again; its data is kept`, async () => {
      const counts = async () => (await c.query(`SELECT (SELECT count(*) FROM arena_pairs)::int AS pairs, (SELECT count(*) FROM shop_orders)::int AS orders, (SELECT count(*) FROM tenant_modules)::int AS rows`)).rows[0];
      const before = await counts();
      // Anything that needs this module goes off first (the switch says so).
      const dependents = MODULES.filter((m) => (m.requires as readonly string[] | undefined)?.includes(id)).map((m) => m.id);
      if (dependents.length) {
        const refused = await owner(id, false);
        assert.ok(!refused.ok && /Turn (it|them) off first/.test(refused.reason), JSON.stringify(refused));
        for (const d of dependents) assert.deepEqual(await owner(d, false), { ok: true, changed: true });
      }
      assert.deepEqual(await owner(id, false), { ok: true, changed: true });
      assert.equal((await enabledModules(c)).has(id), false);
      assert.deepEqual(await owner(id, false), { ok: true, changed: false }, "switching it off twice changes nothing");
      assert.deepEqual(await counts(), before, "nothing is deleted");

      assert.deepEqual(await owner(id, true), { ok: true, changed: true });
      for (const d of dependents) assert.deepEqual(await owner(d, true), { ok: true, changed: true });
      assert.deepEqual([...(await enabledModules(c))].sort(), [...OFFERED].sort(), "everything is back on");
      assert.deepEqual(await counts(), before);
    });
  }

  test("off stops the module's pages, API routes and crons, and nothing else", async () => {
    await owner("bank-matching", false);
    await owner("finance", false);
    try {
      assert.equal(await moduleBlocking(c, "/admin/financials"), "finance");
      assert.equal(await moduleBlocking(c, "/api/admin/finance/export"), "finance");
      assert.equal(await moduleBlocking(c, "/api/cron/sync-finance"), "finance");
      assert.equal(await moduleBlocking(c, "/admin/financials/bank"), "bank-matching");
      assert.equal(await moduleBlocking(c, "/api/bank/webhook"), "bank-matching");
      for (const path of ["/admin", "/admin/play-days", "/admin/shop", "/api/spots", "/api/cron/send-roster", "/profile", "/api/stripe-webhook"]) {
        assert.equal(await moduleBlocking(c, path), null, path);
      }
    } finally {
      await owner("finance", true);
      await owner("bank-matching", true);
    }
  });

  test("the core can't be switched; a needed module comes first", async () => {
    for (const m of MODULES.filter((x) => x.core)) {
      const r = await owner(m.id, false);
      assert.ok(!r.ok && /core/.test(r.reason), m.id);
    }
    await owner("bank-matching", false);
    await owner("finance", false);
    const r = await owner("bank-matching", true);
    assert.ok(!r.ok && /turned on first/.test(r.reason), JSON.stringify(r));
    await owner("finance", true);
    assert.deepEqual(await owner("bank-matching", true), { ok: true, changed: true });
    assert.ok(!(await owner("no-such-module", true)).ok);
  });

  test("a platform lock: the owner can't change it and sees why; a platform admin can", async () => {
    await c.query(`UPDATE tenant_modules SET locked = 'on', lock_reason = 'Needed for the season review' WHERE module_id = 'gallery'`);
    try {
      const refused = await owner("gallery", false);
      assert.ok(!refused.ok && /locked by Luvallplay/.test(refused.reason));
      assert.equal((await listClubModules(c)).find((m) => m.id === "gallery")?.lockReason, "Needed for the season review");
      assert.deepEqual(await staff("gallery", false), { ok: true, changed: true });
      assert.deepEqual(await staff("gallery", true), { ok: true, changed: true });
    } finally {
      await c.query(`UPDATE tenant_modules SET locked = NULL, lock_reason = NULL WHERE module_id = 'gallery'`);
    }
  });

  test("a module without a row is off; the core is on whatever the table says", async () => {
    await c.query(`CREATE TEMP TABLE kept AS SELECT * FROM tenant_modules WHERE module_id IN ('arena', 'play-days')`);
    await c.query(`DELETE FROM tenant_modules WHERE module_id IN ('arena', 'play-days')`);
    try {
      const on = await enabledModules(c);
      assert.equal(on.has("arena"), false);
      assert.equal(on.has("play-days"), true);
      assert.equal(await moduleBlocking(c, "/api/arena"), "arena");
    } finally {
      await c.query(`INSERT INTO tenant_modules SELECT * FROM kept`);
      await c.query(`DROP TABLE kept`);
    }
  });

  test("a database problem never switches features off: every module counts as on, and it is logged once", async () => {
    const broken = { query: async () => Promise.reject(new Error("connection lost")) };
    assert.deepEqual([...(await enabledModules(broken))].sort(), [...OFFERED].sort());
    // …except a module the platform keeps hidden: Juniors never comes on by accident.
    assert.equal((await enabledModules(broken)).has("juniors"), false);
    assert.equal(await moduleBlocking(broken, "/admin/shop"), null);
    resetClubModulesCache();
    await enabledModules(broken);
    assert.equal(warnings.filter((w) => w.includes("[modules]")).length, 2, "once per cache reset, not per request");
  });

  test("MODULE_ENFORCEMENT=off is the escape hatch", async () => {
    await owner("gallery", false);
    try {
      assert.equal(await moduleBlocking(c, "/gallery"), "gallery");
      process.env.MODULE_ENFORCEMENT = "off";
      resetClubModulesCache();
      assert.equal(await moduleBlocking(c, "/gallery"), null);
    } finally {
      delete process.env.MODULE_ENFORCEMENT;
      await owner("gallery", true);
    }
  });
});

test("links and sections follow the switches: a link to a module that is off isn't shown", async () => {
  const { DEFAULT_PUBLIC_CLUB, linkShown, moduleOn, publicClub } = await import("../lib/club-public.ts");
  const { DEFAULT_CLUB_CONFIG } = await import("../lib/club-config.ts");
  // Everything is on by default (and when the switches can't be read).
  for (const path of ["/profile", "/profile/arena", "/profile/wolf-vision", "/gallery", "/"]) assert.equal(linkShown(DEFAULT_PUBLIC_CLUB, path), true, path);
  const club = publicClub(DEFAULT_CLUB_CONFIG, new Set(["home", "play-days", "people", "memberships"]));
  assert.deepEqual([...club.modules], ["home", "memberships", "people", "play-days"]);
  assert.equal(linkShown(club, "/profile"), true);
  assert.equal(linkShown(club, "/profile/settings"), true);
  assert.equal(linkShown(club, "/profile/arena"), false);
  assert.equal(linkShown(club, "/profile/arena?tab=leaderboard"), false, "the query string doesn't hide the owner");
  assert.equal(linkShown(club, "/profile/leaderboard"), false, "the Leaderboard tab belongs to the Arena");
  assert.equal(linkShown(club, "/profile/leaderboard?period=year"), false);
  assert.equal(linkShown(club, "/profile/wolf-vision"), false);
  assert.equal(linkShown(club, "/gallery#top"), false);
  assert.equal(moduleOn(club, "memberships"), true);
  assert.equal(moduleOn(club, "donations"), false);
});
