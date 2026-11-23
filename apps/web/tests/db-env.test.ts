import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Node-runtime middleware never runs instrumentation.ts, so it must pick the
// database itself. When it didn't, the admin check read the old database and
// owners couldn't get into admin.

test("db-env: importing it applies the database switch", async () => {
  const keep = { ...process.env };
  try {
    process.env.POSTGRES_URL = "postgres://u:p@old-pooler.us-east-1/db";
    process.env.SYD_POSTGRES_URL = "postgres://u:p@new-pooler.ap-southeast-2/db";
    process.env.DATABASE_URL_VAR = "SYD_POSTGRES_URL";
    delete process.env.VERCEL_ENV;
    await import("../lib/db-env.ts");
    assert.equal(process.env.POSTGRES_URL, "postgres://u:p@new-pooler.ap-southeast-2/db");
  } finally {
    process.env = keep;
  }
});

function firstImport(file: string): string | undefined {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  return src.match(/^import\s[^;]*;/m)?.[0];
}

test("db-env: the proxy (formerly middleware) imports it before anything else", () => {
  assert.equal(firstImport("proxy.ts"), 'import "@/lib/db-env";');
});

test("db-env: the admin access module imports it first too", () => {
  assert.equal(firstImport("lib/admin-access.ts"), 'import "./db-env";');
});
