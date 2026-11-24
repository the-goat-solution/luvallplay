// The shared packages are pure TypeScript: no Next.js, React, database or
// app imports, so any app (web today; the player app and Studio later) can use
// them. Only the declared workspace dependencies are allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const PACKAGES = new URL("../../../packages/", import.meta.url);
const ALLOWED: Record<string, string[]> = {
  core: [],
  auth: [],
  ui: [],
  modules: [],
  i18n: ["@luvallplay/core/"],
  // The API contract: zod schemas and a fetch client, nothing else.
  api: ["zod"],
};

for (const [pkg, allowed] of Object.entries(ALLOWED)) {
  test(`packages/${pkg} imports only its own files${allowed.length ? ` and ${allowed.join(", ")}` : ""}`, () => {
    const dir = new URL(`${pkg}/src/`, PACKAGES);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(new URL(file, dir), "utf8");
      for (const m of src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+"([^"]+)"/gm)) {
        const spec = m[1];
        assert.ok(spec.startsWith("./") || allowed.some((a) => spec.startsWith(a)), `${pkg}/src/${file} imports ${spec}`);
      }
    }
  });
}

test("the apps/web/lib files that moved are re-exports only", () => {
  const lib = new URL("../lib/", import.meta.url);
  for (const f of ["stats-periods", "ranks", "phone", "safe-next", "first-name"]) {
    const code = readFileSync(new URL(`${f}.ts`, lib), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("//"));
    assert.deepEqual(code, [`export * from "@luvallplay/core/${f}";`]);
  }
});
