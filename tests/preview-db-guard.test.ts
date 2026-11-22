// Test plan §9 Phase 0 gate: a preview write never reaches production.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDatabaseSwitch, databaseEndpoint, guardPreviewDatabase, previewDatabaseVerdict } from "../lib/db-switch.ts";

const PROD_POOLED = "postgres://u:p@ep-cool-sun-123456-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require";
const PROD_DIRECT = "postgres://u:p@ep-cool-sun-123456.ap-southeast-2.aws.neon.tech/neondb?sslmode=require";
const BRANCH = "postgres://u:p@ep-quiet-moon-987654-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require";

function previewEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    VERCEL_ENV: "preview",
    DATABASE_URL_VAR: "SYD_POSTGRES_URL",
    SYD_POSTGRES_URL: PROD_POOLED,
    SYD_POSTGRES_URL_NON_POOLING: PROD_DIRECT,
    ...extra,
  };
}

test("endpoint: pooled and direct hosts are the same database", () => {
  assert.equal(databaseEndpoint("ep-cool-sun-123456-pooler.ap-southeast-2.aws.neon.tech"), "ep-cool-sun-123456");
  assert.equal(databaseEndpoint("EP-COOL-SUN-123456.ap-southeast-2.aws.neon.tech"), "ep-cool-sun-123456");
});

test("preview on the production database: connection removed (fail closed without the marker)", () => {
  const env = previewEnv();
  // Same order as instrumentation.ts.
  const keep = { ...process.env };
  try {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, env);
    applyDatabaseSwitch();
    assert.equal(process.env.POSTGRES_URL, PROD_POOLED);
    const verdict = guardPreviewDatabase();
    assert.equal(verdict.blocked, true);
    assert.equal(process.env.POSTGRES_URL, undefined);
    assert.equal(process.env.POSTGRES_URL_NON_POOLING, undefined);
    assert.equal(process.env.SYD_POSTGRES_URL, undefined, "the switch target is removed too");
    assert.match(process.env.PREVIEW_DATABASE_BLOCKED ?? "", /PRODUCTION_DATABASE_HOSTS/);
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});

test("preview on the production database with the marker set: blocked", () => {
  const env = { ...previewEnv(), POSTGRES_URL: PROD_POOLED, PRODUCTION_DATABASE_HOSTS: "ep-cool-sun-123456.ap-southeast-2.aws.neon.tech" };
  const verdict = guardPreviewDatabase(env);
  assert.equal(verdict.blocked, true);
  assert.equal(env.POSTGRES_URL, undefined);
  assert.match(env.PREVIEW_DATABASE_BLOCKED ?? "", /production database/);
});

test("preview on its own Neon branch: database kept", () => {
  const env = { VERCEL_ENV: "preview", POSTGRES_URL: BRANCH, PRODUCTION_DATABASE_HOSTS: "ep-cool-sun-123456-pooler.ap-southeast-2.aws.neon.tech, ep-cool-sun-123456.ap-southeast-2.aws.neon.tech" };
  assert.deepEqual(guardPreviewDatabase(env), { blocked: false });
  assert.equal(env.POSTGRES_URL, BRANCH);
});

test("production, local and CI are never touched", () => {
  for (const VERCEL_ENV of ["production", undefined, "development"]) {
    const env = { VERCEL_ENV, POSTGRES_URL: PROD_POOLED };
    assert.deepEqual(previewDatabaseVerdict(env), { blocked: false });
    guardPreviewDatabase(env);
    assert.equal(env.POSTGRES_URL, PROD_POOLED);
  }
});

test("schema gate refuses DDL on a blocked preview", async () => {
  const keep = { ...process.env };
  try {
    process.env.VERCEL_ENV = "preview";
    process.env.POSTGRES_URL = PROD_POOLED;
    delete process.env.PRODUCTION_DATABASE_HOSTS;
    delete process.env.PREVIEW_DATABASE_BLOCKED;
    const { onceThisDeploy } = await import("../lib/schema-gate.ts");
    let ran = false;
    await assert.rejects(
      onceThisDeploy("test", async () => {
        ran = true;
      }),
      /switched off on this preview/,
    );
    assert.equal(ran, false, "the DDL never ran");
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});
