// Admin → System check, "Encryption keys": one row per key list, from
// lib/crypto-health.ts (where the rows themselves are tested: state and key
// ids, never a key). This pins that the page's data source includes them and
// that the page shows a row's name, state and words and nothing else of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { cryptoCheckRows } from "../lib/crypto-health.ts";
import type { Check } from "../lib/setup-check.ts";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("runSetupChecks() adds the key lists' rows, from this server's own environment", () => {
  const checks = source("../lib/setup-check.ts");
  assert.match(checks, /import \{ cryptoCheckRows \} from "\.\/crypto-health"/);
  assert.match(checks, /checks\.push\(\.\.\.cryptoCheckRows\(\)\)/);
});

test("a row is a System check row: a missing list is 'Needs fixing' (red), and it carries key ids but no key", () => {
  const key = randomBytes(32).toString("base64");
  const rows: Check[] = cryptoCheckRows({ PUSH_KEKS: `p2:${key},p1:${randomBytes(32).toString("base64")}` });
  const push = rows.find((r) => r.name === "PUSH_KEKS")!;
  assert.deepEqual([push.area, push.status], ["Encryption keys", "ok"]);
  assert.match(push.detail, /p2, p1/);
  assert.equal(rows.find((r) => r.name === "JUNIORS_KEKS")!.status, "fail");
  assert.ok(!JSON.stringify(rows).includes(key) && !JSON.stringify(rows).includes(key.slice(0, 12)));
  // The page shows each row's name, its state's badge, its detail and its fix: all of them words made in crypto-health.ts.
  const page = source("../app/admin/(console)/setup/page.tsx");
  for (const shown of ["c.name", "LOOK[c.status]", "c.detail", "c.fix"]) assert.ok(page.includes(shown), shown);
  assert.match(page, /fail: \{ label: "Needs fixing", tone: "bad" \}/);
});
