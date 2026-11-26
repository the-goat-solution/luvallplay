// The website's availability list agrees with what the platform actually has
// switched on (see content/availability-sync.ts for the rules).
import { test } from "node:test";
import assert from "node:assert/strict";
import { availability } from "../content/availability.ts";
import { MODULE_LINES, NOT_A_MODULE } from "../content/availability-sync.ts";
import { MODULES } from "../../../packages/modules/src/registry.ts";

const lines = new Map(availability.items.map((i) => [i.key, i]));
const state = (m: (typeof MODULES)[number]) => m.availability ?? "available";

test("every platform module is mapped to a line on the website, and nothing else is", () => {
  const ids = new Set<string>(MODULES.map((m) => m.id));
  for (const id of ids) assert.ok(MODULE_LINES[id], `module "${id}" has no line on the website: add it to content/availability-sync.ts`);
  for (const id of Object.keys(MODULE_LINES)) assert.ok(ids.has(id), `availability-sync names "${id}", which is not a platform module`);
  for (const [id, m] of Object.entries(MODULE_LINES)) {
    assert.ok(m.lines.length > 0, id);
    for (const k of m.lines) assert.ok(lines.has(k), `module "${id}" points at unknown line "${k}"`);
  }
});

test("every website line is backed by a module, or is listed as not a module", () => {
  const mapped = new Set(Object.values(MODULE_LINES).flatMap((m) => m.lines));
  for (const k of NOT_A_MODULE) {
    assert.ok(lines.has(k), `NOT_A_MODULE names unknown line "${k}"`);
    assert.ok(!mapped.has(k), `"${k}" is mapped to a module, so it can't also be listed as not a module`);
  }
  for (const k of lines.keys()) assert.ok(mapped.has(k) || NOT_A_MODULE.includes(k), `line "${k}" has no module behind it`);
});

test("a module the platform hides is “coming soon” on the website", () => {
  for (const m of MODULES) {
    if (state(m) !== "hidden") continue;
    for (const k of MODULE_LINES[m.id].lines) {
      const backers = MODULES.filter((o) => MODULE_LINES[o.id]?.lines.includes(k));
      if (backers.some((o) => state(o) !== "hidden")) continue; // another module keeps the line real
      assert.equal(lines.get(k)!.status, "soon", `"${k}" says ${lines.get(k)!.status}, but its module "${m.id}" is hidden`);
    }
  }
});

test("a line the website offers has a module behind it that is switched on", () => {
  for (const [k, item] of lines) {
    if (item.status === "soon" || NOT_A_MODULE.includes(k)) continue;
    const backers = MODULES.filter((m) => MODULE_LINES[m.id].lines.includes(k));
    assert.ok(backers.some((m) => state(m) !== "hidden"), `"${k}" says ${item.status}, but every module behind it is hidden`);
    if (item.status === "live") {
      for (const m of backers) assert.notEqual(state(m), "beta", `"${k}" says live, but "${m.id}" is still in beta`);
    }
  }
});

test("a line that is “soon” while its module is switched on says why", () => {
  for (const m of MODULES) {
    if (state(m) === "hidden") continue;
    const soon = MODULE_LINES[m.id].lines.filter((k) => lines.get(k)!.status === "soon");
    if (soon.length) assert.ok(MODULE_LINES[m.id].soonBecause?.trim(), `"${m.id}" is switched on, but the website says ${soon.join(", ")} is coming soon: say why in soonBecause, or update the line`);
  }
});
