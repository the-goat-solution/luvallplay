// Phase 3 step 5: modules are enforced, not just described (build plan
// §6.2.3; test plan journey S2 "for every module").
//
// 1. Every page and API route in the app has an owner: a module, the core,
//    the account, or the platform. A new route without one fails here.
// 2. With every module on (Three Wolves today), nothing is blocked.
// 3. S2, route level, for every optional module: switched off, exactly its
//    own routes stop and every other route is still served; switched back
//    on, they are served again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MODULES, ROUTE_OWNERS, blockedByModule, moduleOwnedPrefixes, routeOwner } from "@luvallplay/modules";

const APP = new URL("../app", import.meta.url).pathname;

/** Every page and API route as a URL path ("[id]" segments kept, route groups dropped). */
function appRoutes(dir = APP, base = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const segment = /^\(.*\)$/.test(name) ? "" : `/${name}`;
      out.push(...appRoutes(full, base + segment));
    } else if (name === "page.tsx" || name === "route.ts") {
      out.push(base || "/");
    }
  }
  return [...new Set(out)].sort();
}

const ROUTES = appRoutes();
const OPTIONAL = MODULES.filter((m) => !m.core).map((m) => m.id);
const ALL_ON = new Set<string>(OPTIONAL);

test("the route list is read from the app", () => {
  assert.ok(ROUTES.length > 100, `found ${ROUTES.length} routes`);
  for (const known of ["/", "/admin/play-days", "/api/spots", "/api/arena/player/[id]", "/profile/wolf-vision"]) assert.ok(ROUTES.includes(known), known);
});

test("every page and API route has an owner", () => {
  const unowned = ROUTES.filter((r) => routeOwner(r) === null);
  assert.deepEqual(unowned, [], "add a rule to packages/modules/src/routes.ts for each");
});

test("every rule names a real module and covers at least one real route", () => {
  const ids = new Set<string>([...MODULES.map((m) => m.id), "core", "account", "platform"]);
  for (const [prefix, owner] of ROUTE_OWNERS) {
    assert.ok(ids.has(owner), `${prefix} → unknown owner ${owner}`);
    assert.ok(!MODULES.find((m) => m.id === owner)?.core, `${prefix}: core modules are written as "core"`);
    assert.ok(ROUTES.some((r) => r === prefix || r.startsWith(`${prefix}/`)), `${prefix} matches no route in the app`);
  }
  assert.equal(new Set(ROUTE_OWNERS.map(([p]) => p)).size, ROUTE_OWNERS.length, "no prefix twice");
});

test("the longest prefix wins, and near-misses don't match", () => {
  assert.equal(routeOwner("/admin/financials"), "finance");
  assert.equal(routeOwner("/admin/financials/bank"), "bank-matching");
  assert.equal(routeOwner("/admin/financials/report"), "finance");
  assert.equal(routeOwner("/admin/play-days"), "core");
  assert.equal(routeOwner("/admin/play-days/schedule"), "day-requests");
  assert.equal(routeOwner("/api/profile/me"), "account");
  assert.equal(routeOwner("/api/profile/shop/order/12/cancel"), "shop");
  assert.equal(routeOwner("/profile/arena/"), "arena", "a trailing slash is the same page");
  assert.equal(routeOwner("/api/arenax"), null, "a prefix only matches whole segments");
  assert.equal(routeOwner("/admin/shopping"), "core", "falls back to the admin core, not the shop");
});

test("with every module on, as Three Wolves has them, nothing is blocked", () => {
  assert.deepEqual(ROUTES.filter((r) => blockedByModule(r, ALL_ON) !== null), []);
});

test("Juniors: the page where an owner switches it on is served while it is off; any other Juniors admin page needs the module's claim", () => {
  const off = new Set(ALL_ON);
  off.delete("juniors");
  // Today the only Juniors admin page is Set up, part of the core's /admin
  // (it hides itself while Juniors is hidden platform-wide).
  assert.equal(blockedByModule("/admin/juniors/setup", off), null);
  // The module claimed "/admin/juniors" before it had a page there, which the
  // generated on/off journey (S2) rightly failed: a claimed route must exist.
  // The claim comes back with the first real page (Phase 3b step 6). This
  // guard makes that impossible to forget: a Juniors admin page other than
  // Set up must stop while Juniors is off.
  const others = ROUTES.filter((r) => (r === "/admin/juniors" || r.startsWith("/admin/juniors/")) && r !== "/admin/juniors/setup");
  for (const r of others) assert.equal(blockedByModule(r, off), "juniors", `${r} must stop while Juniors is off: claim "/admin/juniors" for the juniors module in packages/modules/src/routes.ts (and keep /admin/juniors/setup with the core)`);
});

test("the core, the account and the platform can't be switched off", () => {
  const nothingOn = new Set<string>();
  for (const r of ["/", "/login", "/profile", "/admin", "/admin/play-days", "/admin/settings", "/admin/people/admins", "/api/auth/email/start", "/api/sessions", "/api/spots", "/api/waitlist", "/api/cron/send-roster", "/api/stripe-webhook", "/api/health/db", "/admin/setup"]) {
    assert.equal(blockedByModule(r, nothingOn), null, r);
  }
});

for (const id of OPTIONAL) {
  test(`S2 · ${id}: off stops exactly its own routes; on brings them back`, () => {
    const own = ROUTES.filter((r) => routeOwner(r) === id);
    const off = new Set(ALL_ON);
    off.delete(id);
    const blocked = ROUTES.filter((r) => blockedByModule(r, off) !== null);
    assert.deepEqual(blocked, own, "only this module's routes stop");
    for (const r of blocked) assert.equal(blockedByModule(r, off), id);
    assert.deepEqual(ROUTES.filter((r) => blockedByModule(r, ALL_ON) !== null), [], "switched back on, everything is served");
  });
}

test("modules that own no route of their own are listed, so the gap is deliberate", () => {
  const withRoutes = new Set(ROUTE_OWNERS.map(([, o]) => o));
  // Their screens live inside another module's pages; their parts are
  // switched inside those pages (next part of step 5), not by path.
  // Forms & waivers: hidden, its screens arrive with Phase 3b step 4.
  // Juniors: hidden; its only admin page today is Set up (core). Its own
  // routes arrive with Phase 3b step 6.
  assert.deepEqual(OPTIONAL.filter((id) => !withRoutes.has(id)).sort(), ["forms-waivers", "payments-to-check"]);
  assert.ok(moduleOwnedPrefixes().length > 30);
});
