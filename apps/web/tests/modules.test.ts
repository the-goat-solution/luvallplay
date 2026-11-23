// The module registry (@luvallplay/modules, build plan §6.2) describes what
// the club runs today. These tests tie it to the real app so it can't drift:
// every admin menu page, cron and webhook event belongs to exactly one module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { MODULES, THREE_WOLVES_MODULES, defineModule, validateRegistry, withRequirements, type ModuleManifest } from "@luvallplay/modules";
import { NAV_GROUPS } from "../components/admin/nav-config.ts";

const APP = new URL("../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, APP), "utf8");

test("the registry is consistent: unique ids, known dependencies, no loops, one owner each", () => {
  assert.deepEqual(validateRegistry(MODULES), []);
});

test("every admin menu page belongs to exactly one module, in the same menu group", () => {
  const menu = NAV_GROUPS.flatMap((g) => g.items.map((i) => `${g.label} ${i.href}`)).sort();
  const declared = MODULES.flatMap((m) => (m.admin?.nav ?? []).map((n) => `${n.group} ${n.href}`)).sort();
  assert.deepEqual(declared, menu);
});

test("every cron in vercel.json belongs to exactly one module, with the same schedule", () => {
  const crons = (JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[]).map((c) => `${c.path} ${c.schedule}`).sort();
  const declared = MODULES.flatMap((m) => (m.crons ?? []).map((c) => `${c.path} ${c.schedule}`)).sort();
  assert.deepEqual(declared, crons);
  for (const m of MODULES) for (const c of m.crons ?? []) assert.equal(c.path, `/api/cron/${c.id}`);
});

test("every webhook event belongs to exactly one module", () => {
  const src = read("lib/webhooks.ts");
  const events = JSON.parse(`[${src.match(/export const EVENTS = \[([^\]]*)\]/)?.[1] ?? ""}]`) as string[];
  assert.ok(events.length > 0);
  assert.deepEqual(MODULES.flatMap((m) => m.webhooks ?? []).sort(), [...events].sort());
});

test("routes and API paths named by modules exist in the app", () => {
  const page = (route: string) => (route === "/" ? "app/page.tsx" : `app${route}/page.tsx`);
  for (const m of MODULES) {
    for (const r of [...(m.app?.routes ?? []), ...(m.site?.routes ?? [])]) assert.ok(existsSync(new URL(page(r), APP)), `${m.id}: ${r}`);
    for (const r of m.api ?? []) assert.ok(existsSync(new URL(`app${r}/route.ts`, APP)), `${m.id}: ${r}`);
  }
});

test("every module has an English and a Vietnamese name and is on the Free plan", () => {
  for (const m of MODULES) {
    assert.ok(m.name.en && m.name.vi, m.id);
    assert.equal(m.plan, "free");
    assert.equal(m.scope, "club", "global modules come in a later phase");
  }
});

test("Three Wolves has every module switched on", () => {
  assert.deepEqual([...THREE_WOLVES_MODULES].sort(), MODULES.map((m) => m.id).sort());
});

test("withRequirements follows requires transitively", () => {
  assert.deepEqual(withRequirements(MODULES, "bank-nz"), ["bank-nz", "finance"]);
  assert.deepEqual(withRequirements(MODULES, "casual-play"), ["casual-play", "play-days", "members"]);
});

test("defineModule and validateRegistry reject bad manifests", () => {
  const base = { scope: "club", group: "run", plan: "free", name: { en: "A", vi: "A" } } as const;
  assert.throws(() => defineModule({ ...base, id: "Bad Id" }), /kebab-case/);
  assert.throws(() => defineModule({ ...base, id: "x", name: { en: "X", vi: " " } }), /Vietnamese/);
  const a: ModuleManifest = { ...base, id: "a", requires: ["b"], admin: { nav: [{ group: "Play", href: "/admin/x" }] } };
  const b: ModuleManifest = { ...base, id: "b", requires: ["a"], admin: { nav: [{ group: "Play", href: "/admin/x" }] } };
  const c: ModuleManifest = { ...base, id: "c", recommends: ["nope"] };
  const problems = validateRegistry([a, b, c, { ...c }]);
  assert.ok(problems.some((p) => p.startsWith("duplicate module id c")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("unknown module nope")));
  assert.ok(problems.some((p) => p.includes("claimed by both a and b")));
  assert.ok(problems.some((p) => p.startsWith("requires loop")));
});
