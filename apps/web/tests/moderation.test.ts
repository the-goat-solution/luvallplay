// Social plan, Task 2a: blocks and suspensions (lib/moderation), who can see
// a profile (lib/social/visible.ts), and migration 0022's tables and its two
// cross-club functions. Against a real Postgres, with two clubs, once as the
// database owner (TENANT_SCOPE=off) and once as the app's role for one club
// (TENANT_SCOPE=enforce). Made-up people only.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { SOCIAL_LIMITS } from "@luvallplay/core/social";
import { migrate } from "../scripts/db/migrate.mjs";
import { err, ok, type Result } from "../lib/moderation/result.ts";
import { block, blockedEitherWay, listBlocked, notBlockedSql, unblock } from "../lib/moderation/blocks.ts";
import { activeSuspension, carrySuspensions, notSuspendedSql, suspend, unsuspend } from "../lib/moderation/suspensions.ts";
import { isPublicId, newPublicId } from "../lib/social/public-id.ts";
import { loadVisibleProfile } from "../lib/social/visible.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `moderation_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const key = () => randomBytes(32).toString("base64");
const NOT_FOUND = { ok: false, code: "not_found" } as const;

test("the result type: ok carries a value, err a code", () => {
  const good: Result<{ id: number }, "not_found"> = ok({ id: 7 });
  const bad: Result<{ id: number }, "not_found"> = err("not_found");
  assert.deepEqual(good, { ok: true, value: { id: 7 } });
  assert.deepEqual(bad, { ok: false, code: "not_found" });
});

test("a public id is 12 letters and digits, random each time", () => {
  const ids = new Set(Array.from({ length: 500 }, () => newPublicId()));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^[0-9A-Za-z]{12}$/);
  assert.equal(isPublicId([...ids][0]), true);
  for (const bad of ["", "short", "x".repeat(13), "abcdefghijk!", "abcdefghijk ", 123456789012, null, undefined, { toString: () => "abcdefghijkl" }]) assert.equal(isPublicId(bad), false, String(bad));
});

test("the SQL fragments take a parameter and a column, and nothing else", () => {
  assert.match(notBlockedSql("$1", "p.author_id"), /^NOT EXISTS \(SELECT 1 FROM user_blocks /);
  assert.match(notSuspendedSql("p.author_id", "social"), /player_suspensions/);
  for (const [param, column] of [["1", "p.author_id"], ["$1; DROP TABLE players", "p.author_id"], ["$1", "p.author_id OR true"], ["$1", "author_id)--"], ["$1", ""], ["", "author_id"], ["$1", "a.b.c"]]) {
    assert.throws(() => notBlockedSql(param, column), /not a parameter|not a column/, `${param} / ${column}`);
  }
  assert.throws(() => notSuspendedSql("p.author_id; SELECT 1", "social"), /not a column/);
  assert.throws(() => notSuspendedSql("p.author_id", "everything" as never), /scope/);
});

describe("blocks, suspensions and the social tables", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const env = { ...process.env };
  let admin: pg.Client;
  let database: typeof import("../lib/database.ts");
  let club2 = 0;
  // Seed accounts in Three Wolves (club 1): 3 Mia, 4 Pete, 5 Quinn, 6 Rua (a
  // phone number), 7 Sione (also joins club 2), 25 a deleted account.
  const MIA = 3;
  const PETE = 4;
  const QUINN = 5;
  const RUA = 6;
  const SIONE = 7;
  const DELETED = 25;
  // Hanoi Smash (club 2) only.
  let LINH = 0;
  let NAM = 0;
  const KEYS = { CONTACT_INDEX_KEYS: `i1:${key()}` };
  const rows = async (text: string, params: unknown[] = []) => (await admin.query(text, params)).rows;
  const publicIds = new Map<number, string>();
  const pid = (playerId: number) => publicIds.get(playerId)!;

  /** A social profile written straight to the table (joining is Task 3). */
  async function profile(playerId: number, displayName: string, visibility: "club" | "everyone" = "club") {
    const publicId = newPublicId();
    await admin.query(
      `INSERT INTO social_profiles (player_id, public_id, display_name, visibility, adult_confirmed_at, rules_version) VALUES ($1, $2, $3, $4, now(), '2026-12')`,
      [playerId, publicId, displayName, visibility],
    );
    publicIds.set(playerId, publicId);
    return publicId;
  }
  const follow = (a: number, b: number) => admin.query(`INSERT INTO social_follows (follower_id, followee_id) VALUES ($1, $2)`, [a, b]);
  const follows = async () => (await rows(`SELECT follower_id || '>' || followee_id AS f FROM social_follows ORDER BY 1`)).map((r) => r.f);
  const post = async (authorId: number, clubId: number, body = "Good games tonight") =>
    Number((await rows(`INSERT INTO social_posts (author_id, club_id, kind, body) VALUES ($1, $2, 'text', $3) RETURNING id`, [authorId, clubId, body]))[0].id);
  const socialOn = (clubId: number, on: boolean) =>
    admin.query(
      `INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES ($1, 'social', $2) ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [clubId, on],
    );

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
    database = await import("../lib/database.ts");
  });
  after(async () => {
    await database?.closeDatabase();
    process.env = env;
    await admin?.end();
    const root = new pg.Client({ connectionString: urlFor("postgres") });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await root.end();
  });

  test("the tables are the platform's: no club column, no row-level security, and the app's role has its rights", async () => {
    const tables = ["social_profiles", "social_follows", "social_posts", "social_comments", "social_kudos", "social_club_bans", "user_blocks", "player_suspensions"];
    const found = await rows(
      `SELECT c.relname AS t, c.relrowsecurity AS rls,
              EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS tenant_id,
              has_table_privilege('luvallplay_app', c.oid, 'SELECT') AS sel, has_table_privilege('luvallplay_app', c.oid, 'INSERT') AS ins,
              has_table_privilege('luvallplay_app', c.oid, 'UPDATE') AS upd, has_table_privilege('luvallplay_app', c.oid, 'DELETE') AS del
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ANY($1) ORDER BY 1`,
      [tables],
    );
    assert.deepEqual(found.map((r) => r.t), [...tables].sort());
    for (const r of found) {
      const appendOnly = r.t === "player_suspensions";
      // No INSERT on the whole of player_suspensions: on its columns, all but two (below).
      assert.deepEqual({ rls: r.rls, tenant_id: r.tenant_id, sel: r.sel, ins: r.ins, upd: r.upd, del: r.del }, { rls: false, tenant_id: false, sel: true, ins: !appendOnly, upd: !appendOnly, del: !appendOnly }, r.t);
    }
    // A suspension's id and time are the database's: the app's role may write every other column and not those two.
    const writable = await rows(
      `SELECT a.attname AS c FROM pg_attribute a WHERE a.attrelid = 'player_suspensions'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND has_column_privilege('luvallplay_app', a.attrelid, a.attnum, 'INSERT') ORDER BY 1`,
    );
    assert.deepEqual(writable.map((r) => r.c), ["action", "created_by", "email_index", "index_kid", "phone_index", "player_id", "reason_code", "scope", "until"]);
    assert.equal((await rows(`SELECT attidentity FROM pg_attribute WHERE attrelid = 'player_suspensions'::regclass AND attname = 'id'`))[0].attidentity, "a");
    // The report, action and evidence tables are migration 0023's: tests/moderation-reports.test.ts.
  });

  test("the two cross-club functions run as their owner with a fixed search path, and only the app's role may call them", async () => {
    const fns = await rows(
      `SELECT p.proname, p.prosecdef, p.proconfig::text AS config, pg_get_function_result(p.oid) AS returns,
              has_function_privilege('luvallplay_app', p.oid, 'EXECUTE') AS app, has_function_privilege('public', p.oid, 'EXECUTE') AS anyone
       FROM pg_proc p WHERE p.proname IN ('social_clubs_of', 'shares_social_club') ORDER BY 1`,
    );
    assert.deepEqual(fns, [
      { proname: "shares_social_club", prosecdef: true, config: `{"search_path=public, pg_temp"}`, returns: "boolean", app: true, anyone: false },
      { proname: "social_clubs_of", prosecdef: true, config: `{"search_path=public, pg_temp"}`, returns: "SETOF bigint", app: true, anyone: false },
    ]);
  });

  test("the database keeps the limits: lengths, the public id's shape, one profile per id, one automatic post per key", async () => {
    await admin.query(`DELETE FROM social_posts`);
    await admin.query(`DELETE FROM social_profiles`);
    const insert = (cols: Record<string, unknown>) => {
      const row = { player_id: MIA, public_id: newPublicId(), display_name: "Mia G", visibility: "club", adult_confirmed_at: new Date(), rules_version: "2026-12", ...cols };
      const names = Object.keys(row);
      return admin.query(`INSERT INTO social_profiles (${names.join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
    };
    await assert.rejects(insert({ display_name: "x".repeat(SOCIAL_LIMITS.displayName + 1) }), /social_profiles_display_name_check/);
    await assert.rejects(insert({ display_name: "" }), /social_profiles_display_name_check/);
    await assert.rejects(insert({ bio: "x".repeat(SOCIAL_LIMITS.bio + 1) }), /social_profiles_bio_check/);
    await assert.rejects(insert({ visibility: "friends" }), /social_profiles_visibility_check/);
    await assert.rejects(insert({ public_id: "too-short" }), /social_profiles_public_id_check/);
    await assert.rejects(insert({ adult_confirmed_at: null }), /adult_confirmed_at/);
    // Forty Vietnamese letters fit a limit of forty.
    await insert({ display_name: "ế".repeat(SOCIAL_LIMITS.displayName), bio: "ữ".repeat(SOCIAL_LIMITS.bio) });
    const taken = (await rows(`SELECT public_id FROM social_profiles WHERE player_id = $1`, [MIA]))[0].public_id;
    await assert.rejects(insert({ player_id: PETE, public_id: taken }), /social_profiles_public_id_key/);

    const p = (cols: string, values: string, params: unknown[] = []) => admin.query(`INSERT INTO social_posts (author_id, club_id, ${cols}) VALUES (${MIA}, 1, ${values})`, params);
    await assert.rejects(p("kind, body", "'text', $1", ["x".repeat(SOCIAL_LIMITS.post + 1)]), /social_posts_body_check/);
    await assert.rejects(p("kind", "'text'"), /social_posts_text_has_body_check/);
    await assert.rejects(p("kind, body", "'story', 'x'"), /social_posts_kind_check/);
    await assert.rejects(p("kind, body, state", "'text', 'x', 'gone'"), /social_posts_state_check/);
    await assert.rejects(p("kind", "'match'"), /social_posts_auto_has_key_check/);
    await assert.rejects(p("kind, body, photo_id", "'photo', 'x', 999999"), /social_posts_photo_id_fkey/);
    await p("kind, ref_key", "'match', 'challenge:9:posting'");
    await assert.rejects(p("kind, ref_key", "'match', 'challenge:9:posting'"), /social_posts_author_kind_ref_key/);
    await admin.query(`INSERT INTO social_posts (author_id, club_id, kind, ref_key) VALUES ($1, 1, 'match', 'challenge:9:posting') ON CONFLICT (author_id, kind, ref_key) DO NOTHING`, [MIA]);
    assert.equal((await rows(`SELECT count(*)::int AS n FROM social_posts WHERE kind = 'match'`))[0].n, 1, "the same event twice makes one post (Review Focus 3)");
    await p("kind, body", "'text', 'one'");
    await p("kind, body", "'text', 'one'");
    const postId = Number((await rows(`SELECT id FROM social_posts WHERE kind = 'match'`))[0].id);
    await assert.rejects(admin.query(`INSERT INTO social_comments (post_id, author_id, body) VALUES ($1, $2, $3)`, [postId, PETE, "x".repeat(SOCIAL_LIMITS.comment + 1)]), /social_comments_body_check/);
    await assert.rejects(admin.query(`INSERT INTO social_comments (post_id, author_id, body) VALUES ($1, $2, '')`, [postId, PETE]), /social_comments_body_check/);
    await admin.query(`INSERT INTO social_comments (post_id, author_id, body) VALUES ($1, $2, 'Well played')`, [postId, PETE]);
    await admin.query(`INSERT INTO social_kudos (post_id, player_id) VALUES ($1, $2)`, [postId, PETE]);
    await assert.rejects(admin.query(`INSERT INTO social_kudos (post_id, player_id) VALUES ($1, $2)`, [postId, PETE]), /social_kudos_pkey/);
    await assert.rejects(admin.query(`INSERT INTO social_follows (follower_id, followee_id) VALUES ($1, $1)`, [MIA]), /social_follows_not_self_check/);
    await assert.rejects(admin.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $1)`, [MIA]), /user_blocks_not_self_check/);
    // Deleting a post takes its comments and kudos with it.
    await admin.query(`DELETE FROM social_posts WHERE id = $1`, [postId]);
    assert.deepEqual(await rows(`SELECT 1 FROM social_comments UNION ALL SELECT 1 FROM social_kudos`), []);

    const s = (cols: string, values: string) => admin.query(`INSERT INTO player_suspensions (${cols}) VALUES (${values})`);
    await assert.rejects(s("player_id, scope, reason_code", `${MIA}, 'everything', 'harassment'`), /player_suspensions_scope_check/);
    await assert.rejects(s("player_id, scope, reason_code, action", `${MIA}, 'social', 'harassment', 'pardon'`), /player_suspensions_action_check/);
    await assert.rejects(s("scope, reason_code", `'social', 'harassment'`), /player_suspensions_names_someone_check/);
    await assert.rejects(s("player_id, scope, reason_code", `${MIA}, 'social', 'They were rude to Pete'`), /player_suspensions_reason_code_check/);
    await assert.rejects(s("player_id, scope, reason_code, index_kid, email_index", `${MIA}, 'social', 'harassment', 'i1', 'mia.member@golden.test'`), /player_suspensions_email_index_check/);
    await assert.rejects(s("player_id, scope, reason_code, index_kid, phone_index", `${MIA}, 'social', 'harassment', 'i1', '+64215550006'`), /player_suspensions_phone_index_check/);
    await assert.rejects(s("player_id, scope, reason_code, email_index", `${MIA}, 'social', 'harassment', '${"a".repeat(43)}'`), /player_suspensions_index_kid_check/);
    await assert.rejects(s("player_id, scope, reason_code, action, until", `${MIA}, 'social', 'appeal', 'unsuspend', now() + interval '1 day'`), /player_suspensions_unsuspend_has_no_end_check/);
    assert.deepEqual(await rows(`SELECT 1 FROM player_suspensions`), []);
  });

  for (const mode of ["off", "enforce"] as const) {
    describe(`TENANT_SCOPE=${mode}`, () => {
      let db: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

      before(async () => {
        await database.closeDatabase();
        process.env.TENANT_SCOPE = mode;
        db = { query: (text, params) => database.sql.query(text, params) };
      });
      beforeEach(async () => {
        await admin.query(`TRUNCATE social_follows, user_blocks, social_kudos, social_comments, social_posts, social_club_bans, social_profiles, player_suspensions`);
        await admin.query(`DELETE FROM tenant_modules WHERE module_id = 'social'`);
        await admin.query(`UPDATE club_members SET status = 'active'`);
        publicIds.clear();
        await socialOn(1, true);
        await socialOn(club2, true);
        await profile(MIA, "Mia G");
        await profile(PETE, "Pete the Smash");
        await profile(QUINN, "Quinn", "everyone");
        await profile(SIONE, "Sione S");
        await profile(LINH, "Linh N");
        await profile(NAM, "Nam T", "everyone");
      });

      test("the connection is what the mode says", async () => {
        const who = (await db.query(`SELECT current_user AS role, current_setting('app.tenant_id', true) AS club, (SELECT count(*)::int FROM tenant_modules WHERE module_id = 'social') AS seen`)).rows[0];
        if (mode === "enforce") assert.deepEqual(who, { role: "luvallplay_app", club: "1", seen: 1 });
        else assert.equal(who.seen, 2);
      });

      test("social_clubs_of: the clubs where the person is a member and Social is on, across clubs", async () => {
        const clubsOf = async (id: number) => (await db.query(`SELECT c::int AS c FROM social_clubs_of($1) AS c ORDER BY 1`, [id])).rows.map((r) => r.c);
        const shares = async (a: number, b: number) => (await db.query(`SELECT shares_social_club($1, $2) AS s`, [a, b])).rows[0].s;
        assert.deepEqual(await clubsOf(MIA), [1]);
        assert.deepEqual(await clubsOf(LINH), [club2]);
        assert.deepEqual(await clubsOf(SIONE), [1, club2], "both clubs, whichever club the connection is scoped to");
        assert.deepEqual(await clubsOf(999999), []);
        assert.deepEqual([await shares(MIA, PETE), await shares(PETE, MIA), await shares(MIA, LINH), await shares(SIONE, LINH), await shares(SIONE, MIA), await shares(MIA, 999999)], [true, true, false, true, true, false]);
        assert.equal(await shares(MIA, MIA), true);

        // The module row decides: off, or no row at all, and the club doesn't count.
        await socialOn(club2, false);
        assert.deepEqual(await clubsOf(LINH), []);
        assert.deepEqual(await clubsOf(SIONE), [1]);
        assert.equal(await shares(SIONE, LINH), false);
        assert.equal(await shares(LINH, NAM), false, "two members of a club with Social off share no social club");
        assert.equal(await shares(LINH, LINH), false);
        await admin.query(`DELETE FROM tenant_modules WHERE module_id = 'social' AND tenant_id = 1`);
        assert.deepEqual(await clubsOf(MIA), []);
        assert.equal(await shares(MIA, PETE), false);
        // Another module's row is not Social's.
        await admin.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES ($1, 'moderation', true) ON CONFLICT DO NOTHING`, [club2]);
        assert.deepEqual(await clubsOf(LINH), []);
        await admin.query(`DELETE FROM tenant_modules WHERE module_id = 'moderation'`);

        // A member the club has disabled, and a club that isn't active, don't count.
        await socialOn(1, true);
        await socialOn(club2, true);
        await admin.query(`UPDATE club_members SET status = 'disabled' WHERE user_id = $1 AND tenant_id = 1`, [SIONE]);
        assert.deepEqual(await clubsOf(SIONE), [club2]);
        assert.equal(await shares(SIONE, MIA), false);
        await admin.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [club2]);
        try {
          assert.deepEqual(await clubsOf(LINH), []);
        } finally {
          await admin.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [club2]);
        }
      });

      test("who can see a profile: club mates, or anyone for an `everyone` profile; never a real name", async () => {
        const mia = await loadVisibleProfile(db, PETE, pid(MIA));
        assert.deepEqual(Object.keys(mia!).sort(), ["bio", "displayName", "joinedAt", "playerId", "publicId", "visibility"]);
        assert.deepEqual({ ...mia, joinedAt: "" }, { playerId: MIA, publicId: pid(MIA), displayName: "Mia G", bio: null, visibility: "club", joinedAt: "" });
        assert.ok(!JSON.stringify(mia).includes("Golden"), "no real name");
        // `club`: only someone who shares a social club.
        assert.equal(await loadVisibleProfile(db, LINH, pid(MIA)), null);
        assert.equal((await loadVisibleProfile(db, SIONE, pid(LINH)))?.displayName, "Linh N");
        assert.equal(await loadVisibleProfile(db, MIA, pid(LINH)), null);
        // `everyone`: any other person.
        assert.equal((await loadVisibleProfile(db, LINH, pid(QUINN)))?.displayName, "Quinn");
        assert.equal((await loadVisibleProfile(db, MIA, pid(NAM)))?.displayName, "Nam T");
        // Your own, always.
        assert.equal((await loadVisibleProfile(db, MIA, pid(MIA)))?.displayName, "Mia G");
        // Missing and malformed ids.
        for (const bad of [newPublicId(), "", "nope", String(MIA), null, undefined, 12, `${pid(MIA)}'`]) assert.equal(await loadVisibleProfile(db, PETE, bad), null, String(bad));
      });

      test("a profile is hidden across a block (both ways), from a suspended or deleted person, and when its club switches Social off", async () => {
        assert.deepEqual(await block(db, MIA, pid(PETE)), { ok: true, value: null });
        assert.equal(await loadVisibleProfile(db, MIA, pid(PETE)), null);
        assert.equal(await loadVisibleProfile(db, PETE, pid(MIA)), null);
        assert.equal((await loadVisibleProfile(db, SIONE, pid(PETE)))?.displayName, "Pete the Smash", "others still see both");

        assert.equal((await suspend(db, { playerId: QUINN, scope: "social", until: null, reasonCode: "harassment", actorId: 1 }, {})).ok, true);
        assert.equal(await loadVisibleProfile(db, MIA, pid(QUINN)), null);
        assert.equal((await loadVisibleProfile(db, QUINN, pid(QUINN)))?.displayName, "Quinn", "the person still reads their own");
        assert.equal((await unsuspend(db, { playerId: QUINN, scope: "social", reasonCode: "appeal_upheld", actorId: 1 }, {})).ok, true);
        assert.equal((await loadVisibleProfile(db, MIA, pid(QUINN)))?.displayName, "Quinn");
        // A Marketplace suspension doesn't hide a social profile; one for everything does.
        await suspend(db, { playerId: QUINN, scope: "market", until: null, reasonCode: "scam", actorId: 1 }, {});
        assert.equal((await loadVisibleProfile(db, MIA, pid(QUINN)))?.displayName, "Quinn");
        await suspend(db, { playerId: QUINN, scope: "all", until: null, reasonCode: "scam", actorId: 1 }, {});
        assert.equal(await loadVisibleProfile(db, MIA, pid(QUINN)), null);

        // The deleted account (seed 25), with a profile left behind on purpose.
        await profile(DELETED, "Gone", "everyone");
        assert.equal(await loadVisibleProfile(db, MIA, pid(DELETED)), null);
        assert.equal(await loadVisibleProfile(db, DELETED, pid(DELETED)), null);

        // Review Focus 2: the club switches Social off; the rows stay, the person disappears.
        await socialOn(club2, false);
        assert.equal(await loadVisibleProfile(db, MIA, pid(NAM)), null, "an `everyone` profile with no social club left");
        assert.equal(await loadVisibleProfile(db, SIONE, pid(LINH)), null);
        assert.equal((await rows(`SELECT count(*)::int AS n FROM social_profiles WHERE player_id = ANY($1)`, [[LINH, NAM]]))[0].n, 2);
      });

      test("blocking is idempotent and removes the follows between the two, both ways, and no one else's", async () => {
        await follow(MIA, PETE);
        await follow(PETE, MIA);
        await follow(MIA, QUINN);
        await follow(SIONE, PETE);
        assert.deepEqual(await block(db, MIA, pid(PETE)), { ok: true, value: null });
        assert.deepEqual(await follows(), [`${MIA}>${QUINN}`, `${SIONE}>${PETE}`]);
        assert.deepEqual(await block(db, MIA, pid(PETE)), { ok: true, value: null }, "again: the same answer");
        assert.deepEqual(await rows(`SELECT blocker_id, blocked_id FROM user_blocks`), [{ blocker_id: MIA, blocked_id: PETE }]);
        // Twelve at once: still one row, and never an error.
        const many = await Promise.all(Array.from({ length: 12 }, () => block(db, MIA, pid(QUINN))));
        assert.deepEqual(many, Array(12).fill({ ok: true, value: null }));
        assert.equal((await rows(`SELECT count(*)::int AS n FROM user_blocks WHERE blocked_id = $1`, [QUINN]))[0].n, 1);
        assert.deepEqual(await follows(), [`${SIONE}>${PETE}`]);
      });

      test("blockedEitherWay is the same from both sides; the SQL fragment hides the same people", async () => {
        assert.equal(await blockedEitherWay(db, MIA, PETE), false);
        await block(db, MIA, pid(PETE));
        assert.deepEqual([await blockedEitherWay(db, MIA, PETE), await blockedEitherWay(db, PETE, MIA)], [true, true]);
        assert.deepEqual([await blockedEitherWay(db, MIA, QUINN), await blockedEitherWay(db, QUINN, PETE), await blockedEitherWay(db, MIA, MIA)], [false, false, false]);
        const seenBy = async (viewer: number) =>
          (await db.query(`SELECT sp.player_id FROM social_profiles sp WHERE sp.player_id = ANY($2) AND ${notBlockedSql("$1", "sp.player_id")} ORDER BY 1`, [viewer, [MIA, PETE, QUINN]])).rows.map((r) => r.player_id);
        assert.deepEqual(await seenBy(MIA), [MIA, QUINN]);
        assert.deepEqual(await seenBy(PETE), [PETE, QUINN]);
        assert.deepEqual(await seenBy(QUINN), [MIA, PETE, QUINN]);
      });

      test("unblocking: only the blocker's own block goes; it never says whether there was one", async () => {
        await block(db, MIA, pid(PETE));
        await block(db, PETE, pid(MIA)).then((r) => assert.deepEqual(r, NOT_FOUND, "Pete can't see Mia any more, and she never interacted with him"));
        await admin.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [PETE, MIA]);
        assert.deepEqual(await unblock(db, MIA, pid(PETE)), { ok: true, value: null });
        assert.deepEqual(await rows(`SELECT blocker_id, blocked_id FROM user_blocks`), [{ blocker_id: PETE, blocked_id: MIA }], "Pete's own block of Mia stays");
        assert.equal(await blockedEitherWay(db, MIA, PETE), true);
        for (const id of [pid(PETE), pid(QUINN), newPublicId(), "nope", null]) assert.deepEqual(await unblock(db, MIA, id), { ok: true, value: null }, String(id));
        // Someone who has since been suspended, or gone out of sight, can still be unblocked.
        await block(db, MIA, pid(QUINN));
        await block(db, SIONE, pid(LINH));
        await suspend(db, { playerId: QUINN, scope: "all", until: null, reasonCode: "harassment", actorId: 1 }, {});
        await socialOn(club2, false);
        assert.deepEqual(await unblock(db, MIA, pid(QUINN)), { ok: true, value: null });
        assert.deepEqual(await unblock(db, SIONE, pid(LINH)), { ok: true, value: null });
        assert.deepEqual(await rows(`SELECT blocker_id, blocked_id FROM user_blocks`), [{ blocker_id: PETE, blocked_id: MIA }]);
        // Unblocking doesn't bring the follows back.
        assert.deepEqual(await follows(), []);
      });

      test("blocking someone you can't see answers exactly like a missing id (Review Focus 6)", async () => {
        const answers: [string, unknown][] = [];
        const tryBlock = async (what: string, blocker: number, id: unknown) => answers.push([what, await block(db, blocker, id)]);
        await tryBlock("an id nobody has", MIA, newPublicId());
        await tryBlock("not an id", MIA, "nope");
        await tryBlock("an account id", MIA, String(PETE));
        await tryBlock("nothing", MIA, null);
        await tryBlock("SQL", MIA, `${pid(PETE)}' OR '1'='1`);
        await tryBlock("a `club` profile in another club", MIA, pid(LINH));
        await tryBlock("yourself", MIA, pid(MIA));
        await profile(DELETED, "Gone", "everyone");
        await tryBlock("a deleted account", MIA, pid(DELETED));
        await suspend(db, { playerId: QUINN, scope: "all", until: null, reasonCode: "harassment", actorId: 1 }, {});
        await tryBlock("a suspended person", MIA, pid(QUINN));
        await admin.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [SIONE, MIA]);
        await tryBlock("someone who blocked you first", MIA, pid(SIONE));
        await socialOn(club2, false);
        await tryBlock("an `everyone` profile whose club switched Social off", MIA, pid(NAM));
        // A blocker that isn't an account: the database's foreign key would refuse the row; the answer is still not_found, never an error.
        await tryBlock("a blocker with no account", 999999, pid(PETE));
        await tryBlock("a blocker that isn't a number", "3" as never, pid(PETE));
        for (const [what, answer] of answers) assert.deepEqual(answer, NOT_FOUND, what);
        assert.equal(new Set(answers.map(([, a]) => JSON.stringify(a))).size, 1, "one answer for all of them");
        assert.deepEqual(await rows(`SELECT blocker_id, blocked_id FROM user_blocks`), [{ blocker_id: SIONE, blocked_id: MIA }], "nothing was written");
      });

      test("someone who interacted with you can be blocked even when their profile is out of sight", async () => {
        // Linh is in another club and her profile is `club`: out of Mia's sight until she follows Mia.
        assert.deepEqual(await block(db, MIA, pid(LINH)), NOT_FOUND);
        await follow(LINH, MIA);
        assert.deepEqual(await block(db, MIA, pid(LINH)), { ok: true, value: null }, "a follower");
        assert.deepEqual(await follows(), []);
        // A comment on, or kudos for, one of Mia's posts.
        const mine = await post(MIA, 1);
        await admin.query(`INSERT INTO social_comments (post_id, author_id, body) VALUES ($1, $2, 'Nice one')`, [mine, NAM]);
        await socialOn(club2, false);
        assert.deepEqual(await block(db, MIA, pid(NAM)), { ok: true, value: null }, "a commenter");
        await admin.query(`DELETE FROM user_blocks`);
        await admin.query(`DELETE FROM social_comments`);
        assert.deepEqual(await block(db, MIA, pid(NAM)), NOT_FOUND);
        await admin.query(`INSERT INTO social_kudos (post_id, player_id) VALUES ($1, $2)`, [mine, NAM]);
        assert.deepEqual(await block(db, MIA, pid(NAM)), { ok: true, value: null }, "someone who gave kudos");
        // Their comment on someone else's post is not an interaction with Mia.
        const petes = await post(PETE, 1);
        await admin.query(`INSERT INTO social_comments (post_id, author_id, body) VALUES ($1, $2, 'Hello')`, [petes, LINH]);
        await admin.query(`DELETE FROM user_blocks`);
        assert.deepEqual(await block(db, MIA, pid(LINH)), NOT_FOUND);
        // An interaction doesn't make a deleted account or yourself blockable.
        await profile(DELETED, "Gone", "everyone");
        await follow(DELETED, MIA);
        assert.deepEqual(await block(db, MIA, pid(DELETED)), NOT_FOUND);
      });

      test("the list of blocked people shows display names and public ids, never a real name, an email or an account id", async () => {
        await block(db, MIA, pid(PETE));
        await block(db, MIA, pid(QUINN));
        await block(db, PETE, pid(SIONE));
        const list = await listBlocked(db, MIA);
        assert.deepEqual(list.map((b) => b.displayName).sort(), ["Pete the Smash", "Quinn"]);
        for (const b of list) {
          assert.deepEqual(Object.keys(b).sort(), ["blockedAt", "displayName", "publicId"]);
          assert.match(b.publicId, /^[0-9A-Za-z]{12}$/);
          assert.ok(!Number.isNaN(Date.parse(b.blockedAt)));
        }
        assert.deepEqual(list.map((b) => b.publicId).sort(), [pid(PETE), pid(QUINN)].sort());
        const text = JSON.stringify(list);
        for (const secret of ["Golden", "golden.test", "player_id", "playerId", "blocked_id", `"id"`, `:${PETE},`, `:${QUINN},`, `:${PETE}}`, `:${QUINN}}`]) assert.ok(!text.includes(secret), secret);
        assert.deepEqual(await listBlocked(db, QUINN), []);
        // A blocked person who is suspended or out of sight is still listed, so the block can be lifted.
        await suspend(db, { playerId: PETE, scope: "all", until: null, reasonCode: "harassment", actorId: 1 }, {});
        assert.equal((await listBlocked(db, MIA)).length, 2);
        // An account that has been deleted is not listed, whatever its profile row still says.
        await profile(DELETED, "Renamed After Leaving", "everyone");
        await admin.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [MIA, DELETED]);
        const after = await listBlocked(db, MIA);
        assert.deepEqual(after.map((b) => b.displayName).sort(), ["Pete the Smash", "Quinn"]);
        assert.ok(!JSON.stringify(after).includes(pid(DELETED)));
      });

      test("the app's role can add a suspension and read it; it can't change or delete one, or choose a row's id or time", async () => {
        const made = await suspend(db, { playerId: MIA, scope: "social", until: null, reasonCode: "harassment", actorId: 1 }, {});
        assert.equal(made.ok, true);
        const app = new pg.Client({ connectionString: urlFor(NAME) });
        await app.connect();
        try {
          await app.query(`SET ROLE luvallplay_app`);
          assert.equal((await app.query(`SELECT count(*)::int AS n FROM player_suspensions`)).rows[0].n, 1);
          await assert.rejects(app.query(`UPDATE player_suspensions SET until = now()`), /permission denied for table player_suspensions/);
          await assert.rejects(app.query(`UPDATE player_suspensions SET action = 'unsuspend' WHERE player_id = $1`, [MIA]), /permission denied/);
          await assert.rejects(app.query(`DELETE FROM player_suspensions`), /permission denied for table player_suspensions/);
          await assert.rejects(app.query(`TRUNCATE player_suspensions`), /permission denied/);
          // Which row is later is told by its id, so the app can't pick one (a lift dated after everything to come), nor the time.
          const forged = [
            `INSERT INTO player_suspensions (id, player_id, action, scope, reason_code) VALUES (9223372036854775807, ${MIA}, 'unsuspend', 'all', 'appeal_upheld')`,
            `INSERT INTO player_suspensions (id, player_id, action, scope, reason_code) OVERRIDING SYSTEM VALUE VALUES (9223372036854775807, ${MIA}, 'unsuspend', 'all', 'appeal_upheld')`,
            `INSERT INTO player_suspensions (id, player_id, scope, reason_code) OVERRIDING USER VALUE VALUES (5, ${MIA}, 'all', 'spam')`,
            `INSERT INTO player_suspensions (player_id, scope, reason_code, created_at) VALUES (${MIA}, 'all', 'spam', '2020-01-01')`,
            `INSERT INTO player_suspensions (player_id, scope, reason_code, created_at) VALUES (${MIA}, 'all', 'spam', DEFAULT)`,
          ];
          // (The first is refused even earlier, as it would be for the owner: the id is GENERATED ALWAYS.)
          for (const statement of forged) await assert.rejects(app.query(statement), statement === forged[0] ? /non-DEFAULT value into column "id"|permission denied/ : /permission denied for table player_suspensions/, statement);
          await assert.rejects(app.query(`SELECT setval('player_suspensions_id_seq', 1000000)`), /permission denied/);
          await app.query(`INSERT INTO player_suspensions (player_id, scope, reason_code) VALUES ($1, 'market', 'scam')`, [MIA]);
        } finally {
          await app.end();
        }
        if (mode === "enforce") {
          await assert.rejects(db.query(`UPDATE player_suspensions SET until = now()`), /permission denied/);
          await assert.rejects(db.query(`DELETE FROM player_suspensions`), /permission denied/);
          await assert.rejects(db.query(`INSERT INTO player_suspensions (id, player_id, scope, reason_code) OVERRIDING SYSTEM VALUE VALUES (99, ${MIA}, 'all', 'spam')`), /permission denied/);
        }
        const all = await rows(`SELECT id, action, until, created_at FROM player_suspensions ORDER BY id`);
        assert.equal(all.length, 2);
        assert.ok(all.every((r) => r.action === "suspend" && r.until === null && Math.abs(r.created_at.getTime() - Date.now()) < 60_000));
        assert.ok(Number(all[1].id) > Number(all[0].id) && Number(all[1].id) < 1_000_000);
        // Even the owner is told no unless it says it means to override.
        await assert.rejects(admin.query(`INSERT INTO player_suspensions (id, player_id, scope, reason_code) VALUES (99, ${MIA}, 'all', 'spam')`), /non-DEFAULT value into column "id"/);
      });

      test("a suspension is for Social, the Marketplace, or both", async () => {
        assert.equal(await activeSuspension(db, { playerId: MIA }, "social", {}), null);
        const market = await suspend(db, { playerId: MIA, scope: "market", until: null, reasonCode: "scam", actorId: 1 }, {});
        assert.equal(market.ok, true);
        assert.equal(await activeSuspension(db, { playerId: MIA }, "social", {}), null, "a Marketplace suspension doesn't close Social");
        const found = await activeSuspension(db, { playerId: MIA }, "market", {});
        assert.deepEqual(found, { id: market.ok && market.value.id, scope: "market", until: null, reasonCode: "scam" });
        const all = await suspend(db, { playerId: PETE, scope: "all", until: null, reasonCode: "child_safety", actorId: 1 }, {});
        assert.equal((await activeSuspension(db, { playerId: PETE }, "social", {}))?.id, all.ok && all.value.id);
        assert.equal((await activeSuspension(db, { playerId: PETE }, "market", {}))?.scope, "all");
        assert.equal(await activeSuspension(db, { playerId: QUINN }, "social", {}), null);
        assert.equal(await activeSuspension(db, {}, "social", {}), null, "nobody named, nobody found");
        await assert.rejects(activeSuspension(db, { playerId: MIA }, "all" as never, {}), /scope/);
      });

      test("every suspension stands on its own: a later row that is shorter, ended, or for something else doesn't erase it", async () => {
        const ended = (playerId: number, scope: string) => admin.query(`INSERT INTO player_suspensions (player_id, scope, until, reason_code) VALUES ($1, $2, now() - interval '1 minute', 'spam')`, [playerId, scope]);
        const soon = new Date(Date.now() + 7 * 86_400_000);
        // A row whose end has passed closes nothing.
        await ended(PETE, "social");
        assert.equal(await activeSuspension(db, { playerId: PETE }, "social", {}), null);
        // Suspended from everything for good; a Marketplace suspension that has since ended changes nothing.
        const forGood = await suspend(db, { playerId: MIA, scope: "all", until: null, reasonCode: "harassment", actorId: 1 }, {});
        await ended(MIA, "market");
        assert.equal((await activeSuspension(db, { playerId: MIA }, "market", {}))?.id, forGood.ok && forGood.value.id);
        assert.equal((await activeSuspension(db, { playerId: MIA }, "social", {}))?.reasonCode, "harassment");
        // Banned from Social for good; an ended suspension from everything doesn't reopen it.
        await suspend(db, { playerId: QUINN, scope: "social", until: null, reasonCode: "hate", actorId: 1 }, {});
        await ended(QUINN, "all");
        assert.equal((await activeSuspension(db, { playerId: QUINN }, "social", {}))?.reasonCode, "hate");
        assert.equal(await activeSuspension(db, { playerId: QUINN }, "market", {}), null);
        // A week's suspension written after a permanent one doesn't shorten it: the one that lasts longest is the answer.
        await suspend(db, { playerId: QUINN, scope: "social", until: soon, reasonCode: "spam", actorId: 1 }, {});
        assert.deepEqual([(await activeSuspension(db, { playerId: QUINN }, "social", {}))?.until, (await activeSuspension(db, { playerId: QUINN }, "social", {}))?.reasonCode], [null, "hate"]);
        // On its own, a week's suspension says when it ends; of two with an end, the later end.
        await suspend(db, { playerId: SIONE, scope: "social", until: soon, reasonCode: "spam", actorId: 1 }, {});
        await suspend(db, { playerId: SIONE, scope: "all", until: new Date(Date.now() + 86_400_000), reasonCode: "scam", actorId: 1 }, {});
        assert.equal((await activeSuspension(db, { playerId: SIONE }, "social", {}))?.until, soon.toISOString());
        assert.equal((await activeSuspension(db, { playerId: SIONE }, "market", {}))?.reasonCode, "scam");
      });

      test("a suspension is lifted only by a later unsuspend for the same account that covers it", async () => {
        const social = await suspend(db, { playerId: MIA, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, KEYS);
        const lifted = await unsuspend(db, { playerId: MIA, scope: "social", reasonCode: "appeal_upheld", actorId: 2 }, KEYS);
        assert.ok(social.ok && lifted.ok && lifted.value.id > social.value.id);
        assert.equal(await activeSuspension(db, { playerId: MIA, email: "mia.member@golden.test" }, "social", KEYS), null);
        // A lift is a new row, about the account only: it carries no index.
        assert.deepEqual(
          await rows(`SELECT action, scope, reason_code, created_by, until IS NULL AS open, email_index IS NULL AND phone_index IS NULL AND index_kid IS NULL AS bare FROM player_suspensions WHERE player_id = $1 ORDER BY id`, [MIA]),
          [
            { action: "suspend", scope: "social", reason_code: "spam", created_by: 1, open: true, bare: false },
            { action: "unsuspend", scope: "social", reason_code: "appeal_upheld", created_by: 2, open: true, bare: true },
          ],
        );
        // A suspension written after the lift counts again: the lift only reaches back.
        await suspend(db, { playerId: MIA, scope: "all", until: null, reasonCode: "harassment", actorId: 1 }, KEYS);
        assert.equal((await activeSuspension(db, { playerId: MIA }, "social", KEYS))?.reasonCode, "harassment");
        // A lift for Social doesn't narrow a suspension from everything: only a lift of everything ends that one.
        await unsuspend(db, { playerId: MIA, scope: "social", reasonCode: "appeal_upheld", actorId: 2 }, KEYS);
        assert.equal((await activeSuspension(db, { playerId: MIA }, "social", KEYS))?.reasonCode, "harassment");
        assert.equal((await activeSuspension(db, { playerId: MIA }, "market", KEYS))?.reasonCode, "harassment");
        await unsuspend(db, { playerId: MIA, scope: "market", reasonCode: "appeal_upheld", actorId: 2 }, KEYS);
        assert.equal((await activeSuspension(db, { playerId: MIA }, "market", KEYS))?.reasonCode, "harassment");
        await unsuspend(db, { playerId: MIA, scope: "all", reasonCode: "appeal_upheld", actorId: 2 }, KEYS);
        assert.equal(await activeSuspension(db, { playerId: MIA }, "social", KEYS), null);
        assert.equal(await activeSuspension(db, { playerId: MIA }, "market", KEYS), null);
        // A lift of everything ends the narrower ones too; a lift of one thing leaves the other.
        await suspend(db, { playerId: PETE, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, KEYS);
        await suspend(db, { playerId: PETE, scope: "market", until: null, reasonCode: "scam", actorId: 1 }, KEYS);
        await unsuspend(db, { playerId: PETE, scope: "social", reasonCode: "appeal_upheld", actorId: 2 }, KEYS);
        assert.equal(await activeSuspension(db, { playerId: PETE }, "social", KEYS), null);
        assert.equal((await activeSuspension(db, { playerId: PETE }, "market", KEYS))?.reasonCode, "scam");
        await unsuspend(db, { playerId: PETE, scope: "all", reasonCode: "appeal_upheld", actorId: 2 }, KEYS);
        assert.equal(await activeSuspension(db, { playerId: PETE }, "market", KEYS), null);
        // Someone else's lift is not this person's.
        await suspend(db, { playerId: QUINN, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, KEYS);
        await unsuspend(db, { playerId: SIONE, scope: "all", reasonCode: "appeal_upheld", actorId: 2 }, KEYS);
        assert.equal((await activeSuspension(db, { playerId: QUINN }, "social", KEYS))?.reasonCode, "spam");
        // The database refuses a lift that carries an index, whoever writes it.
        await assert.rejects(
          admin.query(`INSERT INTO player_suspensions (player_id, action, scope, reason_code, email_index, index_kid) VALUES ($1, 'unsuspend', 'all', 'appeal_upheld', $2, 'i1')`, [QUINN, "a".repeat(43)]),
          /player_suspensions_unsuspend_names_account_check/,
        );
        await assert.rejects(admin.query(`INSERT INTO player_suspensions (action, scope, reason_code) VALUES ('unsuspend', 'all', 'appeal_upheld')`), /player_suspensions_(unsuspend_names_account|names_someone)_check/);
      });

      test("a suspended email or phone isn't washed clean by a newer ended or lifted row that carries the same index", async () => {
        const made = await suspend(db, { playerId: RUA, scope: "social", until: null, reasonCode: "harassment", actorId: 1 }, KEYS);
        const [row] = await rows(`SELECT email_index, phone_index FROM player_suspensions WHERE id = $1`, [made.ok && made.value.id]);
        // Another account's rows, newer, with the same phone index: one that has ended, and that account's lift of everything.
        await admin.query(`INSERT INTO player_suspensions (player_id, scope, until, reason_code, phone_index, index_kid) VALUES ($1, 'social', now() - interval '1 day', 'spam', $2, 'i1')`, [PETE, row.phone_index]);
        await admin.query(`INSERT INTO player_suspensions (player_id, scope, until, reason_code, email_index, index_kid) VALUES ($1, 'all', now() - interval '1 day', 'spam', $2, 'i1')`, [PETE, row.email_index]);
        await unsuspend(db, { playerId: PETE, scope: "all", reasonCode: "appeal_upheld", actorId: 1 }, {});
        assert.equal((await activeSuspension(db, { phone: "+64215550006" }, "social", KEYS))?.reasonCode, "harassment");
        assert.equal((await activeSuspension(db, { email: "player6@golden.test" }, "social", KEYS))?.reasonCode, "harassment");
        assert.equal((await activeSuspension(db, { playerId: RUA }, "social", KEYS))?.reasonCode, "harassment");
        // And an account with an old, ended suspension of its own is still caught by the suspended email it turns up with.
        assert.equal((await activeSuspension(db, { playerId: PETE, email: "player6@golden.test" }, "social", KEYS))?.reasonCode, "harassment");
        assert.equal(await activeSuspension(db, { playerId: PETE, email: "player4@golden.test" }, "social", KEYS), null);
      });

      test("what a suspension refuses: nobody, a past end date, a reason that isn't a code", async () => {
        const past = new Date(Date.now() - 1000);
        assert.deepEqual(await suspend(db, { playerId: 999999, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, {}), NOT_FOUND);
        assert.deepEqual(await unsuspend(db, { playerId: 999999, scope: "social", reasonCode: "spam", actorId: 1 }, {}), NOT_FOUND);
        assert.deepEqual(await carrySuspensions(db, 999999, {}), NOT_FOUND);
        assert.deepEqual(await suspend(db, { playerId: MIA, scope: "social", until: past, reasonCode: "spam", actorId: 1 }, {}), { ok: false, code: "invalid" });
        assert.deepEqual(await suspend(db, { playerId: MIA, scope: "social", until: new Date("nope"), reasonCode: "spam", actorId: 1 }, {}), { ok: false, code: "invalid" });
        assert.deepEqual(await suspend(db, { playerId: MIA, scope: "social", until: null, reasonCode: "Was rude to Pete", actorId: 1 }, {}), { ok: false, code: "invalid" });
        assert.deepEqual(await suspend(db, { playerId: MIA, scope: "club" as never, until: null, reasonCode: "spam", actorId: 1 }, {}), { ok: false, code: "invalid" });
        assert.deepEqual(await unsuspend(db, { playerId: MIA, scope: "club" as never, reasonCode: "spam", actorId: 1 }, {}), { ok: false, code: "invalid" });
        assert.deepEqual(await rows(`SELECT 1 FROM player_suspensions`), []);
        // A malformed key list is an error, never a quiet "no index".
        for (const call of [
          () => suspend(db, { playerId: MIA, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, { CONTACT_INDEX_KEYS: "i1:too-short" }),
          () => unsuspend(db, { playerId: MIA, scope: "social", reasonCode: "spam", actorId: 1 }, { CONTACT_INDEX_KEYS: "i1:too-short" }),
          () => carrySuspensions(db, MIA, { CONTACT_INDEX_KEYS: "i1:too-short" }),
          () => activeSuspension(db, { playerId: MIA, email: "mia.member@golden.test" }, "social", { CONTACT_INDEX_KEYS: "i1:too-short" }),
        ]) await assert.rejects(call(), /32 bytes/);
        assert.deepEqual(await rows(`SELECT 1 FROM player_suspensions`), []);
      });

      test("with no index key the row is still written, with no index; with one, the email and the verified phone are kept only as indexes", async () => {
        await suspend(db, { playerId: RUA, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, {});
        assert.deepEqual(await rows(`SELECT player_id, email_index, phone_index, index_kid FROM player_suspensions`), [{ player_id: RUA, email_index: null, phone_index: null, index_kid: null }]);
        assert.equal((await activeSuspension(db, { playerId: RUA, email: "player6@golden.test", phone: "+64215550006" }, "social", {}))?.reasonCode, "spam");
        assert.equal(await activeSuspension(db, { email: "player6@golden.test", phone: "+64215550006" }, "social", {}), null, "no key, no match by email or phone");

        await admin.query(`TRUNCATE player_suspensions`);
        await suspend(db, { playerId: RUA, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, KEYS);
        const [row] = await rows(`SELECT * FROM player_suspensions`);
        assert.match(row.email_index, /^[A-Za-z0-9_-]{43}$/);
        assert.match(row.phone_index, /^[A-Za-z0-9_-]{43}$/);
        assert.notEqual(row.email_index, row.phone_index);
        assert.equal(row.index_kid, "i1");
        const text = JSON.stringify(row);
        for (const secret of ["player6", "golden.test", "5550006", "Rua", "Golden"]) assert.ok(!text.includes(secret), secret);
        // Someone with no phone number, and someone whose number was never verified (Mia): an email index only.
        for (const id of [PETE, MIA]) {
          await suspend(db, { playerId: id, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, KEYS);
          const [r] = await rows(`SELECT email_index, phone_index, index_kid FROM player_suspensions WHERE player_id = $1`, [id]);
          assert.ok(r.email_index && r.phone_index === null && r.index_kid === "i1", String(id));
        }
        assert.deepEqual((await rows(`SELECT phone_e164, phone_verified_at FROM players WHERE id = $1`, [MIA]))[0], { phone_e164: "+64215550003", phone_verified_at: null });
        // The suspension index is its own purpose: it is not the players.phone_index of the same number.
        const { phoneSealing } = await import("../lib/pii/contact.ts");
        assert.notEqual(row.phone_index, phoneSealing({ ...KEYS, CONTACT_KEKS: `c1:${key()}` }).currentIndex("+64215550006").index);
      });

      test("only a verified phone number counts: typing someone's number in gets nobody suspended, and gets nobody off", async () => {
        const VICTIM = 12; // seed: +64215550012, verified
        assert.ok((await rows(`SELECT phone_verified_at FROM players WHERE id = $1 AND phone_e164 = '+64215550012'`, [VICTIM]))[0].phone_verified_at);
        try {
          // A troll types the victim's number into their own profile (never verified) and gets suspended.
          await admin.query(`UPDATE players SET phone = '+64215550012', phone_e164 = '+64215550012', phone_verified_at = NULL WHERE id = $1`, [PETE]);
          await suspend(db, { playerId: PETE, scope: "all", until: null, reasonCode: "harassment", actorId: 1 }, KEYS);
          assert.equal((await rows(`SELECT phone_index FROM player_suspensions WHERE player_id = $1`, [PETE]))[0].phone_index, null);
          assert.equal(await activeSuspension(db, { playerId: VICTIM, email: "player12@golden.test", phone: "+64215550012" }, "social", KEYS), null, "the victim is not suspended");
          assert.equal(await activeSuspension(db, { phone: "+64215550012" }, "social", KEYS), null);
          assert.equal((await activeSuspension(db, { playerId: PETE, email: "player4@golden.test", phone: "+64215550012" }, "social", KEYS))?.reasonCode, "harassment");

          // The other way round: Rua (verified +64215550006) is suspended. An account that only typed that number in doesn't match by it.
          await admin.query(`TRUNCATE player_suspensions`);
          await suspend(db, { playerId: RUA, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, KEYS);
          await admin.query(`UPDATE players SET phone = '+64215550006', phone_e164 = '+64215550006', phone_verified_at = NULL WHERE id = $1`, [PETE]);
          assert.equal(await activeSuspension(db, { playerId: PETE, email: "player4@golden.test", phone: "+64215550006" }, "social", KEYS), null, "a number this account hasn't proved is its own");
          assert.equal(await activeSuspension(db, { playerId: PETE, email: "player4@golden.test", phone: "+64215559999" }, "social", KEYS), null, "nor a number that isn't the account's at all");
          // Once that account has verified the number (Rua's own account has let it go), it is the suspended number's holder.
          await admin.query(`UPDATE players SET phone = NULL, phone_e164 = NULL, phone_verified_at = NULL WHERE id = $1`, [RUA]);
          await admin.query(`UPDATE players SET phone_verified_at = now() WHERE id = $1`, [PETE]);
          assert.equal((await activeSuspension(db, { playerId: PETE, email: "player4@golden.test", phone: "021 555 0006" }, "social", KEYS))?.reasonCode, "spam");
          // With no account named (a number just proved by its code at sign-up), the caller vouches for it.
          assert.equal((await activeSuspension(db, { phone: "+64215550006" }, "social", KEYS))?.reasonCode, "spam");
        } finally {
          await admin.query(`UPDATE players SET phone = NULL, phone_e164 = NULL, phone_verified_at = NULL WHERE id = $1`, [PETE]);
          await admin.query(`UPDATE players SET phone = '021 555 0006', phone_e164 = '+64215550006', phone_verified_at = now() - interval '30 days' WHERE id = $1`, [RUA]);
        }
      });

      test("Review Focus 7: a suspension outlives the account, and the same email or phone is still suspended", async () => {
        const { deletePlayerAccount } = await import("../lib/player-db.ts");
        const made = await suspend(db, { playerId: RUA, scope: "social", until: null, reasonCode: "harassment", actorId: 1 }, KEYS);
        assert.equal(made.ok, true);
        await profile(RUA, "Rua");
        // The app's own delete (lib/player-db.ts), on this mode's connection.
        const before = (await rows(`SELECT email, phone_e164 FROM players WHERE id = $1`, [RUA]))[0];
        assert.deepEqual(before, { email: "player6@golden.test", phone_e164: "+64215550006" });
        try {
          await deletePlayerAccount(RUA);
          const gone = (await rows(`SELECT email, phone_e164, deleted_at IS NOT NULL AS deleted FROM players WHERE id = $1`, [RUA]))[0];
          assert.deepEqual(gone, { email: `deleted-${RUA}@deleted.invalid`, phone_e164: null, deleted: true });
          assert.equal((await rows(`SELECT count(*)::int AS n FROM player_suspensions`))[0].n, 1, "the row is still there");
          assert.equal((await activeSuspension(db, { playerId: RUA }, "social", KEYS))?.reasonCode, "harassment");

          // They sign up again: a new account, the same email, or only the same phone (verified again), however it is typed.
          const [again] = await rows(`INSERT INTO players (email, first_name, last_name) VALUES ('player6@golden.test', 'Rua', 'Again') RETURNING id`);
          const id = Number(again.id);
          assert.equal((await activeSuspension(db, { playerId: id, email: "player6@golden.test" }, "social", KEYS))?.reasonCode, "harassment");
          assert.equal((await activeSuspension(db, { playerId: id, email: "  Player6@Golden.TEST " }, "social", KEYS))?.reasonCode, "harassment");
          assert.equal(await activeSuspension(db, { playerId: id, email: "new.address@golden.test", phone: "021 555 0006" }, "social", KEYS), null, "the number isn't this account's yet");
          await admin.query(`UPDATE players SET phone_e164 = '+64215550006', phone_verified_at = now() WHERE id = $1`, [id]);
          assert.equal((await activeSuspension(db, { playerId: id, email: "new.address@golden.test", phone: "021 555 0006" }, "social", KEYS))?.reasonCode, "harassment");
          assert.equal((await activeSuspension(db, { playerId: id, phone: "+64215550006" }, "social", KEYS))?.id, made.ok && made.value.id);
          assert.equal(await activeSuspension(db, { playerId: id, email: "new.address@golden.test", phone: "021 555 9999" }, "social", KEYS), null, "another email and phone");
          assert.equal(await activeSuspension(db, { playerId: id, email: "player6@golden.test", phone: "+64215550006" }, "market", KEYS), null, "a Social suspension");
          assert.equal(await activeSuspension(db, { email: `deleted-${RUA}@deleted.invalid` }, "social", KEYS), null);
          // Without the key nothing matches by email or phone, and another key finds nothing.
          assert.equal(await activeSuspension(db, { playerId: id, email: "player6@golden.test", phone: "+64215550006" }, "social", {}), null);
          assert.equal(await activeSuspension(db, { playerId: id, email: "player6@golden.test" }, "social", { CONTACT_INDEX_KEYS: `i9:${key()}` }), null);
          // After a key rotation the old rows still match, under the older key in the list.
          const rotated = { CONTACT_INDEX_KEYS: `i2:${key()},${KEYS.CONTACT_INDEX_KEYS}` };
          assert.equal((await activeSuspension(db, { playerId: id, email: "player6@golden.test" }, "social", rotated))?.reasonCode, "harassment");
          assert.equal((await activeSuspension(db, { playerId: id, phone: "+64215550006" }, "social", rotated))?.reasonCode, "harassment");

          // A moderator lifts it for the new account. The lift is written for the account the suspension names
          // too (the deleted one), which is the only thing that ends that row.
          const lifted = await unsuspend(db, { playerId: id, scope: "social", reasonCode: "appeal_upheld", actorId: 1 }, rotated);
          assert.equal(lifted.ok, true);
          assert.deepEqual(
            (await rows(`SELECT player_id, email_index IS NULL AND phone_index IS NULL AS bare FROM player_suspensions WHERE action = 'unsuspend' ORDER BY player_id`)),
            [{ player_id: RUA, bare: true }, { player_id: id, bare: true }].sort((a, b) => a.player_id - b.player_id),
          );
          assert.equal((await rows(`SELECT player_id FROM player_suspensions WHERE id = $1`, [lifted.ok && lifted.value.id]))[0].player_id, id, "the id returned is this account's row");
          assert.equal(await activeSuspension(db, { playerId: id, email: "player6@golden.test", phone: "+64215550006" }, "social", rotated), null);
          assert.equal(await activeSuspension(db, { playerId: RUA }, "social", rotated), null);
          assert.equal(await activeSuspension(db, { phone: "+64215550006" }, "social", rotated), null);

          // The row also survives the account's row itself being removed. (An account nothing else points at.)
          const [fresh] = await rows(`INSERT INTO players (email, first_name, last_name, phone_e164, phone_verified_at) VALUES ('fresh.start@nowhere.test', 'Fresh', 'Start', '+64215557777', now()) RETURNING id`);
          const freshId = Number(fresh.id);
          await suspend(db, { playerId: freshId, scope: "all", until: null, reasonCode: "harassment", actorId: 1 }, rotated);
          await db.query(`DELETE FROM players WHERE id = $1`, [freshId]);
          assert.deepEqual(await rows(`SELECT 1 FROM players WHERE id = $1`, [freshId]), []);
          assert.equal((await rows(`SELECT count(*)::int AS n FROM player_suspensions WHERE player_id = $1`, [freshId]))[0].n, 1);
          assert.equal((await rows(`SELECT index_kid FROM player_suspensions WHERE player_id = $1`, [freshId]))[0].index_kid, "i2");
          assert.equal((await activeSuspension(db, { email: "fresh.start@nowhere.test" }, "social", rotated))?.scope, "all");
          assert.equal((await activeSuspension(db, { phone: "+64215557777" }, "market", rotated))?.scope, "all");
          assert.equal((await activeSuspension(db, { playerId: freshId }, "market", rotated))?.scope, "all");
        } finally {
          // Put the fixture back for the next mode: the second account steps aside, Rua's own returns.
          await admin.query(`UPDATE players SET email = 'again-' || id || '@nowhere.test', phone_e164 = NULL, phone_verified_at = NULL, deleted_at = now() WHERE email = 'player6@golden.test' AND id <> $1`, [RUA]);
          await admin.query(`UPDATE players SET deleted_at = NULL, email = 'player6@golden.test', phone = '021 555 0006', phone_e164 = '+64215550006', phone_verified_at = now() - interval '30 days', first_name = 'Rua', last_name = 'Golden6' WHERE id = $1`, [RUA]);
          await admin.query(`INSERT INTO player_sessions (player_id, token_hash, user_agent, expires_at) VALUES ($1, md5('golden-session-again-' || $2), 'golden', now() + interval '60 days')`, [RUA, mode]);
        }
      });

      test("Review Focus 7, the long way round: a new email and phone before deleting; the suspension is carried over to them", async () => {
        const { deletePlayerAccount } = await import("../lib/player-db.ts");
        const week = new Date(Date.now() + 7 * 86_400_000);
        await suspend(db, { playerId: RUA, scope: "social", until: null, reasonCode: "harassment", actorId: 2 }, KEYS);
        await suspend(db, { playerId: RUA, scope: "market", until: week, reasonCode: "scam", actorId: 1 }, KEYS);
        // Not carried: one already lifted, one already over.
        await suspend(db, { playerId: RUA, scope: "market", until: null, reasonCode: "spam", actorId: 1 }, KEYS);
        await unsuspend(db, { playerId: RUA, scope: "market", reasonCode: "appeal_upheld", actorId: 1 }, KEYS);
        await suspend(db, { playerId: RUA, scope: "market", until: week, reasonCode: "scam", actorId: 1 }, KEYS);
        await admin.query(`INSERT INTO player_suspensions (player_id, scope, until, reason_code) VALUES ($1, 'all', now() - interval '1 minute', 'hate')`, [RUA]);
        try {
          // Nothing to carry while the email and phone are the ones on the rows.
          assert.deepEqual(await carrySuspensions(db, RUA, KEYS), { ok: true, value: { carried: 0 } });
          // They change both, then would delete the account and come back with the new ones.
          await admin.query(`UPDATE players SET email = 'rua.new@nowhere.test', phone = '+64215558888', phone_e164 = '+64215558888', phone_verified_at = now() WHERE id = $1`, [RUA]);
          assert.equal(await activeSuspension(db, { email: "rua.new@nowhere.test" }, "social", KEYS), null, "the hole: the rows only know the old email and phone");
          assert.equal(await activeSuspension(db, { phone: "+64215558888" }, "social", KEYS), null);
          // Without a key there is nothing to write.
          assert.deepEqual(await carrySuspensions(db, RUA, {}), { ok: true, value: { carried: 0 } });
          const count = async () => (await rows(`SELECT count(*)::int AS n FROM player_suspensions`))[0].n;
          const was = await count();
          assert.deepEqual(await carrySuspensions(db, RUA, KEYS), { ok: true, value: { carried: 2 } });
          assert.equal(await count(), was + 2);
          assert.deepEqual(await carrySuspensions(db, RUA, KEYS), { ok: true, value: { carried: 0 } }, "again: nothing new");
          assert.equal(await count(), was + 2);
          const carried = await rows(`SELECT player_id, action, scope, until, reason_code, created_by, index_kid, email_index, phone_index FROM player_suspensions ORDER BY id DESC LIMIT 2`);
          assert.deepEqual(
            carried.map((r) => [r.player_id, r.action, r.scope, r.until?.toISOString() ?? null, r.reason_code, r.created_by, r.index_kid]).sort(),
            [[RUA, "suspend", "market", week.toISOString(), "scam", 1, "i1"], [RUA, "suspend", "social", null, "harassment", 2, "i1"]].sort(),
          );
          assert.ok(carried.every((r) => /^[A-Za-z0-9_-]{43}$/.test(r.email_index) && /^[A-Za-z0-9_-]{43}$/.test(r.phone_index)));

          await deletePlayerAccount(RUA);
          const [again] = await rows(`INSERT INTO players (email, first_name, last_name) VALUES ('rua.new@nowhere.test', 'Rua', 'Again') RETURNING id`);
          const id = Number(again.id);
          assert.deepEqual(await activeSuspension(db, { playerId: id, email: "rua.new@nowhere.test" }, "social", KEYS).then((s) => [s?.reasonCode, s?.until]), ["harassment", null]);
          assert.deepEqual(await activeSuspension(db, { playerId: id, email: "rua.new@nowhere.test" }, "market", KEYS).then((s) => [s?.reasonCode, s?.until]), ["scam", week.toISOString()]);
          await admin.query(`UPDATE players SET email = 'third.address@nowhere.test', phone_e164 = '+64215558888', phone_verified_at = now() WHERE id = $1`, [id]);
          assert.equal((await activeSuspension(db, { playerId: id, email: "third.address@nowhere.test", phone: "+64215558888" }, "social", KEYS))?.reasonCode, "harassment", "by the new phone alone");
          // The old email and phone are still suspended too.
          assert.equal((await activeSuspension(db, { email: "player6@golden.test" }, "social", KEYS))?.reasonCode, "harassment");
          assert.equal((await activeSuspension(db, { phone: "+64215550006" }, "social", KEYS))?.reasonCode, "harassment");
          // An account caught by an earlier account's suspension carries it on to its own new email as well.
          assert.deepEqual(await carrySuspensions(db, id, KEYS), { ok: true, value: { carried: 2 } });
          assert.equal((await activeSuspension(db, { email: "third.address@nowhere.test" }, "social", KEYS))?.reasonCode, "harassment");
          // One lift for the person in front of the moderator ends the rows of every account it came through.
          await unsuspend(db, { playerId: id, scope: "all", reasonCode: "appeal_upheld", actorId: 1 }, KEYS);
          for (const who of [{ playerId: id, email: "third.address@nowhere.test", phone: "+64215558888" }, { playerId: RUA }, { email: "rua.new@nowhere.test" }, { email: "third.address@nowhere.test" }]) {
            assert.equal(await activeSuspension(db, who, "social", KEYS), null, JSON.stringify(who));
            assert.equal(await activeSuspension(db, who, "market", KEYS), null, JSON.stringify(who));
          }
        } finally {
          await admin.query(`UPDATE players SET email = 'again-' || id || '@nowhere.test', phone_e164 = NULL, phone_verified_at = NULL, deleted_at = now() WHERE email IN ('rua.new@nowhere.test', 'third.address@nowhere.test') AND id <> $1`, [RUA]);
          await admin.query(`UPDATE players SET deleted_at = NULL, email = 'player6@golden.test', phone = '021 555 0006', phone_e164 = '+64215550006', phone_verified_at = now() - interval '30 days', first_name = 'Rua', last_name = 'Golden6' WHERE id = $1`, [RUA]);
          await admin.query(`INSERT INTO player_sessions (player_id, token_hash, user_agent, expires_at) VALUES ($1, md5('golden-session-carry-' || $2), 'golden', now() + interval '60 days')`, [RUA, mode]);
        }
      });

      test("the SQL fragment for feeds agrees with activeSuspension, by account", async () => {
        const ended = (playerId: number, scope: string) => admin.query(`INSERT INTO player_suspensions (player_id, scope, until, reason_code) VALUES ($1, $2, now() - interval '1 minute', 'spam')`, [playerId, scope]);
        await suspend(db, { playerId: MIA, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, {});
        await ended(MIA, "all");
        await suspend(db, { playerId: PETE, scope: "market", until: null, reasonCode: "scam", actorId: 1 }, {});
        await suspend(db, { playerId: QUINN, scope: "all", until: null, reasonCode: "spam", actorId: 1 }, {});
        await unsuspend(db, { playerId: QUINN, scope: "social", reasonCode: "appeal_upheld", actorId: 1 }, {});
        await ended(QUINN, "market");
        await suspend(db, { playerId: SIONE, scope: "social", until: null, reasonCode: "spam", actorId: 1 }, {});
        await unsuspend(db, { playerId: SIONE, scope: "social", reasonCode: "appeal_upheld", actorId: 1 }, {});
        await ended(LINH, "social");
        await suspend(db, { playerId: NAM, scope: "all", until: new Date(Date.now() + 60_000), reasonCode: "spam", actorId: 1 }, {});
        await unsuspend(db, { playerId: NAM, scope: "all", reasonCode: "appeal_upheld", actorId: 1 }, {});
        await suspend(db, { playerId: NAM, scope: "market", until: new Date(Date.now() + 60_000), reasonCode: "spam", actorId: 1 }, {});
        const everyone = [MIA, PETE, QUINN, SIONE, LINH, NAM];
        const suspended: Record<string, number[]> = { social: [MIA, QUINN], market: [PETE, QUINN, NAM] };
        for (const scope of ["social", "market"] as const) {
          const free = (await db.query(`SELECT sp.player_id FROM social_profiles sp WHERE ${notSuspendedSql("sp.player_id", scope)} ORDER BY 1`)).rows.map((r) => r.player_id);
          const expected: number[] = [];
          for (const id of everyone) if (!(await activeSuspension(db, { playerId: id }, scope, {}))) expected.push(id);
          assert.deepEqual(free, expected.sort((a, b) => a - b), scope);
          assert.deepEqual(free, everyone.filter((id) => !suspended[scope].includes(id)).sort((a, b) => a - b), scope);
          assert.deepEqual((await db.query(`SELECT sp.player_id FROM social_profiles sp WHERE NOT (${notSuspendedSql("sp.player_id", scope)}) ORDER BY 1`)).rows.map((r) => r.player_id), [...suspended[scope]].sort((a, b) => a - b), scope);
        }
      });
    });
  }
});
