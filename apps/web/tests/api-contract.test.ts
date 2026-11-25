// The players' app API contract (test plan §3.7; Phase 4 gate "contract
// tests"). No database needed.
//
// 1. The contract is snapshot-tested: removing or renaming a field, changing
//    a type or tightening a request fails here unless API_VERSION is bumped.
//    An additive change needs the snapshot refreshed
//    (pnpm --filter @luvallplay/api snapshot), so every change is reviewed.
// 2. The typed client is generated from the contract and is up to date.
// 3. Contract and route files match one to one, generated from the route
//    list: an endpoint without a route, or a route under /api/v1/app that the
//    contract doesn't describe, fails. Every route goes through the one
//    wrapper (lib/app-api.ts), which is what makes it validated,
//    rate-limited, authenticated and club-scoped.
// 4. The pure rules: breaking-change detection, the CORS allow-list, where a
//    session token is read from.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { API_PREFIX, API_VERSION, ENDPOINTS, fillPath } from "@luvallplay/api/contract";
import * as S from "@luvallplay/api/schemas";
import { breakingChanges, shapeOf } from "@luvallplay/api/shape";
import { contractBreaks, currentSnapshot, type ContractSnapshot } from "../../../packages/api/src/snapshot.ts";
import { generateClient, generateRoutes } from "../../../packages/api/scripts/generate.ts";
import { ROUTES } from "@luvallplay/api/routes";
import { MODULES, routeOwner } from "@luvallplay/modules";

const PKG = new URL("../../../packages/api/", import.meta.url);
const APP_API_DIR = new URL("../app/api/v1/app", import.meta.url).pathname;
const committed = JSON.parse(readFileSync(new URL("contract.snapshot.json", PKG), "utf8")) as ContractSnapshot;

describe("contract snapshot", () => {
  test("nothing released apps rely on was removed, renamed or tightened", () => {
    const breaks = contractBreaks(committed, currentSnapshot());
    assert.deepEqual(breaks, [], `breaking changes without a version bump (API ${API_VERSION}):\n${breaks.join("\n")}`);
  });

  test("the committed snapshot is current (run: pnpm --filter @luvallplay/api snapshot)", () => {
    assert.deepEqual(currentSnapshot(), committed);
  });

  test("the snapshot covers every endpoint and nothing else", () => {
    assert.deepEqual(Object.keys(committed.endpoints).sort(), Object.keys(ENDPOINTS).sort());
    assert.equal(committed.version, API_VERSION);
  });
});

describe("breaking-change detection", () => {
  const before = z.object({ id: z.number(), name: z.string(), nick: z.string().optional(), kind: z.enum(["a", "b"]), tags: z.array(z.object({ t: z.string() })) });
  const check = (after: z.ZodTypeAny, direction: "request" | "response") => breakingChanges(shapeOf(before), shapeOf(after), direction);

  test("response: adding a field is fine", () => {
    assert.deepEqual(check(before.extend({ extra: z.string() }), "response"), []);
  });
  test("response: removing, renaming, retyping, loosening and new enum values break", () => {
    assert.match(check(before.omit({ name: true }), "response").join(), /\.name: removed/);
    assert.match(check(before.omit({ name: true }).extend({ fullName: z.string() }), "response").join(), /\.name: removed/);
    assert.match(check(before.extend({ id: z.string() }), "response").join(), /\.id: type number → string/);
    assert.match(check(before.extend({ name: z.string().optional() }), "response").join(), /now optional/);
    assert.match(check(before.extend({ name: z.string().nullable() }), "response").join(), /can now be null/);
    assert.match(check(before.extend({ kind: z.enum(["a", "b", "c"]) }), "response").join(), /new value "c"/);
    assert.match(check(before.extend({ tags: z.array(z.object({ label: z.string() })) }), "response").join(), /\.tags\[\]\.t: removed/);
  });
  test("request: a new optional field is fine; a new required one, or an optional made required, breaks", () => {
    assert.deepEqual(check(before.extend({ extra: z.string().optional() }), "request"), []);
    assert.deepEqual(check(before.extend({ extra: z.string().nullish() }), "request"), []);
    assert.match(check(before.extend({ extra: z.string() }), "request").join(), /\.extra: new required field/);
    assert.match(check(before.extend({ nick: z.string() }), "request").join(), /was optional, now required/);
    assert.match(check(before.extend({ kind: z.enum(["a"]) }), "request").join(), /"b" no longer accepted/);
  });
  test("request: accepting more is fine", () => {
    assert.deepEqual(check(before.extend({ kind: z.enum(["a", "b", "c"]), name: z.string().optional() }), "request"), []);
  });
  test("a removed endpoint, a moved path and a public endpoint that now needs sign-in break; a version bump clears them", () => {
    const now = currentSnapshot();
    const without: ContractSnapshot = { ...now, endpoints: Object.fromEntries(Object.entries(now.endpoints).filter(([id]) => id !== "clubs.config")) };
    assert.match(contractBreaks(now, without).join(), /clubs\.config: endpoint removed/);
    const moved: ContractSnapshot = { ...now, endpoints: { ...now.endpoints, "clubs.list": { ...now.endpoints["clubs.list"], path: "/my-clubs" } } };
    assert.match(contractBreaks(now, moved).join(), /clubs\.list: GET \/clubs → GET \/my-clubs/);
    const locked: ContractSnapshot = { ...now, endpoints: { ...now.endpoints, "clubs.config": { ...now.endpoints["clubs.config"], auth: "session" } } };
    assert.match(contractBreaks(now, locked).join(), /now needs sign-in/);
    assert.deepEqual(contractBreaks(now, { ...without, version: "v2" }), []);
  });
});

describe("generated client", () => {
  test("client.gen.ts is what the generator writes (run: pnpm --filter @luvallplay/api generate)", () => {
    assert.equal(readFileSync(new URL("src/client.gen.ts", PKG), "utf8"), generateClient());
  });
  test("routes.gen.ts (the zod-free route table the client ships) is current and matches the contract", () => {
    assert.equal(readFileSync(new URL("src/routes.gen.ts", PKG), "utf8"), generateRoutes());
    assert.deepEqual(Object.keys(ROUTES).sort(), Object.keys(ENDPOINTS).sort());
    for (const [id, e] of Object.entries(ENDPOINTS)) assert.deepEqual(ROUTES[id as keyof typeof ROUTES], { method: e.method, path: e.path, auth: e.auth }, id);
  });
  test("the client doesn't import the schemas (the app's bundle carries no zod)", () => {
    for (const f of ["src/client.ts", "src/client.gen.ts", "src/routes.gen.ts"]) {
      const src = readFileSync(new URL(f, PKG), "utf8");
      assert.doesNotMatch(src, /^import (?!type)[^;]*from "(\.\/contract|\.\/schemas|zod)/m, f);
    }
  });
  test("it has one method per endpoint", () => {
    const src = generateClient();
    for (const id of Object.keys(ENDPOINTS)) assert.ok(src.includes(`transport.call("${id}"`), id);
  });
});

/** Route files under app/api/v1/app as contract paths ("/clubs/{club}/config"). */
function routeFiles(dir = APP_API_DIR, base = ""): { path: string; file: string }[] {
  const out: { path: string; file: string }[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full, `${base}/${name.replace(/^\[(.+)\]$/, "{$1}")}`));
    else if (name === "route.ts") out.push({ path: base, file: full });
  }
  return out;
}

describe("contract ↔ routes", () => {
  const files = routeFiles();
  const byPath = new Map(files.map((f) => [f.path, f.file]));

  test("every endpoint has a route file that serves its method through the wrapper, with a CORS preflight", () => {
    for (const [id, e] of Object.entries(ENDPOINTS)) {
      const file = byPath.get(e.path);
      assert.ok(file && existsSync(file), `${id}: no route file for ${API_PREFIX}${e.path}`);
      const src = readFileSync(file, "utf8");
      assert.ok(src.includes(`appRoute(\n  "${id}"`) || src.includes(`appRoute("${id}"`), `${id}: ${file} doesn't call appRoute("${id}")`);
      assert.match(src, new RegExp(`export (const|async function) ${e.method}\\b`), `${id}: ${file} doesn't export ${e.method}`);
      assert.match(src, /export const OPTIONS = \w+\.preflight;/, `${id}: no preflight`);
    }
  });

  test("every route file under /api/v1/app is in the contract, and exports nothing the contract doesn't name", () => {
    for (const f of files) {
      const here = Object.values(ENDPOINTS).filter((e) => e.path === f.path);
      assert.ok(here.length > 0, `${f.file} serves ${API_PREFIX}${f.path}, which the contract doesn't describe`);
      const exported = [...readFileSync(f.file, "utf8").matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]).sort();
      assert.deepEqual(exported, here.map((e) => e.method).sort(), f.file);
    }
  });

  test("no route under /api/v1/app reads the request on its own (validation lives in the wrapper)", () => {
    for (const f of files) {
      const src = readFileSync(f.file, "utf8");
      assert.doesNotMatch(src, /request\.json\(\)|request\.formData\(\)|searchParams/, f.file);
      assert.doesNotMatch(src, /\bsql`|sql\.query\(/, `${f.file}: queries belong in lib/repos`);
    }
  });

  test("club endpoints name the club in the path; account endpoints don't", () => {
    for (const [id, e] of Object.entries(ENDPOINTS)) {
      assert.equal(e.path.startsWith("/clubs/{club}/"), e.scope === "club", id);
      if (e.scope === "club") assert.ok("params" in e && e.params, `${id}: club endpoints validate {club}`);
    }
  });

  test("every endpoint has a rate limit, a response schema, and a module that exists when it names one", () => {
    const ids = new Set<string>(MODULES.map((m) => m.id));
    for (const [id, e] of Object.entries(ENDPOINTS)) {
      assert.ok(e.rateLimit.limit > 0 && e.rateLimit.windowMs >= 1000, id);
      assert.ok(e.response, id);
      const mod = (e as { module?: string }).module;
      if (mod) assert.ok(ids.has(mod), `${id}: unknown module ${mod}`);
      if (mod) assert.equal(e.scope, "club", `${id}: a module endpoint belongs to a club`);
    }
  });

  test("the proxy treats the app API as core, and its sign-in as the account", () => {
    assert.equal(routeOwner(`${API_PREFIX}/clubs`), "core");
    assert.equal(routeOwner(`${API_PREFIX}/clubs/three-wolves/config`), "core");
    assert.equal(routeOwner(`${API_PREFIX}/auth/email/start`), "account");
    // The older access-key API keeps its owner.
    assert.equal(routeOwner("/api/v1/me"), "integrations");
    assert.equal(routeOwner("/api/v1/leaderboard"), "integrations");
  });

  test("fillPath fills and escapes path parameters, and refuses a missing one", () => {
    assert.equal(fillPath("/clubs/{club}/config", { club: "three-wolves" }), "/clubs/three-wolves/config");
    assert.equal(fillPath("/x/{id}", { id: "a/b" }), "/x/a%2Fb");
    assert.throws(() => fillPath("/clubs/{club}/config", {}));
  });
});

describe("request validation (what the wrapper applies)", () => {
  const body = (id: keyof typeof ENDPOINTS) => (ENDPOINTS[id] as { body: z.ZodTypeAny }).body;
  test("sign-in bodies accept null for empty optional fields (browsers send null)", () => {
    assert.ok(body("auth.emailStart").safeParse({ email: "a@b.co", lang: null, turnstileToken: null }).success);
    assert.ok(body("auth.emailVerify").safeParse({ email: "a@b.co", code: "123456", phoneProof: null }).success);
    assert.ok(body("auth.smsVerify").safeParse({ sessionInfo: "x".repeat(20), code: "123456", purpose: null }).success);
    assert.ok(body("auth.logout").safeParse({}).success);
  });
  test("bad bodies are refused", () => {
    for (const bad of [null, [], "x", 1, {}, { email: "nope" }, { email: 5 }, { email: "a@b.co".padStart(400, "a") }]) {
      assert.equal(body("auth.emailStart").safeParse(bad).success, false, JSON.stringify(bad));
    }
    assert.equal(body("auth.emailVerify").safeParse({ email: "a@b.co", code: "1" }).success, false);
    assert.equal(body("auth.logout").safeParse({ all: "yes" }).success, false);
  });
  test("a club slug is lower-case words and hyphens only", () => {
    const params = (ENDPOINTS["clubs.config"] as { params: z.ZodTypeAny }).params;
    assert.ok(params.safeParse({ club: "three-wolves" }).success);
    for (const bad of ["Three-Wolves", "a b", "../x", "", "a--b", "x".repeat(80), "a/b"]) assert.equal(params.safeParse({ club: bad }).success, false, bad);
  });
});

describe("connected apps: the contract's lists match the website's", () => {
  // lib/webhooks.ts needs a database to import, so its lists are read from the file.
  const source = readFileSync(join(import.meta.dirname, "..", "lib", "webhooks.ts"), "utf8");
  const list = (name: string) => JSON.parse(`[${source.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))?.[1] ?? ""}]`);
  test("access-key permissions", () => assert.deepEqual([...S.API_SCOPES], list("SCOPES")));
  test("webhook events", () => assert.deepEqual([...S.WEBHOOK_EVENTS], list("EVENTS")));
});
