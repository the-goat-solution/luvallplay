// Phase 3b step 2: the Juniors module and its switch (build plan §6.8; test
// plan §3.17, the permission-matrix rows for who may switch it on).
//
// Juniors holds children's information, so it differs from every other
// module, and each difference is tested here:
//
// - it ships hidden: the ordinary switch and the platform's lock can't turn
//   it on, and in production nothing can;
// - it fails closed: unreadable switches, a row without the owner's
//   acknowledgement, or a hidden deployment all mean off;
// - switching it on needs an owner, a sign-in code from the last few minutes
//   and the current safeguarding policy acknowledged.
//
// Made-up people only (the golden seed); no child is created here.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { MODULES, THREE_WOLVES } from "@luvallplay/modules";
import { migrate } from "../scripts/db/migrate.mjs";
import { getAccess } from "../lib/admin-roles.ts";
import { enabledModules, listClubModules, moduleBlocking, resetClubModulesCache, setClubModule, setModuleLock } from "../lib/club-modules.ts";
import { DEFAULT_PUBLIC_CLUB, publicClub } from "../lib/club-public.ts";
import { DEFAULT_CLUB_CONFIG } from "../lib/club-config.ts";
import {
  JUNIORS_STEP_UP_MAX_AGE_MS,
  juniorsAvailability,
  juniorsOn,
  juniorsState,
  switchJuniorsOff,
  switchJuniorsOn,
  type JuniorsSwitchOutcome,
} from "../lib/juniors/module.ts";
import { SAFEGUARDING_POLICY, SAFEGUARDING_POLICY_VERSION } from "../lib/juniors/safeguarding-policy.ts";
import { scopePool } from "../lib/tenant-scope.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `juniors_module_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");

const OPEN = { JUNIORS_AVAILABILITY: "available" };

test("where Juniors is offered: the manifest decides in production; an override opens it only elsewhere", () => {
  assert.equal(juniorsAvailability({}), "hidden");
  assert.equal(juniorsAvailability({ JUNIORS_AVAILABILITY: "available" }), "available");
  assert.equal(juniorsAvailability({ JUNIORS_AVAILABILITY: " Beta " }), "beta");
  assert.equal(juniorsAvailability({ JUNIORS_AVAILABILITY: "yes" }), "hidden", "an unknown word changes nothing");
  assert.equal(juniorsAvailability({ VERCEL_ENV: "preview", JUNIORS_AVAILABILITY: "available" }), "available");
  assert.equal(juniorsAvailability({ VERCEL_ENV: "production", JUNIORS_AVAILABILITY: "available" }), "hidden", "production ignores the override");
});

test("the safeguarding policy: a version, and every point in English and Vietnamese", () => {
  assert.match(SAFEGUARDING_POLICY_VERSION, /^\d{4}-\d{2}$/);
  assert.ok(SAFEGUARDING_POLICY.length >= 5);
  assert.equal(new Set(SAFEGUARDING_POLICY.map((p) => p.id)).size, SAFEGUARDING_POLICY.length);
  for (const p of SAFEGUARDING_POLICY) assert.ok(p.en.trim().length > 20 && p.vi.trim().length > 20, p.id);
});

test("the browser's fallback list of modules never includes a hidden one", () => {
  assert.ok(!DEFAULT_PUBLIC_CLUB.modules.includes("juniors"));
  assert.ok(!publicClub(DEFAULT_CLUB_CONFIG).modules.includes("juniors"));
  assert.ok(!publicClub(DEFAULT_CLUB_CONFIG).modules.includes("forms-waivers"));
  assert.ok(DEFAULT_PUBLIC_CLUB.modules.includes("arena"));
});

describe("the Juniors switch, from the database", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let pool: pg.Pool;
  let club2 = 0;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  // The seed's accounts: 1 is an owner and a platform admin, 2 an admin, 3 a member.
  const P = { ownerAndStaff: 1, admin: 2, member: 3, coach: 4, otherClubOwner: 5, staff: 6, owner: 7 };
  const NOW = Date.parse("2026-11-26T02:00:00Z");
  const fresh = new Date(NOW - 60_000);
  const warnings: string[] = [];
  const originalWarn = console.warn;

  // A person's role is read as the app reads it for this club (club 1): a role in another club is no role here.
  const actorFor = async (playerId: number, signedInAt: Date | null = fresh) => ({ playerId, access: await getAccess(scopePool(pool, async () => 1), playerId), signedInAt });
  const tryOn = async (playerId: number, over: { acknowledged?: boolean; policyVersion?: string; signedInAt?: Date | null; env?: Record<string, string | undefined>; slug?: string } = {}): Promise<JuniorsSwitchOutcome> =>
    switchJuniorsOn(
      c,
      { actor: await actorFor(playerId, over.signedInAt === undefined ? fresh : over.signedInAt), acknowledged: over.acknowledged ?? true, policyVersion: over.policyVersion ?? SAFEGUARDING_POLICY_VERSION },
      { now: NOW, env: over.env ?? OPEN, slug: over.slug },
    );
  const code = (r: JuniorsSwitchOutcome) => (r.ok ? "ok" : r.code);
  const rowsFor = async (tenantId = 1) =>
    Object.fromEntries((await c.query(`SELECT module_id, enabled, settings FROM tenant_modules WHERE tenant_id = $1 AND module_id IN ('juniors', 'forms-waivers')`, [tenantId])).rows.map((r) => [r.module_id, r]));
  const reset = async () => {
    await c.query(`DELETE FROM tenant_modules WHERE module_id IN ('juniors', 'forms-waivers')`);
    await c.query(`UPDATE tenants SET payment_mode = 'online' WHERE id = 1`);
    resetClubModulesCache();
  };

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.end();
    c = new pg.Client({ connectionString: urlFor(NAME) });
    await c.connect();
    await migrate(c, { log: () => {} });
    await c.query(SEED);
    club2 = (
      await c.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, 'free', incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
    await c.query(`INSERT INTO club_roles (player_id, role) VALUES ($1, 'coach'), ($2, 'owner')`, [P.coach, P.owner]);
    await c.query(`INSERT INTO club_roles (player_id, role, tenant_id) VALUES ($1, 'owner', $2)`, [P.otherClubOwner, club2]);
    await c.query(`INSERT INTO platform_admins (player_id) VALUES ($1)`, [P.staff]);
    pool = new pg.Pool({ connectionString: urlFor(NAME), max: 2 });
    console.warn = (...a: unknown[]) => warnings.push(a.join(" "));
  });
  after(async () => {
    console.warn = originalWarn;
    await pool?.end();
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });
  beforeEach(async () => {
    warnings.length = 0;
    await reset();
  });

  test("Three Wolves after the migrations: Juniors is off, has no row, and nothing about it is listed as on", async () => {
    assert.deepEqual(await rowsFor(), {});
    assert.deepEqual(await juniorsState(c, undefined, OPEN), { enabled: false, acknowledgement: null, on: false, policyOutOfDate: false });
    assert.equal(await juniorsOn(c, undefined, OPEN), false);
    const on = await enabledModules(c);
    assert.equal(on.has("juniors"), false);
    assert.equal(on.has("forms-waivers"), false);
    assert.equal(await moduleBlocking(c, "/admin/juniors/setup"), null, "the page that switches it on is served");
    assert.ok(!(THREE_WOLVES.modules as readonly string[]).includes("juniors"));
  });

  test("the ordinary switch and the platform's lock can't turn Juniors on, for an owner or for Luvallplay staff", async () => {
    for (const actor of ["owner", "platform-admin"] as const) {
      for (const moduleId of ["juniors", "forms-waivers"]) {
        const r = await setClubModule(c, { moduleId, on: true, actor, actorPlayerId: P.ownerAndStaff });
        assert.ok(!r.ok && /isn't available right now/.test(r.reason), `${actor} ${moduleId}: ${JSON.stringify(r)}`);
      }
    }
    const locked = await setModuleLock(c, { moduleId: "juniors", lock: "on", reason: "pilot", actor: "platform-admin", actorPlayerId: P.staff });
    assert.ok(!locked.ok && /isn't available right now/.test(locked.reason));
    assert.deepEqual(await rowsFor(), {});
  });

  test("who may switch Juniors on: an owner of this club, and nobody else", async () => {
    const expected: [keyof typeof P, string][] = [
      ["member", "not_owner"],
      ["coach", "not_owner"],
      ["admin", "not_owner"],
      ["staff", "not_owner"], // Luvallplay staff can't acknowledge a club's policy for it
      ["otherClubOwner", "not_owner"], // an owner of another club has no role here
      ["owner", "ok"],
    ];
    for (const [who, want] of expected) {
      await reset();
      assert.equal(code(await tryOn(P[who])), want, who);
      assert.equal(await juniorsOn(c, undefined, OPEN), want === "ok", who);
    }
  });

  test("what an owner needs: the box ticked, the current policy, a code from the last few minutes, and a deployment that offers Juniors", async () => {
    assert.equal(code(await tryOn(P.owner, { acknowledged: false })), "not_acknowledged");
    assert.equal(code(await tryOn(P.owner, { policyVersion: "2020-01" })), "policy_changed");
    assert.equal(code(await tryOn(P.owner, { policyVersion: "" })), "policy_changed");
    assert.equal(code(await tryOn(P.owner, { signedInAt: new Date(NOW - JUNIORS_STEP_UP_MAX_AGE_MS - 1000) })), "step_up");
    assert.equal(code(await tryOn(P.owner, { signedInAt: new Date(NOW - 11 * 60 * 60 * 1000) })), "step_up", "the admin's 12-hour window isn't enough");
    assert.equal(code(await tryOn(P.owner, { signedInAt: null })), "step_up");
    assert.equal(code(await tryOn(P.owner, { signedInAt: new Date(NOW + 10 * 60_000) })), "step_up", "a sign-in from the future isn't fresh");
    assert.equal(code(await tryOn(P.owner, { env: {} })), "unavailable", "hidden unless the deployment opens it");
    assert.equal(code(await tryOn(P.owner, { env: { VERCEL_ENV: "production", JUNIORS_AVAILABILITY: "available" } })), "unavailable", "never in production while it ships dark");
    assert.deepEqual(await rowsFor(), {}, "none of the refusals wrote anything");
    assert.equal(code(await tryOn(P.owner, { signedInAt: new Date(NOW - JUNIORS_STEP_UP_MAX_AGE_MS + 1000) })), "ok");
  });

  test("switched on: Forms & waivers comes on with it, the acknowledgement is stored, and its routes are served", async () => {
    assert.deepEqual(await tryOn(P.owner), { ok: true, changed: true });
    const rows = await rowsFor();
    assert.equal(rows["forms-waivers"].enabled, true);
    assert.equal(rows.juniors.enabled, true);
    assert.deepEqual(rows.juniors.settings, { safeguarding: { version: SAFEGUARDING_POLICY_VERSION, byPlayerId: P.owner, at: new Date(NOW).toISOString() } });
    assert.deepEqual(await juniorsState(c, undefined, OPEN), {
      enabled: true,
      acknowledgement: { version: SAFEGUARDING_POLICY_VERSION, byPlayerId: P.owner, at: new Date(NOW).toISOString() },
      on: true,
      policyOutOfDate: false,
    });
    assert.equal(await juniorsOn(c, undefined, OPEN), true);
    assert.equal((await enabledModules(c)).has("juniors"), true, "the cache was reset by the switch");
    assert.deepEqual(await tryOn(P.owner), { ok: true, changed: false }, "twice changes nothing");
    // Every other module is as it was.
    const others = (await listClubModules(c)).filter((m) => !["juniors", "forms-waivers"].includes(m.id));
    assert.ok(others.every((m) => m.enabled), "nothing else was switched");
    assert.equal(others.length, MODULES.length - 2);
  });

  test("fails closed: unreadable switches, a row nobody acknowledged, or a deployment that hides Juniors all mean off", async () => {
    const broken = { query: async () => Promise.reject(new Error("connection lost")) };
    assert.equal(await juniorsOn(broken, undefined, OPEN), false);
    assert.ok(warnings.some((w) => w.includes("[juniors]")), "and it is logged");
    await assert.rejects(juniorsState(broken, undefined, OPEN));

    // Someone writes the row by hand, without an acknowledgement.
    await c.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled, enabled_at) VALUES (1, 'forms-waivers', true, now()), (1, 'juniors', true, now())`);
    assert.equal(await juniorsOn(c, undefined, OPEN), false);
    for (const bad of [{ safeguarding: {} }, { safeguarding: { version: "", byPlayerId: 7, at: "x" } }, { safeguarding: { version: "2026-11", byPlayerId: "7", at: "2026-11-26T02:00:00.000Z" } }, { safeguarding: "yes" }]) {
      await c.query(`UPDATE tenant_modules SET settings = $1::jsonb WHERE tenant_id = 1 AND module_id = 'juniors'`, [JSON.stringify(bad)]);
      assert.equal(await juniorsOn(c, undefined, OPEN), false, JSON.stringify(bad));
    }

    await reset();
    assert.equal(code(await tryOn(P.owner)), "ok");
    assert.equal(await juniorsOn(c, undefined, OPEN), true);
    assert.equal(await juniorsOn(c, undefined, {}), false, "on in the table, hidden on this deployment");
    assert.equal(await juniorsOn(c, undefined, { VERCEL_ENV: "production", JUNIORS_AVAILABILITY: "available" }), false);
    assert.equal(await juniorsOn(c, "no-such-club", OPEN), false);
  });

  test("a changed policy: the club is asked again, and Juniors stays on meanwhile", async () => {
    assert.equal(code(await tryOn(P.owner)), "ok");
    await c.query(`UPDATE tenant_modules SET settings = jsonb_set(settings, '{safeguarding,version}', '"2025-01"') WHERE tenant_id = 1 AND module_id = 'juniors'`);
    const stale = await juniorsState(c, undefined, OPEN);
    assert.deepEqual([stale.on, stale.policyOutOfDate], [true, true]);
    assert.equal(code(await tryOn(P.admin)), "not_owner", "still only an owner");
    assert.deepEqual(await tryOn(P.ownerAndStaff), { ok: true, changed: true });
    const state = await juniorsState(c, undefined, OPEN);
    assert.deepEqual([state.on, state.policyOutOfDate, state.acknowledgement?.byPlayerId], [true, false, P.ownerAndStaff]);
  });

  test("the registry's rules still hold: a platform lock stops an owner; Free play clubs can have Juniors", async () => {
    await c.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled, locked, lock_reason) VALUES (1, 'juniors', false, 'off', 'Waiting for the safeguarding review')`);
    resetClubModulesCache();
    const refused = await tryOn(P.owner);
    assert.ok(!refused.ok && refused.code === "unavailable" && /locked by Luvallplay/.test(refused.reason), JSON.stringify(refused));
    assert.equal(await juniorsOn(c, undefined, OPEN), false);

    await reset();
    await c.query(`UPDATE tenants SET payment_mode = 'free' WHERE id = 1`);
    assert.equal(code(await tryOn(P.owner)), "ok");
  });

  test("one club's switch is its own: another club's rows and state don't change", async () => {
    assert.equal(code(await tryOn(P.owner)), "ok");
    assert.deepEqual(await rowsFor(club2), {});
    assert.equal(await juniorsOn(c, "hanoi-smash", OPEN), false);
    // The other club's owner switches theirs; this club's acknowledgement is untouched.
    const theirs = await switchJuniorsOn(
      c,
      { actor: { playerId: P.otherClubOwner, access: { role: "owner", platformAdmin: false }, signedInAt: fresh }, acknowledged: true, policyVersion: SAFEGUARDING_POLICY_VERSION },
      { now: NOW + 5000, env: OPEN, slug: "hanoi-smash" },
    );
    assert.deepEqual(theirs, { ok: true, changed: true });
    assert.equal((await rowsFor(club2)).juniors.settings.safeguarding.byPlayerId, P.otherClubOwner);
    assert.equal((await rowsFor(1)).juniors.settings.safeguarding.byPlayerId, P.owner);
  });

  test("switching off: owners and Luvallplay staff; data is kept, the acknowledgement is not, and on again asks again", async () => {
    assert.equal(code(await tryOn(P.owner)), "ok");
    const kids = async () => (await c.query(`SELECT (SELECT count(*) FROM junior_profiles)::int AS profiles, (SELECT count(*) FROM guardianships)::int AS guardians`)).rows[0];
    await c.query(`INSERT INTO junior_profiles (tenant_id, guardian_user_id, name, birth_year) VALUES (1, $1, 'Test Child', 2016)`, [P.member]);
    await c.query(`INSERT INTO guardianships (guardian_user_id, junior_profile_id, consent_at) SELECT $1, id, now() FROM junior_profiles`, [P.member]);
    const before = await kids();
    try {
      for (const who of [P.member, P.coach, P.admin, P.otherClubOwner]) {
        assert.equal(code(await switchJuniorsOff(c, await actorFor(who))), "not_owner", String(who));
      }
      assert.equal(await juniorsOn(c, undefined, OPEN), true);
      assert.deepEqual(await switchJuniorsOff(c, await actorFor(P.owner)), { ok: true, changed: true });
      assert.equal(await juniorsOn(c, undefined, OPEN), false);
      assert.equal((await enabledModules(c)).has("juniors"), false);
      const rows = await rowsFor();
      assert.equal(rows.juniors.enabled, false);
      assert.deepEqual(rows.juniors.settings, {}, "the acknowledgement goes with the switch");
      assert.equal(rows["forms-waivers"].enabled, true, "Forms & waivers is left as it is");
      assert.deepEqual(await kids(), before, "nothing is deleted");
      assert.deepEqual(await switchJuniorsOff(c, await actorFor(P.staff)), { ok: true, changed: false });
      // On again: the same three things, every time.
      assert.equal(code(await tryOn(P.owner, { acknowledged: false })), "not_acknowledged");
      assert.equal(code(await tryOn(P.owner)), "ok");
      assert.deepEqual(await switchJuniorsOff(c, await actorFor(P.staff)), { ok: true, changed: true }, "Luvallplay staff can switch it off");
    } finally {
      await c.query(`DELETE FROM guardianships`);
      await c.query(`DELETE FROM junior_profiles`);
    }
  });
});
