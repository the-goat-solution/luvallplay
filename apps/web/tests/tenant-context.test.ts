// Audit H2: a scheduled job runs once for each active club of the region,
// each as that club, only where the job's module is on; one club's failure
// doesn't stop the others, and the scheduler still sees it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cronStatus, forEachClub, regionClubs, runAsClub } from "../lib/tenant-context.ts";
import { defaultTenantSlug } from "../lib/tenant-members.ts";
import { resetClubModulesCache } from "../lib/club-modules.ts";

type Club = { slug: string; region: string; status: string; off?: string[] };

/** Answers the two questions the loop asks: the region's clubs, and each club's switches. */
function fakeDb(clubs: Club[]) {
  return {
    query: async (text: string, params: unknown[] = []) => {
      if (/FROM tenants WHERE region/.test(text)) {
        return { rows: clubs.filter((c) => c.region === params[0] && c.status === "active").map((c) => ({ slug: c.slug })) };
      }
      if (/FROM tenant_modules/.test(text)) {
        const club = clubs.find((c) => c.slug === params[0]);
        const ids = ["memberships", "shop", "integrations", "finance", "calendar-sync"];
        return { rows: ids.map((id) => ({ module_id: id, enabled: !club?.off?.includes(id), locked: null, lock_reason: null, settings: {} })) };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

const CLUBS: Club[] = [
  { slug: "three-wolves", region: "syd", status: "active" },
  { slug: "auckland-smash", region: "syd", status: "active", off: ["memberships"] },
  { slug: "closing-club", region: "syd", status: "closed" },
  { slug: "hanoi-smash", region: "han", status: "active" },
];

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const set = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  for (const [k, v] of Object.entries(env)) set(k, v);
  resetClubModulesCache();
  return fn().finally(() => {
    for (const [k, v] of Object.entries(saved)) set(k, v);
    resetClubModulesCache();
  });
}

test("the region's active clubs, the deployment's own club always among them", async () => {
  await withEnv({ TENANT_SLUG: undefined, REGION: undefined }, async () => {
    assert.deepEqual(await regionClubs(fakeDb(CLUBS)), ["three-wolves", "auckland-smash"], "Sydney: active clubs only, never Hanoi's");
    assert.deepEqual(await regionClubs(fakeDb(CLUBS), "han"), ["three-wolves", "hanoi-smash"]);
    assert.deepEqual(await regionClubs(fakeDb([])), ["three-wolves"], "a club whose row has no region yet still runs its own jobs");
  });
});

test("each club's run is that club's: defaultTenantSlug() answers it, and only inside", async () => {
  await withEnv({ TENANT_SLUG: undefined, MODULES_CACHE_MS: "0" }, async () => {
    const seen: string[] = [];
    const runs = await forEachClub(fakeDb(CLUBS), "/api/cron/send-roster", async (club) => {
      await new Promise((r) => setTimeout(r, 1)); // across an await, still the same club
      seen.push(`${club}=${defaultTenantSlug()}`);
      return { ok: true };
    });
    assert.deepEqual(seen, ["three-wolves=three-wolves", "auckland-smash=auckland-smash"]);
    assert.equal(runs.length, 2);
    assert.equal(defaultTenantSlug(), "three-wolves", "outside the run: the deployment's club again");
    assert.equal(await runAsClub("x", async () => defaultTenantSlug()), "x");
  });
});

test("a club with the job's module off is skipped; the core's jobs always run", async () => {
  await withEnv({ TENANT_SLUG: undefined, MODULES_CACHE_MS: "0", MODULE_ENFORCEMENT: undefined }, async () => {
    const reminders = await forEachClub(fakeDb(CLUBS), "/api/cron/membership-reminders", async () => "sent");
    assert.deepEqual(
      reminders.map((r) => [r.club, r.ran]),
      [["three-wolves", true], ["auckland-smash", false]],
    );
    assert.deepEqual(reminders[1], { club: "auckland-smash", ran: false, skipped: "memberships is off" });
    // Memberships off doesn't stop webhook retries or roster attendance there (they used to ride on the reminders).
    for (const path of ["/api/cron/webhook-retries", "/api/cron/roster-attendance", "/api/cron/shop-upkeep"]) {
      const runs = await forEachClub(fakeDb(CLUBS), path, async () => "done");
      assert.deepEqual(runs.map((r) => r.ran), [true, true], path);
    }
  });
});

test("one club's failure doesn't stop the next, and the job reports it", async () => {
  await withEnv({ TENANT_SLUG: undefined, MODULES_CACHE_MS: "0" }, async () => {
    const runs = await forEachClub(fakeDb(CLUBS), "/api/cron/send-roster", async (club) => {
      if (club === "three-wolves") throw new Error("calendar down");
      return { ok: true };
    });
    assert.deepEqual(runs[0], { club: "three-wolves", ran: false, error: "calendar down" });
    assert.equal(runs[1].ran, true, "the next club still ran");
    assert.equal(cronStatus(runs), 500);
    assert.equal(cronStatus([{ club: "a", ran: true, result: { failed: true } }]), 503, "half of a job failed (sync-finance)");
    assert.equal(cronStatus([{ club: "a", ran: true, result: { ok: true } }, { club: "b", ran: false, skipped: "x is off" }]), 200);
  });
});
