// Social plan, Task 3: who has access (lib/social/access.ts), opting in and
// profiles (profiles.ts), follows (follows.ts). Against a real Postgres, with
// two clubs, once as the database owner (TENANT_SCOPE=off) and once as the
// app's role for one club (TENANT_SCOPE=enforce). Made-up people only.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { COMMUNITY_RULES_VERSION, SOCIAL_LIMITS } from "@luvallplay/core/social";
import { migrate } from "../scripts/db/migrate.mjs";
import { block, unblock } from "../lib/moderation/blocks.ts";
import { fileReport } from "../lib/moderation/reports.ts";
import { moderationSeal } from "../lib/moderation/seal.ts";
import { suspend, unsuspend } from "../lib/moderation/suspensions.ts";
import { countOpenClubReports } from "../lib/moderation/attention.ts";
import { enabledModules, resetClubModulesCache } from "../lib/club-modules.ts";
import { socialAccess } from "../lib/social/access.ts";
import { getProfile, initialsOf, joinSocial, suggestDisplayName, updateProfile } from "../lib/social/profiles.ts";
import { follow, followCounts, unfollow } from "../lib/social/follows.ts";
import { newPublicId } from "../lib/social/public-id.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `social_profiles_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const key = () => randomBytes(32).toString("base64");
const NOT_FOUND = { ok: false, code: "not_found" } as const;
const OFF = { ok: false, code: "module_off" } as const;
const SUSPENDED = { ok: false, code: "suspended" } as const;
type TxClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; command?: string }>; release(destroy?: Error | boolean): void };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("initials come from the display name, never from the account's name", () => {
  assert.equal(initialsOf("Mia G"), "MG");
  assert.equal(initialsOf("smash queen of pioneer"), "SP");
  assert.equal(initialsOf("Quinn"), "Q");
  assert.equal(initialsOf("ế ữ"), "ẾỮ");
  assert.equal(initialsOf(""), "?");
});

test("the suggested display name is the first name and the last initial, and nothing when that can't be used", () => {
  assert.equal(suggestDisplayName("Mia", "Golden"), "Mia G");
  assert.equal(suggestDisplayName("  Linh ", "nguyễn"), "Linh N");
  assert.equal(suggestDisplayName("Quinn", ""), "Quinn");
  assert.equal(suggestDisplayName("", "Golden"), "");
  assert.equal(suggestDisplayName(null, undefined), "");
  const long = suggestDisplayName("x".repeat(80), "Young");
  assert.equal([...long].length, SOCIAL_LIMITS.displayName);
  assert.ok(long.endsWith(" Y"));
  assert.equal(suggestDisplayName("faggot", "Smith"), "", "a name the screen refuses isn't offered");
});

describe("opting in, profiles, follows and access", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const saved = { ...process.env };
  let admin: pg.Client;
  let database: typeof import("../lib/database.ts");
  let players: typeof import("../lib/player-db.ts");
  let club2 = 0;
  // Seed accounts in Three Wolves (club 1): 3 Mia (a phone number she never
  // verified), 4 Pete, 5 Quinn, 7 Sione (also in club 2), 8 Tama, 25 a deleted
  // account.
  const MIA = 3;
  const PETE = 4;
  const QUINN = 5;
  const SIONE = 7;
  const TAMA = 8;
  const DELETED = 25;
  // Hanoi Smash (club 2) only.
  let LINH = 0;
  let NAM = 0;
  const KEYS = { CONTACT_INDEX_KEYS: `i1:${key()}` };
  // How a test or a preview opens Social; production has only the pilot list.
  const ON = { SOCIAL_AVAILABILITY: "available", ...KEYS };
  const prod = (pilot: string) => ({ VERCEL_ENV: "production", SOCIAL_AVAILABILITY: "available", SOCIAL_PILOT_TENANTS: pilot, ...KEYS });
  const rows = async (text: string, params: unknown[] = []) => (await admin.query(text, params)).rows;
  const publicIds = new Map<number, string>();
  const pid = (playerId: number) => publicIds.get(playerId)!;
  const socialOn = (clubId: number, on: boolean) =>
    admin.query(
      `INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES ($1, 'social', $2) ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [clubId, on],
    );
  const follows = async () => (await rows(`SELECT follower_id || '>' || followee_id AS f FROM social_follows ORDER BY 1`)).map((r) => r.f);
  const profileRows = async () => (await rows(`SELECT player_id FROM social_profiles ORDER BY 1`)).map((r) => r.player_id);
  /** A new account in club 1, as someone who signed up on its site. */
  async function signUp(email: string, phone: string | null = null, verified = false) {
    const id = Number((await rows(`INSERT INTO players (email, first_name, last_name, phone_e164, phone_verified_at) VALUES ($1, 'Again', 'Person', $2, CASE WHEN $3 THEN now() END) RETURNING id`, [email, phone, verified]))[0].id);
    await admin.query(`INSERT INTO club_members (tenant_id, user_id, role, status) VALUES (1, $1, 'member', 'active')`, [id]);
    return id;
  }

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const root = new pg.Client({ connectionString: urlFor("postgres") });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await root.query(`CREATE DATABASE ${NAME}`);
    await root.end();
    admin = new pg.Client({ connectionString: urlFor(NAME) });
    await admin.connect();
    await migrate(admin, { log: () => {} });
    await admin.query(SEED);
    club2 = (
      await admin.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, payment_mode, incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
    [LINH, NAM] = (
      await admin.query(`INSERT INTO players (email, first_name, last_name) VALUES ('linh@hanoi.test', 'Linh', 'Nguyen'), ('nam@hanoi.test', 'Nam', 'Tran') RETURNING id`)
    ).rows.map((r) => Number(r.id));
    await admin.query(`INSERT INTO club_members (tenant_id, user_id, role, status) VALUES ($1, $2, 'member', 'active'), ($1, $3, 'member', 'active'), ($1, $4, 'member', 'active')`, [club2, LINH, NAM, SIONE]);
    process.env.POSTGRES_URL = urlFor(NAME);
    process.env.DATABASE_DRIVER = "postgres";
    process.env.TENANT_SLUG = "three-wolves";
    delete process.env.TENANT_SCOPE;
    delete process.env.APP_DATABASE_URL;
    delete process.env.CONTACT_KEKS;
    delete process.env.CONTACT_INDEX_KEYS;
    delete process.env.PII_READS;
    // Nothing in the process's own settings opens Social: every call below says how it is open.
    delete process.env.SOCIAL_AVAILABILITY;
    delete process.env.SOCIAL_PILOT_TENANTS;
    delete process.env.VERCEL_ENV;
    database = await import("../lib/database.ts");
    players = await import("../lib/player-db.ts");
  });
  after(async () => {
    await database?.closeDatabase();
    process.env = saved;
    await admin?.end();
    const root = new pg.Client({ connectionString: urlFor("postgres") });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await root.end();
  });

  test("no social table points at a junior profile: a child has no account, so nothing here can be about one", async () => {
    const refs = await rows(
      `SELECT c.conrelid::regclass::text AS t FROM pg_constraint c
       WHERE c.contype = 'f' AND c.confrelid = 'junior_profiles'::regclass AND c.conrelid::regclass::text ~ '^(social_|user_blocks|content_reports|moderation_|player_suspensions)'`,
    );
    assert.deepEqual(refs, []);
    assert.equal((await rows(`SELECT confrelid::regclass::text AS t FROM pg_constraint WHERE conname = 'social_profiles_player_id_fkey'`))[0].t, "players");
  });

  for (const mode of ["off", "enforce"] as const) {
    describe(`TENANT_SCOPE=${mode}`, () => {
      let db: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; connect: () => Promise<TxClient> };
      const input = (displayName: unknown, more: Record<string, unknown> = {}) => ({ displayName, visibility: "club", adultConfirmed: true, rulesVersion: COMMUNITY_RULES_VERSION, ...more });
      /** Opts a person in the real way and remembers their public id. */
      async function join(playerId: number, displayName: string, visibility: "club" | "everyone" = "club") {
        const r = await joinSocial(db, playerId, input(displayName, { visibility }), { env: ON });
        assert.equal(r.ok, true, `${displayName}: ${JSON.stringify(r)}`);
        if (r.ok) publicIds.set(playerId, r.value.publicId);
      }

      before(async () => {
        await database.closeDatabase();
        process.env.TENANT_SCOPE = mode;
        db = { query: (text, params) => database.sql.query(text, params), connect: () => database.sql.connect() };
      });
      beforeEach(async () => {
        await admin.query(`TRUNCATE content_reports, moderation_evidence, moderation_actions CASCADE`);
        await admin.query(`TRUNCATE social_follows, user_blocks, social_kudos, social_comments, social_posts, social_club_bans, social_profiles, player_suspensions`);
        await admin.query(`DELETE FROM tenant_modules WHERE module_id = 'social'`);
        await admin.query(`DELETE FROM club_members WHERE user_id = $1 AND tenant_id = 1`, [NAM]);
        await admin.query(`UPDATE club_members SET status = 'active' WHERE user_id IN ($1, $2, $3, $4, $5, $6, $7)`, [MIA, PETE, QUINN, SIONE, TAMA, LINH, NAM]);
        publicIds.clear();
        await socialOn(1, true);
        await socialOn(club2, true);
      });

      test("the connection is what the mode says", async () => {
        const who = (await db.query(`SELECT current_user AS role, current_setting('app.tenant_id', true) AS club, (SELECT count(*)::int FROM tenant_modules WHERE module_id = 'social') AS seen`)).rows[0];
        if (mode === "enforce") assert.deepEqual(who, { role: "luvallplay_app", club: "1", seen: 1 });
        else assert.equal(who.seen, 2);
      });

      test("access: the person's social clubs, their profile or null, and nobody who isn't a live account", async () => {
        assert.deepEqual(await socialAccess(db, MIA, ON), { ok: true, clubIds: [1], profile: null, rulesCurrent: false });
        assert.deepEqual(await socialAccess(db, LINH, ON), { ok: true, clubIds: [club2], profile: null, rulesCurrent: false }, "a club this connection isn't scoped to");
        assert.deepEqual(await socialAccess(db, SIONE, ON), { ok: true, clubIds: [1, club2], profile: null, rulesCurrent: false });
        await join(MIA, "Smash Queen");
        const mine = await socialAccess(db, MIA, ON);
        assert.ok(mine.ok);
        assert.deepEqual(Object.keys(mine.profile!).sort(), ["avatarUrl", "bio", "displayName", "joinedAt", "publicId", "visibility"]);
        assert.deepEqual({ ...mine.profile, joinedAt: "" }, { publicId: pid(MIA), displayName: "Smash Queen", bio: null, visibility: "club", avatarUrl: null, joinedAt: "" });
        assert.equal(mine.rulesCurrent, true);
        // Not an account, a deleted account, and something that isn't an id.
        for (const id of [999999, DELETED, 0, -1, 1.5, Number.NaN, "3" as unknown as number, null as unknown as number]) assert.deepEqual(await socialAccess(db, id, ON), OFF, String(id));
        // With nothing saying Social is open, it isn't: the club's row alone is not enough.
        assert.deepEqual(await socialAccess(db, MIA, {}), OFF);
        assert.deepEqual(await socialAccess(db, MIA, KEYS), OFF);
        assert.deepEqual(await socialAccess(db, MIA), OFF, "the process's own settings");
      });

      test("a junior profile never has access and can never hold a social profile", async () => {
        // A child's profile is not an account. Give it an id no account has, in a club with Social on.
        const junior = Number((await rows(`INSERT INTO junior_profiles (id, tenant_id, guardian_user_id, name, birth_year) VALUES (900001, 1, $1, 'Kiri', 2015) RETURNING id`, [MIA]))[0].id);
        try {
          assert.deepEqual(await socialAccess(db, junior, ON), OFF);
          assert.deepEqual(await joinSocial(db, junior, input("Kiri"), { env: ON }), OFF);
          assert.deepEqual(await updateProfile(db, junior, { bio: "hi" }, { env: ON }), OFF);
          await assert.rejects(
            admin.query(`INSERT INTO social_profiles (player_id, public_id, display_name, adult_confirmed_at, rules_version) VALUES ($1, $2, 'Kiri', now(), $3)`, [junior, newPublicId(), COMMUNITY_RULES_VERSION]),
            /social_profiles_player_id_fkey/,
          );
          // Their guardian is an adult's account like any other.
          assert.equal((await socialAccess(db, MIA, ON)).ok, true);
          assert.deepEqual(await profileRows(), []);
        } finally {
          await admin.query(`DELETE FROM junior_profiles WHERE id = $1`, [junior]);
        }
      });

      test("joining needs 18+ said as exactly true, the current rules, and a name and bio that pass", async () => {
        for (const adultConfirmed of [false, undefined, null, "true", 1, {}]) assert.deepEqual(await joinSocial(db, MIA, input("Mia G", { adultConfirmed }), { env: ON }), { ok: false, code: "adult_required" }, String(adultConfirmed));
        for (const rulesVersion of ["2025-01", "", undefined, null, 202612, ` ${COMMUNITY_RULES_VERSION}`]) assert.deepEqual(await joinSocial(db, MIA, input("Mia G", { rulesVersion }), { env: ON }), { ok: false, code: "rules_outdated" }, String(rulesVersion));
        for (const name of ["", "   ", "​", undefined, null, 42]) assert.deepEqual(await joinSocial(db, MIA, input(name), { env: ON }), { ok: false, code: "name_required" }, String(name));
        assert.deepEqual(await joinSocial(db, MIA, input("x".repeat(SOCIAL_LIMITS.displayName + 1)), { env: ON }), { ok: false, code: "name_too_long" });
        assert.deepEqual(await joinSocial(db, MIA, input("Mia G", { bio: "x".repeat(SOCIAL_LIMITS.bio + 1) }), { env: ON }), { ok: false, code: "bio_too_long" });
        // The screen: a word it rejects, one written to dodge it, and one it would only hold (a profile can't be held, so that is refused too).
        for (const name of ["faggot", "F4GG0T", "the faggots", "kys", "stupid bitch", "địt mẹ", "dit me"]) assert.deepEqual(await joinSocial(db, MIA, input(name), { env: ON }), { ok: false, code: "not_allowed" }, name);
        assert.deepEqual(await joinSocial(db, MIA, input("Mia G", { bio: "you whore" }), { env: ON }), { ok: false, code: "not_allowed" });
        for (const visibility of ["friends", "", undefined, null, "EVERYONE"]) assert.deepEqual(await joinSocial(db, MIA, input("Mia G", { visibility }), { env: ON }), { ok: false, code: "visibility_invalid" }, String(visibility));
        assert.deepEqual(await joinSocial(db, MIA, null as never, { env: ON }), { ok: false, code: "adult_required" });
        assert.deepEqual(await profileRows(), [], "a refused join writes nothing");
        // Access is asked first: with Social off the other mistakes are never looked at.
        assert.deepEqual(await joinSocial(db, MIA, input("", { adultConfirmed: false }), { env: {} }), OFF);

        const joined = await joinSocial(db, MIA, input("  Smash   Queen\n", { bio: " Fridays at Pioneer.  ", visibility: "everyone" }), { env: ON });
        assert.ok(joined.ok);
        assert.deepEqual(Object.keys(joined.value).sort(), ["avatarUrl", "bio", "displayName", "joinedAt", "publicId", "visibility"]);
        assert.match(joined.value.publicId, /^[0-9A-Za-z]{12}$/);
        assert.deepEqual({ ...joined.value, publicId: "", joinedAt: "" }, { publicId: "", displayName: "Smash Queen", bio: "Fridays at Pioneer.", visibility: "everyone", avatarUrl: null, joinedAt: "" });
        const row = (await rows(`SELECT player_id, rules_version, adult_confirmed_at > now() - interval '1 minute' AS just_now FROM social_profiles`))[0];
        assert.deepEqual(row, { player_id: MIA, rules_version: COMMUNITY_RULES_VERSION, just_now: true });
        // A blank bio is no bio; forty Vietnamese letters fit.
        assert.equal((await joinSocial(db, PETE, input("ế".repeat(SOCIAL_LIMITS.displayName), { bio: "   " }), { env: ON })).ok && true, true);
        assert.deepEqual((await rows(`SELECT bio, char_length(display_name) AS n FROM social_profiles WHERE player_id = $1`, [PETE]))[0], { bio: null, n: SOCIAL_LIMITS.displayName });
      });

      test("joining again keeps the profile as it is and records the rules accepted now", async () => {
        await join(MIA, "Smash Queen");
        const again = await joinSocial(db, MIA, input("Someone Else", { bio: "new", visibility: "everyone" }), { env: ON });
        assert.ok(again.ok);
        assert.deepEqual({ ...again.value, joinedAt: "" }, { publicId: pid(MIA), displayName: "Smash Queen", bio: null, visibility: "club", avatarUrl: null, joinedAt: "" });
        assert.deepEqual(await profileRows(), [MIA]);
        // The rules change: the person is asked again, and joining again is how they accept.
        await admin.query(`UPDATE social_profiles SET rules_version = '2025-01', adult_confirmed_at = now() - interval '1 year' WHERE player_id = $1`, [MIA]);
        const stale = await socialAccess(db, MIA, ON);
        assert.ok(stale.ok);
        assert.equal(stale.rulesCurrent, false);
        assert.equal(stale.profile?.displayName, "Smash Queen");
        assert.deepEqual(await joinSocial(db, MIA, input("Smash Queen", { rulesVersion: "2025-01" }), { env: ON }), { ok: false, code: "rules_outdated" });
        assert.equal((await joinSocial(db, MIA, input("Smash Queen"), { env: ON })).ok, true);
        const now = await socialAccess(db, MIA, ON);
        assert.ok(now.ok && now.rulesCurrent);
        assert.equal((await rows(`SELECT adult_confirmed_at < now() - interval '300 days' AS kept FROM social_profiles WHERE player_id = $1`, [MIA]))[0].kept, true, "when they first said 18+ is kept");
      });

      test("a public id that is already somebody's is drawn again", async () => {
        await join(MIA, "Smash Queen");
        const draws = [pid(MIA), pid(MIA), "Abcdefgh1234"];
        const second = await joinSocial(db, PETE, input("Pete the Smash"), { env: ON, newId: () => draws.shift()! });
        assert.ok(second.ok);
        assert.equal(second.value.publicId, "Abcdefgh1234");
        assert.deepEqual(draws, []);
        // If it never stops clashing, that is a broken system, not the person's mistake.
        await assert.rejects(joinSocial(db, QUINN, input("Quinn"), { env: ON, newId: () => pid(MIA) }), /social_profiles_public_id_key/);
        assert.deepEqual(await profileRows(), [MIA, PETE]);
      });

      test("changing your own profile: only what is given changes, through the same checks", async () => {
        assert.deepEqual(await updateProfile(db, MIA, { bio: "hello" }, { env: ON }), { ok: false, code: "not_joined" });
        await join(MIA, "Smash Queen", "everyone");
        const a = await updateProfile(db, MIA, { bio: "  Fridays  at Pioneer " }, { env: ON });
        assert.ok(a.ok);
        assert.deepEqual({ ...a.value, joinedAt: "" }, { publicId: pid(MIA), displayName: "Smash Queen", bio: "Fridays at Pioneer", visibility: "everyone", avatarUrl: null, joinedAt: "" });
        const b = await updateProfile(db, MIA, { displayName: "Mia the Wolf", visibility: "club" }, { env: ON });
        assert.ok(b.ok);
        assert.deepEqual([b.value.displayName, b.value.bio, b.value.visibility], ["Mia the Wolf", "Fridays at Pioneer", "club"]);
        const c = await updateProfile(db, MIA, { bio: null }, { env: ON });
        assert.ok(c.ok);
        assert.equal(c.value.bio, null);
        assert.equal((await updateProfile(db, MIA, {}, { env: ON })).ok, true);
        assert.deepEqual(await updateProfile(db, MIA, { displayName: "" }, { env: ON }), { ok: false, code: "name_required" });
        assert.deepEqual(await updateProfile(db, MIA, { displayName: "x".repeat(41) }, { env: ON }), { ok: false, code: "name_too_long" });
        assert.deepEqual(await updateProfile(db, MIA, { displayName: "kys" }, { env: ON }), { ok: false, code: "not_allowed" });
        assert.deepEqual(await updateProfile(db, MIA, { bio: "x".repeat(161) }, { env: ON }), { ok: false, code: "bio_too_long" });
        assert.deepEqual(await updateProfile(db, MIA, { bio: "send a wire transfer" }, { env: ON }), { ok: false, code: "not_allowed" });
        assert.deepEqual(await updateProfile(db, MIA, { visibility: "friends" }, { env: ON }), { ok: false, code: "visibility_invalid" });
        assert.deepEqual(await updateProfile(db, MIA, { bio: "hi" }, { env: {} }), OFF);
        assert.deepEqual((await rows(`SELECT display_name, bio, visibility FROM social_profiles WHERE player_id = $1`, [MIA]))[0], { display_name: "Mia the Wolf", bio: null, visibility: "club" });
      });

      test("a profile as others see it: display name and public id, never the real name, the email or the account's id", async () => {
        await join(MIA, "Smash Queen");
        await updateProfile(db, MIA, { bio: "Fridays at Pioneer" }, { env: ON });
        await join(PETE, "Pete the Smash");
        const seen = await getProfile(db, PETE, pid(MIA), { env: ON });
        assert.ok(seen.ok);
        assert.deepEqual(Object.keys(seen.value).sort(), ["avatarUrl", "bio", "displayName", "followedByMe", "followers", "following", "initials", "joinedAt", "mine", "publicId", "visibility"]);
        assert.deepEqual({ ...seen.value, joinedAt: "" }, { publicId: pid(MIA), displayName: "Smash Queen", initials: "SQ", bio: "Fridays at Pioneer", avatarUrl: null, joinedAt: "", followers: 0, following: 0, mine: false, followedByMe: false, visibility: null });
        const own = await getProfile(db, MIA, pid(MIA), { env: ON });
        assert.ok(own.ok);
        assert.deepEqual([own.value.mine, own.value.visibility], [true, "club"]);

        // Everything a person is sent about a profile, theirs or another's.
        const account = (await rows(`SELECT id, email, first_name, last_name, phone_e164 FROM players WHERE id = $1`, [MIA]))[0];
        assert.deepEqual([account.first_name, account.last_name], ["Mia", "Golden3"]);
        const access = await socialAccess(db, MIA, ON);
        const joinedAgain = await joinSocial(db, MIA, input("x"), { env: ON });
        for (const payload of [seen, own, access, joinedAgain, await updateProfile(db, MIA, {}, { env: ON })]) {
          const text = JSON.stringify(payload);
          for (const secret of [account.first_name, account.last_name, account.email, account.phone_e164]) assert.ok(!text.includes(secret), `${secret} in ${text}`);
          const walk = (v: unknown, path: string): void => {
            if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
              assert.doesNotMatch(k, /^(id|player_?id|first_?name|last_?name|email|phone.*)$/i, `${path}.${k}`);
              walk(x, `${path}.${k}`);
            } else if (path !== ".value.followers" && path !== ".value.following") assert.notEqual(v, account.id, `${path} is the account's id`);
          };
          walk(payload, "");
        }
      });

      test("who can see a profile: a `club` profile only from a shared club, an `everyone` profile from anywhere; a miss is the same as no such id", async () => {
        await join(MIA, "Smash Queen");
        await join(QUINN, "Quinn", "everyone");
        await join(SIONE, "Sione S");
        await join(LINH, "Linh N");
        await join(NAM, "Nam T", "everyone");
        const missing = await getProfile(db, LINH, newPublicId(), { env: ON });
        assert.deepEqual(missing, NOT_FOUND);
        assert.deepEqual(await getProfile(db, LINH, pid(MIA), { env: ON }), missing, "a `club` profile in another club");
        assert.deepEqual(await getProfile(db, MIA, pid(LINH), { env: ON }), missing);
        assert.equal((await getProfile(db, SIONE, pid(LINH), { env: ON })).ok, true, "Sione is in both clubs");
        assert.equal((await getProfile(db, SIONE, pid(MIA), { env: ON })).ok, true);
        assert.equal((await getProfile(db, LINH, pid(QUINN), { env: ON })).ok, true);
        assert.equal((await getProfile(db, MIA, pid(NAM), { env: ON })).ok, true);
        for (const bad of ["", "nope", String(MIA), null, undefined, 12, `${pid(MIA)}'`, { toString: () => pid(MIA) }]) assert.deepEqual(await getProfile(db, QUINN, bad, { env: ON }), missing, String(bad));
        // Someone who hasn't opted in can look (whether they may is socialAccess's call); someone who isn't an account sees nothing.
        assert.equal((await getProfile(db, PETE, pid(MIA), { env: ON })).ok, true);
        assert.deepEqual(await getProfile(db, 999999, pid(QUINN), { env: ON }), missing);
        assert.deepEqual(await getProfile(db, DELETED, pid(QUINN), { env: ON }), missing);
        // An author who goes from `everyone` to `club` is out of other clubs' sight on the next read.
        assert.equal((await updateProfile(db, QUINN, { visibility: "club" }, { env: ON })).ok, true);
        assert.deepEqual(await getProfile(db, LINH, pid(QUINN), { env: ON }), missing);
      });

      test("a block hides a profile both ways; a suspended or deleted person is out of sight", async () => {
        await join(MIA, "Smash Queen");
        await join(PETE, "Pete the Smash");
        await join(QUINN, "Quinn", "everyone");
        assert.deepEqual(await block(db, MIA, pid(PETE), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await getProfile(db, MIA, pid(PETE), { env: ON }), NOT_FOUND);
        assert.deepEqual(await getProfile(db, PETE, pid(MIA), { env: ON }), NOT_FOUND);
        assert.equal((await getProfile(db, QUINN, pid(PETE), { env: ON })).ok, true, "others still see both");
        assert.equal((await getProfile(db, QUINN, pid(MIA), { env: ON })).ok, true);

        assert.equal((await suspend(db, { playerId: QUINN, scope: "social", until: null, reasonCode: "harassment", actorId: 1 }, KEYS)).ok, true);
        assert.deepEqual(await getProfile(db, MIA, pid(QUINN), { env: ON }), NOT_FOUND);

        await admin.query(`INSERT INTO social_profiles (player_id, public_id, display_name, visibility, adult_confirmed_at, rules_version) VALUES ($1, 'Gone00000000', 'Gone', 'everyone', now(), $2)`, [DELETED, COMMUNITY_RULES_VERSION]);
        assert.deepEqual(await getProfile(db, MIA, "Gone00000000", { env: ON }), NOT_FOUND);
      });

      test("Review Focus 2: the club switches Social off, or the person leaves their last social club: `module_off`, out of sight, and every row stays", async () => {
        await join(MIA, "Smash Queen");
        await join(PETE, "Pete the Smash");
        await join(SIONE, "Sione S", "everyone");
        await join(LINH, "Linh N", "everyone");
        assert.deepEqual(await follow(db, PETE, pid(MIA), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await follow(db, MIA, pid(LINH), { env: ON }), { ok: true, value: null });
        const before = await rows(`SELECT * FROM social_profiles ORDER BY player_id`);

        // The club switches the module off.
        await socialOn(1, false);
        assert.deepEqual(await socialAccess(db, MIA, ON), OFF);
        assert.deepEqual(await socialAccess(db, PETE, ON), OFF);
        const sione = await socialAccess(db, SIONE, ON);
        assert.ok(sione.ok);
        assert.deepEqual(sione.clubIds, [club2], "Sione still has Hanoi Smash");
        assert.deepEqual(await getProfile(db, SIONE, pid(MIA), { env: ON }), NOT_FOUND, "Mia has disappeared from other people's view");
        assert.deepEqual(await getProfile(db, LINH, pid(MIA), { env: ON }), NOT_FOUND);
        assert.deepEqual(await getProfile(db, MIA, pid(MIA), { env: ON }), NOT_FOUND, "and from her own");
        assert.deepEqual(await getProfile(db, MIA, pid(LINH), { env: ON }), NOT_FOUND, "she sees nobody");
        assert.deepEqual(await follow(db, MIA, pid(SIONE), { env: ON }), NOT_FOUND);
        assert.deepEqual(await joinSocial(db, TAMA, input("Tama"), { env: ON }), OFF);
        assert.deepEqual(await updateProfile(db, MIA, { bio: "still here" }, { env: ON }), OFF);
        assert.equal((await getProfile(db, LINH, pid(SIONE), { env: ON })).ok, true, "Sione is still seen through the other club");
        assert.deepEqual(await rows(`SELECT * FROM social_profiles ORDER BY player_id`), before, "nothing was changed or deleted");
        assert.deepEqual(await follows(), [`${MIA}>${LINH}`, `${PETE}>${MIA}`]);
        // No row at all is the same as a row that says off.
        await admin.query(`DELETE FROM tenant_modules WHERE module_id = 'social' AND tenant_id = 1`);
        assert.deepEqual(await socialAccess(db, MIA, ON), OFF);
        // Back on: everything is where it was.
        await socialOn(1, true);
        const back = await socialAccess(db, MIA, ON);
        assert.ok(back.ok);
        assert.equal(back.profile?.publicId, pid(MIA));
        const again = await getProfile(db, PETE, pid(MIA), { env: ON });
        assert.ok(again.ok);
        assert.deepEqual([again.value.followers, again.value.following, again.value.followedByMe], [1, 1, true]);

        // The person leaves their last social club (the club disables them, or the membership row goes).
        await admin.query(`UPDATE club_members SET status = 'disabled' WHERE user_id = $1 AND tenant_id = 1`, [MIA]);
        assert.deepEqual(await socialAccess(db, MIA, ON), OFF);
        assert.deepEqual(await getProfile(db, PETE, pid(MIA), { env: ON }), NOT_FOUND);
        assert.deepEqual(await rows(`SELECT * FROM social_profiles ORDER BY player_id`), before);
        // Leaving one of two keeps the other.
        await admin.query(`UPDATE club_members SET status = 'disabled' WHERE user_id = $1 AND tenant_id = $2`, [SIONE, club2]);
        const one = await socialAccess(db, SIONE, ON);
        assert.ok(one.ok);
        assert.deepEqual(one.clubIds, [1]);
        assert.deepEqual(await getProfile(db, SIONE, pid(LINH), { env: ON }), { ok: true, value: (await getProfile(db, PETE, pid(LINH), { env: ON }) as { value: unknown }).value }, "an `everyone` profile is still seen from the club that is left");
      });

      test("the pilot list: in production a club that isn't listed is off even with its row on, and nothing else opens it", async () => {
        await join(MIA, "Smash Queen");
        await join(SIONE, "Sione S");
        await join(LINH, "Linh N");
        await join(NAM, "Nam T", "everyone");
        // Nothing listed: off for everyone, whatever SOCIAL_AVAILABILITY says (prod() sets it to "available").
        for (const id of [MIA, SIONE, LINH]) assert.deepEqual(await socialAccess(db, id, prod("")), OFF, String(id));
        assert.deepEqual(await getProfile(db, SIONE, pid(MIA), { env: prod("") }), NOT_FOUND);
        // Club 1 is the pilot. Hanoi Smash has its row on and is not.
        const pilot = prod("1");
        assert.deepEqual((await socialAccess(db, MIA, pilot)).ok, true);
        assert.deepEqual(await socialAccess(db, LINH, pilot), OFF);
        const sione = await socialAccess(db, SIONE, pilot);
        assert.ok(sione.ok);
        assert.deepEqual(sione.clubIds, [1]);
        assert.deepEqual(await joinSocial(db, LINH, input("Linh"), { env: pilot }), OFF);
        assert.equal((await getProfile(db, SIONE, pid(MIA), { env: pilot })).ok, true);
        assert.deepEqual(await getProfile(db, SIONE, pid(LINH), { env: pilot }), NOT_FOUND, "the club they share isn't a pilot club");
        assert.deepEqual(await getProfile(db, MIA, pid(NAM), { env: pilot }), NOT_FOUND, "an `everyone` profile whose only club isn't a pilot club");
        assert.deepEqual(await follow(db, MIA, pid(NAM), { env: pilot }), NOT_FOUND);
        // The id has to be the club's exactly.
        for (const list of [`${club2}1`, `1${club2}`, `0${club2}`, "hanoi-smash", "*", `${club2}.0`, "11"]) assert.deepEqual(await socialAccess(db, LINH, prod(list)), OFF, list);
        assert.deepEqual(await socialAccess(db, MIA, prod("11")), OFF, `"11" is not club 1`);
        const both = await socialAccess(db, SIONE, prod(` ${club2}, junk ,1 `));
        assert.ok(both.ok);
        assert.deepEqual(both.clubIds, [1, club2]);
        // Listed, but the club's own row is off: still off.
        await socialOn(1, false);
        assert.deepEqual(await socialAccess(db, MIA, pilot), OFF);
        // A role opens nothing: the club's owner and a platform admin are like anyone else.
        await socialOn(1, true);
        assert.deepEqual(await socialAccess(db, 1, prod("")), OFF, "Olivia owns the club");
        assert.deepEqual(await socialAccess(db, 1, prod(String(club2))), OFF);
      });

      test("a suspension from Social or from everything closes it; one from the Marketplace doesn't", async () => {
        await join(MIA, "Smash Queen");
        await join(PETE, "Pete the Smash");
        await join(QUINN, "Quinn");
        assert.equal((await suspend(db, { playerId: MIA, scope: "social", until: null, reasonCode: "harassment", actorId: 1 }, KEYS)).ok, true);
        assert.equal((await suspend(db, { playerId: PETE, scope: "market", until: null, reasonCode: "scam", actorId: 1 }, KEYS)).ok, true);
        assert.equal((await suspend(db, { playerId: QUINN, scope: "all", until: new Date(Date.now() + 86_400_000), reasonCode: "scam", actorId: 1 }, KEYS)).ok, true);
        assert.equal((await suspend(db, { playerId: TAMA, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, KEYS)).ok, true);
        assert.deepEqual(await socialAccess(db, MIA, ON), SUSPENDED);
        assert.deepEqual(await socialAccess(db, QUINN, ON), SUSPENDED);
        const pete = await socialAccess(db, PETE, ON);
        assert.ok(pete.ok, "a Marketplace suspension doesn't close Social");
        assert.equal(pete.profile?.displayName, "Pete the Smash");
        assert.equal((await updateProfile(db, PETE, { bio: "still here" }, { env: ON })).ok, true);
        assert.deepEqual(await updateProfile(db, MIA, { bio: "let me in" }, { env: ON }), SUSPENDED);
        assert.deepEqual(await joinSocial(db, MIA, input("Smash Queen"), { env: ON }), SUSPENDED);
        assert.deepEqual(await joinSocial(db, TAMA, input("Tama"), { env: ON }), SUSPENDED, "suspended before ever joining");
        assert.deepEqual(await profileRows(), [MIA, PETE, QUINN]);
        // With Social off for their club the answer is module_off, as for anyone.
        assert.deepEqual(await socialAccess(db, MIA, KEYS), OFF);
        // Lifted: back in.
        assert.equal((await unsuspend(db, { playerId: MIA, scope: "social", reasonCode: "appeal_upheld", actorId: 1 }, KEYS)).ok, true);
        assert.equal((await socialAccess(db, MIA, ON)).ok, true);
      });

      test("Review Focus 7: suspended, account deleted, signed up again with the same email or the same verified phone: still suspended", async () => {
        // A person of this test's own, with a verified phone number (each mode has its own: accounts are never truly removed).
        const email = `rua.returns.${mode}@golden.test`;
        const phone = mode === "off" ? "+64215559001" : "+64215559002";
        const first = await signUp(email, phone, true);
        const r = await joinSocial(db, first, input("Rua R"), { env: ON });
        assert.ok(r.ok);
        assert.equal((await suspend(db, { playerId: first, scope: "social", until: null, reasonCode: "harassment", actorId: 1 }, KEYS)).ok, true);
        assert.deepEqual(await socialAccess(db, first, ON), SUSPENDED);
        const suspensions = await rows(`SELECT * FROM player_suspensions ORDER BY id`);
        assert.equal(suspensions.length, 1);

        // The real way an account is deleted (lib/player-db.ts, as the app and the website call it).
        await players.deletePlayerAccount(first);
        assert.deepEqual((await rows(`SELECT email, phone_e164, deleted_at IS NOT NULL AS deleted FROM players WHERE id = $1`, [first]))[0], { email: `deleted-${first}@deleted.invalid`, phone_e164: null, deleted: true });
        assert.deepEqual(await rows(`SELECT * FROM player_suspensions ORDER BY id`), suspensions, "deleting the account leaves the suspension as it was");
        assert.deepEqual(await socialAccess(db, first, ON), OFF, "the deleted account itself is nobody");
        assert.deepEqual(await getProfile(db, MIA, r.value.publicId, { env: ON }), NOT_FOUND);

        // The same email again.
        const sameEmail = await signUp(email);
        assert.deepEqual(await socialAccess(db, sameEmail, ON), SUSPENDED);
        assert.deepEqual(await joinSocial(db, sameEmail, input("Fresh Start"), { env: ON }), SUSPENDED);
        // Written differently, it is the same address.
        await admin.query(`UPDATE players SET email = $2 WHERE id = $1`, [sameEmail, ` ${email.toUpperCase()}`]);
        assert.deepEqual(await joinSocial(db, sameEmail, input("Fresh Start"), { env: ON }), SUSPENDED);

        // Another email, the same phone number, verified.
        const samePhone = await signUp(`someone.new.${mode}@golden.test`, phone, true);
        assert.deepEqual(await socialAccess(db, samePhone, ON), SUSPENDED);
        assert.deepEqual(await joinSocial(db, samePhone, input("Fresh Start"), { env: ON }), SUSPENDED);

        // A number someone only typed isn't theirs: it neither suspends them nor tells them anything.
        await admin.query(`UPDATE players SET phone_e164 = NULL, phone_verified_at = NULL WHERE id = $1`, [samePhone]);
        const typed = await signUp(`typed.only.${mode}@golden.test`, phone, false);
        assert.equal((await joinSocial(db, typed, input("Typed Only"), { env: ON })).ok, true);
        assert.equal((await socialAccess(db, samePhone, ON)).ok, true, "without the number the second account isn't the old one");

        // And a stranger joins as usual.
        const stranger = await signUp(`stranger.${mode}@golden.test`);
        assert.equal((await joinSocial(db, stranger, input("Stranger"), { env: ON })).ok, true);
        assert.deepEqual(await profileRows(), [first, typed, stranger], "neither returning account got a profile");
        // The moderator lets the person back in; the lift is written against their new account.
        assert.equal((await unsuspend(db, { playerId: sameEmail, scope: "social", reasonCode: "appeal_upheld", actorId: 1 }, KEYS)).ok, true);
        assert.equal((await socialAccess(db, sameEmail, ON)).ok, true);
      });

      test("following: yourself is `self`, someone out of sight is `not_found`, twice is once, and the counts follow", async () => {
        await join(MIA, "Smash Queen");
        await join(PETE, "Pete the Smash");
        await join(QUINN, "Quinn", "everyone");
        await join(LINH, "Linh N");
        await join(NAM, "Nam T", "everyone");
        assert.deepEqual(await follow(db, MIA, pid(MIA), { env: ON }), { ok: false, code: "self" });
        assert.deepEqual(await follow(db, MIA, newPublicId(), { env: ON }), NOT_FOUND);
        assert.deepEqual(await follow(db, MIA, pid(LINH), { env: ON }), NOT_FOUND, "a `club` profile in another club");
        for (const bad of ["", null, undefined, MIA, String(PETE)]) assert.deepEqual(await follow(db, MIA, bad, { env: ON }), NOT_FOUND, String(bad));
        assert.deepEqual(await follow(db, 999999, pid(QUINN), { env: ON }), NOT_FOUND);
        assert.deepEqual(await follows(), []);

        assert.deepEqual(await follow(db, MIA, pid(PETE), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await follow(db, MIA, pid(PETE), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await follow(db, MIA, pid(NAM), { env: ON }), { ok: true, value: null }, "an `everyone` profile in another club");
        assert.deepEqual(await follow(db, LINH, pid(QUINN), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await follow(db, QUINN, pid(PETE), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await follows(), [`${MIA}>${NAM}`, `${MIA}>${PETE}`, `${QUINN}>${PETE}`, `${LINH}>${QUINN}`].sort());
        assert.deepEqual(await followCounts(db, PETE, { env: ON }), { followers: 2, following: 0 });
        assert.deepEqual(await followCounts(db, MIA, { env: ON }), { followers: 0, following: 2 });
        const pete = await getProfile(db, MIA, pid(PETE), { env: ON });
        assert.ok(pete.ok);
        assert.deepEqual([pete.value.followers, pete.value.following, pete.value.followedByMe], [2, 0, true]);
        assert.equal(((await getProfile(db, PETE, pid(MIA), { env: ON })) as { value: { followedByMe: boolean } }).value.followedByMe, false, "following isn't mutual");
        // A suspended follower isn't counted while suspended.
        await suspend(db, { playerId: QUINN, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, KEYS);
        assert.deepEqual(await followCounts(db, PETE, { env: ON }), { followers: 1, following: 0 });

        // Someone with access who hasn't opted in can't follow.
        assert.deepEqual(await follow(db, TAMA, pid(MIA), { env: ON }), { ok: false, code: "not_joined" });
        // With Social off for the follower there is nobody to find.
        assert.deepEqual(await follow(db, MIA, pid(PETE), { env: {} }), NOT_FOUND);

        // Unfollowing answers the same whether or not there was a follow, or a person.
        assert.deepEqual(await unfollow(db, MIA, pid(PETE)), { ok: true, value: null });
        assert.deepEqual(await unfollow(db, MIA, pid(PETE)), { ok: true, value: null });
        assert.deepEqual(await unfollow(db, MIA, newPublicId()), { ok: true, value: null });
        assert.deepEqual(await unfollow(db, MIA, "nope"), { ok: true, value: null });
        assert.deepEqual(await unfollow(db, MIA, pid(LINH)), { ok: true, value: null });
        assert.deepEqual(await follows(), [`${MIA}>${NAM}`, `${QUINN}>${PETE}`, `${LINH}>${QUINN}`].sort(), "only Mia's own follow of Pete went");
      });

      test("nobody follows across a block, either way", async () => {
        await join(MIA, "Smash Queen");
        await join(PETE, "Pete the Smash");
        await join(QUINN, "Quinn");
        assert.deepEqual(await follow(db, PETE, pid(MIA), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await block(db, MIA, pid(PETE), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await follows(), [], "the block removed the follow");
        assert.deepEqual(await follow(db, PETE, pid(MIA), { env: ON }), NOT_FOUND);
        assert.deepEqual(await follow(db, MIA, pid(PETE), { env: ON }), NOT_FOUND);
        assert.deepEqual(await follow(db, MIA, newPublicId(), { env: ON }), NOT_FOUND, "the same answer as nobody");
        assert.deepEqual(await follows(), []);
      });

      test("a block and a follow of the same two people at the same moment: one waits for the other, and no follow is left across the block", async () => {
        await join(MIA, "Smash Queen");
        await join(PETE, "Pete the Smash");
        /** A database whose transactions stop just before COMMIT until `open()` is called. */
        const held = () => {
          let open = () => {};
          let reached = () => {};
          const gate = new Promise<void>((r) => (open = r));
          const atCommit = new Promise<void>((r) => (reached = r));
          const connect = async () => {
            const c = await db.connect();
            return { query: async (text: string, params?: unknown[]) => { if (text === "COMMIT") { reached(); await gate; } return c.query(text, params); }, release: (e?: Error | boolean) => c.release(e) };
          };
          const inTime = Promise.race([atCommit, sleep(5000).then(() => Promise.reject(new Error("the work never reached its COMMIT: it isn't running in a transaction")))]);
          return { db: { query: db.query, connect }, open, atCommit: inTime };
        };
        const settled = async (p: Promise<unknown>) => Promise.race([p.then(() => true), sleep(200).then(() => false)]);
        const gates: (() => void)[] = [];
        const heldOpen = () => { const h = held(); gates.push(h.open); return h; };
        try {

        // The block has done its work and not yet committed; the follow arrives.
        const slowBlock = heldOpen();
        const blocking = block(slowBlock.db, MIA, pid(PETE), { env: ON });
        await slowBlock.atCommit;
        const following = follow(db, MIA, pid(PETE), { env: ON });
        assert.equal(await settled(following), false, "the follow waits for the block");
        slowBlock.open();
        assert.deepEqual(await blocking, { ok: true, value: null });
        assert.deepEqual(await following, NOT_FOUND);
        assert.deepEqual(await follows(), []);
        assert.deepEqual(await followCounts(db, PETE, { env: ON }), { followers: 0, following: 0 });
        assert.deepEqual(await unblock(db, MIA, pid(PETE)), { ok: true, value: null });
        assert.deepEqual(await follows(), [], "no follow comes back with the unblock");

        // The other way round: the follow is written and not yet committed; the block arrives.
        const slowFollow = heldOpen();
        const following2 = follow(slowFollow.db, PETE, pid(MIA), { env: ON });
        await slowFollow.atCommit;
        const blocking2 = block(db, MIA, pid(PETE), { env: ON });
        assert.equal(await settled(blocking2), false, "the block waits for the follow");
        slowFollow.open();
        assert.deepEqual(await following2, { ok: true, value: null });
        assert.deepEqual(await blocking2, { ok: true, value: null });
        assert.deepEqual(await follows(), [], "the block removed the follow it waited for");
        assert.deepEqual((await rows(`SELECT blocker_id, blocked_id FROM user_blocks`)), [{ blocker_id: MIA, blocked_id: PETE }]);
        // Other pairs don't wait for these two.
        await join(QUINN, "Quinn");
        const slow3 = heldOpen();
        const blocking3 = block(slow3.db, QUINN, pid(PETE), { env: ON });
        await slow3.atCommit;
        assert.deepEqual(await follow(db, QUINN, pid(MIA), { env: ON }), { ok: true, value: null });
        slow3.open();
        await blocking3;
        } finally {
          // A failed check must not leave a transaction waiting at its COMMIT.
          for (const open of gates) open();
        }
      });

      test("the counts leave out anyone a list wouldn't show: blocked, suspended, deleted, or with no social club left", async () => {
        await join(MIA, "Smash Queen");
        await join(PETE, "Pete the Smash");
        await join(QUINN, "Quinn");
        await join(TAMA, "Tama");
        await join(LINH, "Linh N", "everyone");
        await join(SIONE, "Sione S");
        for (const id of [PETE, QUINN, TAMA, SIONE]) assert.deepEqual(await follow(db, id, pid(MIA), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await follow(db, MIA, pid(LINH), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await follow(db, MIA, pid(PETE), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await followCounts(db, MIA, { env: ON }), { followers: 4, following: 2 });
        // A follow row left across a block (written by hand: the library can't make one).
        await admin.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [PETE, MIA]);
        assert.deepEqual(await followCounts(db, MIA, { env: ON }), { followers: 3, following: 1 });
        await suspend(db, { playerId: QUINN, scope: "all", until: null, reasonCode: "spam", actorId: 1 }, KEYS);
        assert.deepEqual(await followCounts(db, MIA, { env: ON }), { followers: 2, following: 1 });
        await admin.query(`UPDATE club_members SET status = 'disabled' WHERE user_id = $1`, [TAMA]);
        assert.deepEqual(await followCounts(db, MIA, { env: ON }), { followers: 1, following: 1 });
        // Linh's only club isn't a pilot club: she is out of sight, so she isn't counted.
        assert.deepEqual(await followCounts(db, MIA, { env: prod("1") }), { followers: 1, following: 0 });
        assert.deepEqual(await followCounts(db, MIA, { env: prod("") }), { followers: 0, following: 0 });
        await admin.query(`INSERT INTO social_profiles (player_id, public_id, display_name, adult_confirmed_at, rules_version) VALUES ($1, 'Gone00000000', 'Gone', now(), $2)`, [DELETED, COMMUNITY_RULES_VERSION]);
        await admin.query(`INSERT INTO social_follows (follower_id, followee_id) VALUES ($1, $2)`, [DELETED, MIA]);
        assert.deepEqual(await followCounts(db, MIA, { env: ON }), { followers: 1, following: 1 });
        const seen = await getProfile(db, SIONE, pid(MIA), { env: ON });
        assert.ok(seen.ok);
        assert.deepEqual([seen.value.followers, seen.value.following], [1, 1]);
      });

      test("Review Focus 6: a profile out of sight through the pilot list answers like no profile at all, for looking, following, blocking and reporting", async () => {
        await join(MIA, "Smash Queen");
        await join(LINH, "Linh N", "everyone");
        await join(SIONE, "Sione S");
        const pilot = prod("1");
        const nobody = "AAAAAAAAAAAA";
        const was = { ...process.env };
        const report = (targetId: unknown) => fileReport(db, moderationSeal({}), { reporterId: MIA, targetType: "profile", targetId, reason: "spam" });
        try {
          // fileReport's loaders read the deployment's own settings.
          Object.assign(process.env, pilot);
          for (const viewer of [MIA, SIONE]) {
            assert.deepEqual(await getProfile(db, viewer, pid(LINH), { env: pilot }), await getProfile(db, viewer, nobody, { env: pilot }));
            assert.deepEqual(await follow(db, viewer, pid(LINH), { env: pilot }), await follow(db, viewer, nobody, { env: pilot }));
            assert.deepEqual(await block(db, viewer, pid(LINH), { env: pilot }), await block(db, viewer, nobody, { env: pilot }));
            assert.deepEqual(await block(db, viewer, pid(LINH), { env: pilot }), NOT_FOUND);
          }
          assert.deepEqual(await report(pid(LINH)), await report(nobody));
          assert.deepEqual(await report(pid(LINH)), NOT_FOUND);
          assert.deepEqual(await rows(`SELECT 1 FROM user_blocks UNION ALL SELECT 1 FROM content_reports UNION ALL SELECT 1 FROM social_follows`), []);
          // The same calls reach someone in the pilot club.
          assert.equal((await report(pid(SIONE))).ok, true);
          assert.deepEqual((await rows(`SELECT club_id, queue FROM content_reports`)), [{ club_id: 1, queue: "club" }], "and the report's club is the pilot club they share");
          assert.deepEqual(await block(db, MIA, pid(SIONE), { env: pilot }), { ok: true, value: null });
          // A blocker whose own club isn't a pilot club finds nobody.
          assert.deepEqual(await block(db, LINH, pid(SIONE), { env: pilot }), NOT_FOUND);
          // Hanoi Smash joins the pilot: Linh is there.
          Object.assign(process.env, prod(`1,${club2}`));
          assert.deepEqual(await block(db, MIA, pid(LINH), { env: prod(`1,${club2}`) }), { ok: true, value: null });
        } finally {
          process.env = was;
        }
      });

      test("a viewer who may not use Social sees and follows nobody", async () => {
        await join(MIA, "Smash Queen");
        await join(PETE, "Pete the Smash");
        await suspend(db, { playerId: PETE, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, KEYS);
        assert.deepEqual(await getProfile(db, PETE, pid(MIA), { env: ON }), NOT_FOUND);
        assert.deepEqual(await getProfile(db, PETE, pid(PETE), { env: ON }), NOT_FOUND, "not their own either: they are told `suspended` by socialAccess");
        assert.deepEqual(await follow(db, PETE, pid(MIA), { env: ON }), NOT_FOUND);
        assert.deepEqual(await follows(), []);
      });

      test("a person banned in every club they share with someone can't follow them", async () => {
        // Nam joins Three Wolves too, so Sione and Nam share both clubs.
        await admin.query(`INSERT INTO club_members (tenant_id, user_id, role, status) VALUES (1, $1, 'member', 'active')`, [NAM]);
        await join(MIA, "Smash Queen");
        await join(PETE, "Pete the Smash");
        await join(SIONE, "Sione S");
        await join(LINH, "Linh N", "everyone");
        await join(NAM, "Nam T");
        const ban = (clubId: number, playerId: number) => admin.query(`INSERT INTO social_club_bans (club_id, player_id, created_by) VALUES ($1, $2, 1)`, [clubId, playerId]);
        await ban(1, SIONE);
        assert.deepEqual(await follow(db, SIONE, pid(MIA), { env: ON }), NOT_FOUND, "the only club they share has banned Sione");
        assert.deepEqual(await follow(db, SIONE, pid(NAM), { env: ON }), { ok: true, value: null }, "they also share a club that hasn't");
        assert.deepEqual(await follow(db, SIONE, pid(LINH), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await follow(db, MIA, pid(SIONE), { env: ON }), { ok: true, value: null }, "the ban is on Sione, not on following Sione");
        await admin.query(`DELETE FROM social_follows`);
        await ban(club2, SIONE);
        assert.deepEqual(await follow(db, SIONE, pid(NAM), { env: ON }), NOT_FOUND, "banned in both");
        assert.deepEqual(await follow(db, SIONE, pid(LINH), { env: ON }), NOT_FOUND);
        // Someone else's ban, and a ban in a club the two don't share, change nothing.
        await ban(club2, PETE);
        assert.deepEqual(await follow(db, PETE, pid(MIA), { env: ON }), { ok: true, value: null });
        // Banned at home, following an `everyone` profile in a club they aren't in: there is no shared club to be banned from.
        await ban(1, PETE);
        assert.deepEqual(await follow(db, PETE, pid(LINH), { env: ON }), { ok: true, value: null });
        assert.deepEqual(await follow(db, PETE, pid(SIONE), { env: ON }), NOT_FOUND);
        assert.deepEqual(await follows(), [`${PETE}>${MIA}`, `${PETE}>${LINH}`].sort());
      });

      test("the club's module list (the proxy, the menu, the jobs) follows the same switch: a row is not enough", async () => {
        const settings = ["SOCIAL_AVAILABILITY", "MARKET_AVAILABILITY", "SOCIAL_PILOT_TENANTS", "MARKET_PILOT_TENANTS", "VERCEL_ENV", "MODULES_CACHE_MS", "MODULE_ENFORCEMENT"];
        const was = Object.fromEntries(settings.map((k) => [k, process.env[k]]));
        const on = async (env: Record<string, string>) => {
          for (const k of settings) delete process.env[k];
          Object.assign(process.env, { MODULES_CACHE_MS: "0" }, env);
          resetClubModulesCache();
          const enabled = await enabledModules(db);
          return ["social", "moderation"].filter((id) => enabled.has(id));
        };
        try {
          await admin.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES (1, 'moderation', true) ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = true`);
          assert.deepEqual(await on({}), [], "both rows say on; nothing opens them");
          assert.deepEqual(await on({ SOCIAL_AVAILABILITY: "available" }), ["social", "moderation"]);
          assert.deepEqual(await on({ MARKET_AVAILABILITY: "available" }), ["moderation"], "the queue works with only the Marketplace open");
          assert.deepEqual(await on({ VERCEL_ENV: "production", SOCIAL_AVAILABILITY: "available", MARKET_AVAILABILITY: "available" }), []);
          assert.deepEqual(await on({ VERCEL_ENV: "production", SOCIAL_PILOT_TENANTS: "1" }), ["social", "moderation"]);
          assert.deepEqual(await on({ VERCEL_ENV: "production", SOCIAL_PILOT_TENANTS: `11,${club2}` }), [], "this deployment's club is 1");
          // The pilot list without the club's own rows: still off.
          await admin.query(`DELETE FROM tenant_modules WHERE tenant_id = 1 AND module_id IN ('social', 'moderation')`);
          assert.deepEqual(await on({ VERCEL_ENV: "production", SOCIAL_PILOT_TENANTS: "1" }), []);
        } finally {
          await admin.query(`DELETE FROM tenant_modules WHERE module_id = 'moderation'`);
          for (const k of settings) if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k];
          resetClubModulesCache();
        }
      });

      test("the admin count: open reports in this club's own queue, and no others", async () => {
        const report = (clubId: number | null, queue: string, status = "open", severity = "normal") =>
          admin.query(
            `INSERT INTO content_reports (reporter_id, target_type, target_id, club_id, reason, severity, queue, status, due_at, handled_at)
             VALUES (NULL, 'profile', $1, $2, $3, $4, $5, $6, now() + interval '1 day', CASE WHEN $6 <> 'open' THEN now() END)`,
            [MIA, clubId, severity === "serious" ? "hate" : "spam", severity, queue, status],
          );
        assert.equal(await countOpenClubReports(db), 0);
        await report(1, "club");
        await report(1, "club");
        await report(1, "club", "dismissed");
        await report(1, "club", "actioned");
        await report(1, "platform", "open", "serious");
        await report(null, "platform");
        await report(club2, "club");
        assert.equal(await countOpenClubReports(db), 2);
        assert.equal(await countOpenClubReports(db, "hanoi-smash"), 1);
        assert.equal(await countOpenClubReports(db, "no-such-club"), 0);
      });
    });
  }
});
