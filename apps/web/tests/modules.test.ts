// The module registry (@luvallplay/modules, build plan §6.2, §6.2.1, §6.2.3)
// describes what the club runs today. These tests tie it to the real app so
// it can't drift: every admin menu page, cron and webhook event belongs to
// exactly one module (or the platform console), and the switching rules hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  MODULES,
  PLATFORM_CONSOLE_PAGES,
  THREE_WOLVES,
  allowedPaymentModes,
  canTurnOff,
  canTurnOn,
  defineModule,
  validateRegistry,
  withRequirements,
  type ModuleManifest,
  type SwitchContext,
} from "@luvallplay/modules";
import { NAV_GROUPS } from "../components/admin/nav-config.ts";

const APP = new URL("../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, APP), "utf8");

test("the registry is consistent: unique ids, known dependencies, no loops, sound payment rules, one owner each", () => {
  assert.deepEqual(validateRegistry(MODULES), []);
});

test("the core is exactly §6.2.3's: Home, Play days, People, Messages, Website, Settings, none needing payments", () => {
  const core = MODULES.filter((m) => m.core);
  assert.deepEqual(core.map((m) => m.id), ["home", "play-days", "people", "messages", "website", "settings"]);
  for (const m of core) assert.ok(allowedPaymentModes(m).includes("free"), `${m.id} works on Free play`);
});

test("every admin menu page belongs to exactly one module or the platform console, in the same menu group", () => {
  const menu = NAV_GROUPS.flatMap((g) => g.items.map((i) => `${g.label} ${i.href}`)).sort();
  const declared = [
    ...MODULES.flatMap((m) => (m.admin?.nav ?? []).map((n) => `${n.group} ${n.href}`)),
    ...PLATFORM_CONSOLE_PAGES.map((p) => `${p.group} ${p.href}`),
  ].sort();
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

test("routes, admin pages and API paths named by modules exist in the app", () => {
  const page = (route: string) => (route === "/" ? "app/page.tsx" : `app${route}/page.tsx`);
  const adminPage = (href: string) => (href === "/admin" ? "app/admin/(console)/page.tsx" : `app/admin/(console)${href.slice("/admin".length)}/page.tsx`);
  for (const m of MODULES) {
    for (const r of [...(m.app?.routes ?? []), ...(m.site?.routes ?? [])]) assert.ok(existsSync(new URL(page(r), APP)), `${m.id}: ${r}`);
    for (const h of [...(m.admin?.nav ?? []).map((n) => n.href), ...(m.admin?.pages ?? [])]) assert.ok(existsSync(new URL(adminPage(h), APP)), `${m.id}: ${h}`);
    for (const r of m.api ?? []) assert.ok(existsSync(new URL(`app${r}/route.ts`, APP)), `${m.id}: ${r}`);
  }
});

test("every module has an English and a Vietnamese name, is on the Free plan and is a club module", () => {
  for (const m of MODULES) {
    assert.ok(m.name.en && m.name.vi, m.id);
    assert.equal(m.plan, "free");
    assert.equal(m.scope, "club", "global modules come in a later phase");
  }
});

test("Three Wolves: online payments, every optional module on (not the hidden ones), and every one of them allowed", () => {
  assert.equal(THREE_WOLVES.paymentMode, "online");
  assert.deepEqual([...THREE_WOLVES.modules].sort(), MODULES.filter((m) => !m.core && m.availability !== "hidden").map((m) => m.id).sort());
  assert.ok(!(THREE_WOLVES.modules as readonly string[]).includes("juniors"), "Juniors ships dark");
  for (const id of THREE_WOLVES.modules) {
    const ctx: SwitchContext = { paymentMode: "online", enabled: THREE_WOLVES.modules.filter((x) => x !== id), actor: "owner" };
    assert.deepEqual(canTurnOn(MODULES, id, ctx), { ok: true }, id);
  }
});

test("Free play: a core-only club works, and nothing that needs payments can be turned on (§6.2.1)", () => {
  const free: SwitchContext = { paymentMode: "free", enabled: [], actor: "owner" };
  for (const m of MODULES.filter((x) => !x.core && x.availability !== "hidden")) {
    const r = canTurnOn(MODULES, m.id, free);
    if (m.payments === "required") {
      assert.equal(r.ok, false, m.id);
      assert.match((r as { reason: string }).reason, /payment mode other than Free play/);
    } else if (!m.requires?.length) {
      assert.deepEqual(r, { ok: true }, m.id);
    }
  }
  // Card payments need online payments, not just cash or transfer.
  assert.equal(canTurnOn(MODULES, "card-payments", { ...free, paymentMode: "offline" }).ok, false);
  assert.equal(canTurnOn(MODULES, "card-payments", { ...free, paymentMode: "online" }).ok, true);
});

test("switching rules: core never switches, requirements first, dependents block, locks and availability", () => {
  const ctx: SwitchContext = { paymentMode: "offline", enabled: [], actor: "owner" };
  assert.equal(canTurnOff(MODULES, "play-days", ctx).ok, false);
  assert.equal(canTurnOn(MODULES, "home", ctx).ok, false);
  assert.match((canTurnOn(MODULES, "bank-matching", ctx) as { reason: string }).reason, /needs Finance & reports turned on first/);
  assert.equal(canTurnOn(MODULES, "bank-matching", { ...ctx, enabled: ["finance"] }).ok, true);
  assert.match((canTurnOff(MODULES, "finance", { ...ctx, enabled: ["finance", "bank-matching"] }) as { reason: string }).reason, /Bank matching .* needs Finance/);
  assert.equal(canTurnOff(MODULES, "finance", { ...ctx, enabled: ["finance"] }).ok, true);
  // Locked by a platform admin: owners can't change it, platform admins can.
  assert.match((canTurnOff(MODULES, "arena", { ...ctx, enabled: ["arena"], locked: ["arena"] }) as { reason: string }).reason, /locked/);
  assert.equal(canTurnOff(MODULES, "arena", { ...ctx, enabled: ["arena"], locked: ["arena"], actor: "platform-admin" }).ok, true);
  // Platform-wide availability.
  assert.equal(canTurnOn(MODULES, "vision", { ...ctx, availability: { vision: "hidden" } }).ok, false);
  assert.equal(canTurnOn(MODULES, "vision", { ...ctx, availability: { vision: "beta" } }).ok, false);
  assert.equal(canTurnOn(MODULES, "vision", { ...ctx, availability: { vision: "beta" }, inBeta: ["vision"] }).ok, true);
});

test("Juniors and Forms & waivers are hidden platform-wide: the ordinary switch refuses them (Phase 3b ships dark)", () => {
  const ctx: SwitchContext = { paymentMode: "online", enabled: [...THREE_WOLVES.modules], actor: "owner" };
  for (const id of ["juniors", "forms-waivers"]) {
    assert.equal(MODULES.find((m) => m.id === id)?.availability, "hidden", id);
    assert.match((canTurnOn(MODULES, id, ctx) as { reason: string }).reason, /isn't available right now/);
    assert.equal(canTurnOn(MODULES, id, { ...ctx, actor: "platform-admin" }).ok, false, "not for Luvallplay staff either");
  }
  // Once the platform opens them: Juniors needs Forms & waivers first, and works on Free play.
  const open = { ...ctx, availability: { juniors: "available", "forms-waivers": "available" } } as SwitchContext;
  assert.match((canTurnOn(MODULES, "juniors", open) as { reason: string }).reason, /needs Forms & waivers turned on first/);
  assert.deepEqual(canTurnOn(MODULES, "juniors", { ...open, enabled: ["forms-waivers"] }), { ok: true });
  assert.deepEqual(canTurnOn(MODULES, "juniors", { ...open, paymentMode: "free", enabled: ["forms-waivers"] }), { ok: true });
  assert.deepEqual(withRequirements(MODULES, "juniors"), ["juniors", "forms-waivers"]);
});

test("withRequirements follows requires transitively", () => {
  assert.deepEqual(withRequirements(MODULES, "bank-matching"), ["bank-matching", "finance"]);
  assert.deepEqual(withRequirements(MODULES, "arena"), ["arena"]);
});

test("defineModule and validateRegistry reject bad manifests", () => {
  const base = { scope: "club", group: "run", plan: "free", payments: "none", name: { en: "A", vi: "A" } } as const;
  assert.throws(() => defineModule({ ...base, id: "Bad Id" }), /kebab-case/);
  assert.throws(() => defineModule({ ...base, id: "x", name: { en: "X", vi: " " } }), /Vietnamese/);
  const a: ModuleManifest = { ...base, id: "a", requires: ["b"], admin: { nav: [{ group: "Play", href: "/admin/x" }] } };
  const b: ModuleManifest = { ...base, id: "b", requires: ["a"], admin: { nav: [{ group: "Play", href: "/admin/x" }] } };
  const c: ModuleManifest = { ...base, id: "c", recommends: ["nope"] };
  const paid: ModuleManifest = { ...base, id: "paid", payments: "required" };
  const free: ModuleManifest = { ...base, id: "free", requires: ["paid"] };
  const coreNeedsMoney: ModuleManifest = { ...base, id: "k", core: true, payments: "required" };
  const problems = validateRegistry([a, b, c, { ...c }, paid, free, coreNeedsMoney]);
  const has = (re: RegExp) => assert.ok(problems.some((p) => re.test(p)), `${re}\n${problems.join("\n")}`);
  has(/^duplicate module id c/);
  has(/unknown module nope/);
  has(/claimed by both a and b/);
  has(/^requires loop/);
  has(/free can be on in free but requires paid/);
  has(/core module k can't require payments/);
});
