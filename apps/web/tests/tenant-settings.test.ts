// Audit H1 and C7: on production, which club, how it is scoped and whose
// settings answer must each be said explicitly; nothing falls back quietly
// to Three Wolves or to "off". And a cached answer is never another club's.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DeploymentSettingsError,
  assertDeploymentSettings,
  deploymentSettingsProblems,
  settingsSourceSetting,
  tenantScopeSetting,
  tenantSlugSetting,
} from "../lib/tenant-settings.ts";
import { DEFAULT_CLUB_CONFIG, getClubConfig, resetClubConfigCache } from "../lib/club-config.ts";

const PROD = { VERCEL_ENV: "production", TENANT_SLUG: "three-wolves", TENANT_SCOPE: "shadow", CLUB_SETTINGS_SOURCE: "shadow" };

test("production with all three set: starts", () => {
  assert.deepEqual(deploymentSettingsProblems(PROD), []);
  assert.doesNotThrow(() => assertDeploymentSettings(PROD));
});

test("production refuses a missing TENANT_SLUG, TENANT_SCOPE or CLUB_SETTINGS_SOURCE (they used to mean Three Wolves, off, constants)", () => {
  for (const key of ["TENANT_SLUG", "TENANT_SCOPE", "CLUB_SETTINGS_SOURCE"] as const) {
    for (const missing of [undefined, "", "  "]) {
      const env = { ...PROD, [key]: missing };
      const problems = deploymentSettingsProblems(env);
      assert.equal(problems.length, 1, `${key}=${JSON.stringify(missing)}`);
      assert.match(problems[0], new RegExp(`${key} is not set`));
      assert.throws(() => assertDeploymentSettings(env), DeploymentSettingsError);
    }
  }
  assert.throws(() => tenantSlugSetting({ VERCEL_ENV: "production" }), DeploymentSettingsError);
  assert.throws(() => tenantScopeSetting({ VERCEL_ENV: "production" }), DeploymentSettingsError);
  assert.throws(() => settingsSourceSetting({ VERCEL_ENV: "production" }), DeploymentSettingsError);
});

test("off production the defaults stay: three-wolves, off, constants", () => {
  for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }]) {
    assert.equal(tenantSlugSetting(env), "three-wolves");
    assert.equal(tenantScopeSetting(env), undefined);
    assert.equal(settingsSourceSetting(env), "constants");
    assert.deepEqual(deploymentSettingsProblems(env), []);
  }
});

test("a mistyped value is refused, not read as the default", () => {
  assert.throws(() => settingsSourceSetting({ CLUB_SETTINGS_SOURCE: "databse" }), /expected constants, shadow or database/);
  assert.match(deploymentSettingsProblems({ ...PROD, TENANT_SCOPE: "enforced" }).join(), /TENANT_SCOPE is "enforced"/);
  assert.equal(settingsSourceSetting({ CLUB_SETTINGS_SOURCE: " Database " }), "database", "case and spaces don't matter");
});

test("another club can't run on the built-in settings: they are Three Wolves'", () => {
  for (const source of ["constants", "shadow"]) {
    const problems = deploymentSettingsProblems({ ...PROD, TENANT_SLUG: "hanoi-smash", CLUB_SETTINGS_SOURCE: source });
    assert.equal(problems.length, 1, source);
    assert.match(problems[0], /another club must use "database"/);
  }
  assert.deepEqual(deploymentSettingsProblems({ ...PROD, TENANT_SLUG: "hanoi-smash", CLUB_SETTINGS_SOURCE: "database" }), []);
  assert.match(deploymentSettingsProblems({ TENANT_SLUG: "hanoi-smash" }).join(), /another club/, "off production too");
});

// getClubConfig with a fake database.
function fakeDb(clubs: Record<string, { name: string; timezone: string; currency: string }>) {
  let reads = 0;
  return {
    reads: () => reads,
    query: async (text: string, params?: unknown[]) => {
      reads++;
      if (/FROM tenants/.test(text)) {
        const c = clubs[String(params?.[0])];
        return { rows: c ? [{ id: 7, slug: params?.[0], country: "VN", region: "han", languages: ["vi"], terms: {}, ...c }] : [] };
      }
      return { rows: [] };
    },
  };
}

test("club settings: another club reads its own, never Three Wolves' built-in ones, and the cache is per club", async () => {
  const saved = { slug: process.env.TENANT_SLUG, source: process.env.CLUB_SETTINGS_SOURCE };
  try {
    resetClubConfigCache();
    const db = fakeDb({ "hanoi-smash": { name: "Hanoi Smash", timezone: "Asia/Ho_Chi_Minh", currency: "VND" } });
    // Three Wolves on the built-in values: no read at all.
    delete process.env.TENANT_SLUG;
    process.env.CLUB_SETTINGS_SOURCE = "constants";
    assert.equal((await getClubConfig(db, 1000)).name, DEFAULT_CLUB_CONFIG.name);
    assert.equal(db.reads(), 0);
    // Another club, even with "constants": its stored settings answer.
    process.env.TENANT_SLUG = "hanoi-smash";
    const hanoi = await getClubConfig(db, 1001);
    assert.equal(hanoi.name, "Hanoi Smash");
    assert.equal(hanoi.currency, "VND");
    // Shadow for Three Wolves caches its answer; switching club doesn't reuse it.
    delete process.env.TENANT_SLUG;
    process.env.CLUB_SETTINGS_SOURCE = "shadow";
    resetClubConfigCache();
    assert.equal((await getClubConfig(db, 2000)).name, DEFAULT_CLUB_CONFIG.name);
    process.env.TENANT_SLUG = "hanoi-smash";
    assert.equal((await getClubConfig(db, 2001)).name, "Hanoi Smash", "within the minute, but another club: not the cached answer");
    // A club with no stored settings fails loudly instead of being served as Three Wolves.
    process.env.TENANT_SLUG = "nowhere";
    await assert.rejects(getClubConfig(db, 3000), /has no stored settings/);
  } finally {
    resetClubConfigCache();
    if (saved.slug === undefined) delete process.env.TENANT_SLUG;
    else process.env.TENANT_SLUG = saved.slug;
    if (saved.source === undefined) delete process.env.CLUB_SETTINGS_SOURCE;
    else process.env.CLUB_SETTINGS_SOURCE = saved.source;
  }
});
