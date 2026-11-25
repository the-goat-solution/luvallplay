// app.luvallplay.com/{club}: the decision for a request, with a fake database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeClubPath, clubPathsOn, type Db } from "../lib/tenant-routing.ts";
import type { RoutingOptions } from "@luvallplay/core/host-routing";

const OPTIONS: RoutingOptions = { region: "syd", platformDomains: ["luvallplay.com"], deploymentHosts: [], deploymentTenant: "three-wolves" };
const ROWS: Record<string, Record<string, unknown>> = {
  "three-wolves": { slug: "three-wolves", region: "syd", custom_domain: null },
  "tw-domain": { slug: "tw-domain", region: "syd", custom_domain: "tw.example.org" },
  "other-club": { slug: "other-club", region: "syd", custom_domain: null },
  "hanoi": { slug: "hanoi", region: "han", custom_domain: null },
};
const db: Db = { query: async (_t, p) => ({ rows: ROWS[p?.[0] as string] ? [ROWS[p![0] as string]] : [] }) };
const down: Db = { query: async () => { throw new Error("down"); } };
const r = (host: string, path: string, d: Db = db, search = "") => routeClubPath(d, host, path, search, OPTIONS);

test("only the app host reads a club from the path", async () => {
  assert.deepEqual(await r("luvallplay.com", "/three-wolves/arena"), { action: "none" });
  assert.deepEqual(await r("threewolvesbadminton.org", "/three-wolves/arena"), { action: "none" });
  assert.deepEqual(await r("app.luvallplay.com", "/"), { action: "none" });
  assert.deepEqual(await r("app.luvallplay.com", "/api/mcp"), { action: "none" });
});

test("this deployment's club is served at the rest of the path", async () => {
  assert.deepEqual(await r("app.luvallplay.com", "/three-wolves/arena"), { action: "rewrite", path: "/arena" });
  assert.deepEqual(await r("app.luvallplay.com", "/three-wolves"), { action: "rewrite", path: "/" });
});

test("a club with its own domain is sent there, query kept", async () => {
  assert.deepEqual(await r("app.luvallplay.com", "/tw-domain/arena", db, "?a=1"), { action: "redirect", url: "https://tw.example.org/arena?a=1" });
});

test("unknown, other-club, other-region and unreadable all fail closed", async () => {
  assert.deepEqual(await r("app.luvallplay.com", "/nobody/x"), { action: "refuse", status: 404 });
  assert.deepEqual(await r("app.luvallplay.com", "/other-club/x"), { action: "refuse", status: 404 });
  assert.deepEqual(await r("app.luvallplay.com", "/hanoi/x"), { action: "refuse", status: 421 });
  assert.deepEqual(await r("app.luvallplay.com", "/three-wolves/x", down), { action: "refuse", status: 503 });
});

test("CLUB_PATHS is off unless it says on", () => {
  const was = process.env.CLUB_PATHS;
  for (const [v, want] of [[undefined, false], ["", false], ["off", false], ["shadow", false], ["on", true], [" ON ", true]] as const) {
    if (v === undefined) delete process.env.CLUB_PATHS; else process.env.CLUB_PATHS = v;
    assert.equal(clubPathsOn(), want, String(v));
  }
  if (was === undefined) delete process.env.CLUB_PATHS; else process.env.CLUB_PATHS = was;
});
