// Social plan, Task 4: posts (lib/social/posts.ts), comments and kudos
// (comments.ts), the feed (feed.ts) and the posts that write themselves
// (auto-posts.ts). Against a real Postgres, with two
// clubs, once as the database owner (TENANT_SCOPE=off) and once as the app's
// role for one club (TENANT_SCOPE=enforce). Made-up people only.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { COMMUNITY_RULES_VERSION, POST_STATES, SOCIAL_LIMITS, canSeePost, type PostState } from "@luvallplay/core/social";
import { migrate } from "../scripts/db/migrate.mjs";
import { fileReport } from "../lib/moderation/reports.ts";
import { moderationSeal } from "../lib/moderation/seal.ts";
import { newPublicId } from "../lib/social/public-id.ts";
import { POSTS_PER_DAY, createPost, deletePost, loadVisiblePost, postVisibleSql } from "../lib/social/posts.ts";
import { COMMENTS_PER_DAY, addComment, commentVisibleSql, deleteComment, kudosCountedSql, listComments, setKudos } from "../lib/social/comments.ts";
import { feed, profilePosts, type FeedCursor, type FeedPost } from "../lib/social/feed.ts";
import { AUTO_POSTS_PER_DAY, postConfirmedMatch, postRankUp } from "../lib/social/auto-posts.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `social_feed_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const STORE = "https://store.example/files";
const key = () => randomBytes(32).toString("base64");
const NOT_FOUND = { ok: false, code: "not_found" } as const;
type TxClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; command?: string }>; release(destroy?: Error | boolean): void };

test("the SQL pieces take only parameters, so nothing typed can reach them", () => {
  assert.throws(() => postVisibleSql("1", "$2", "$3"), /not a parameter/);
  assert.throws(() => postVisibleSql("$1", "$2", "$3; DROP"), /not a parameter/);
  assert.throws(() => commentVisibleSql("viewer"), /not a parameter/);
  assert.throws(() => kudosCountedSql("$0"), /not a parameter/);
});

describe("posts, comments, kudos, the feed and automatic posts", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const saved = { ...process.env };
  let admin: pg.Client;
  let database: typeof import("../lib/database.ts");
  let club2 = 0;
  // Seed accounts in Three Wolves (club 1): 3 Mia, 4 Pete, 5 Quinn, 7 Sione (also in club 2), 8 Tama.
  const MIA = 3;
  const PETE = 4;
  const QUINN = 5;
  const SIONE = 7;
  const TAMA = 8;
  // Hanoi Smash (club 2) only.
  let LINH = 0;
  let NAM = 0;
  const KEYS = { MODERATION_KEKS: `m1:${key()}` };
  const seal = moderationSeal(KEYS);
  const prod = (pilot: string) => ({ VERCEL_ENV: "production", SOCIAL_AVAILABILITY: "available", SOCIAL_PILOT_TENANTS: pilot });
  const rows = async (text: string, params: unknown[] = []) => (await admin.query(text, params)).rows;
  const publicIds = new Map<number, string>();
  const pid = (playerId: number) => publicIds.get(playerId)!;
  let n = 0;

  /** A social profile written straight to the table (opting in is Task 3's test). */
  async function join(playerId: number, displayName: string, visibility: "club" | "everyone" = "club") {
    const publicId = newPublicId();
    await admin.query(`INSERT INTO social_profiles (player_id, public_id, display_name, visibility, adult_confirmed_at, rules_version) VALUES ($1, $2, $3, $4, now(), $5)`, [playerId, publicId, displayName, visibility, COMMUNITY_RULES_VERSION]);
    publicIds.set(playerId, publicId);
  }
  /** Everyone used below, opted in. */
  async function everyone() {
    await join(MIA, "Smash Queen");
    await join(PETE, "Pete the Smash");
    await join(QUINN, "Quinn Q");
    await join(SIONE, "Sione S");
    await join(TAMA, "Tama T");
    await join(LINH, "Linh N");
    await join(NAM, "Nam T");
  }
  /** A post written straight to the table. */
  async function rawPost(authorId: number, clubId: number, o: { state?: PostState; body?: string; at?: string; kind?: string; refKey?: string; photoId?: number } = {}) {
    const kind = o.kind ?? (o.photoId ? "photo" : "text");
    const r = await rows(
      `INSERT INTO social_posts (author_id, club_id, kind, body, ref_key, photo_id, state, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, clock_timestamp())) RETURNING id`,
      [authorId, clubId, kind, kind === "text" || kind === "photo" ? (o.body ?? `post ${++n}`) : null, o.refKey ?? null, o.photoId ?? null, o.state ?? "visible", o.at ?? null],
    );
    return Number(r[0].id);
  }
  const rawComment = async (postId: number, authorId: number, body = "Nice one", state: PostState = "visible") =>
    Number((await rows(`INSERT INTO social_comments (post_id, author_id, body, state) VALUES ($1, $2, $3, $4) RETURNING id`, [postId, authorId, body, state]))[0].id);
  const blockRow = (a: number, b: number) => admin.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [a, b]);
  const followRow = (a: number, b: number) => admin.query(`INSERT INTO social_follows (follower_id, followee_id) VALUES ($1, $2)`, [a, b]);
  const suspendRow = (playerId: number) => admin.query(`INSERT INTO player_suspensions (player_id, scope, reason_code) VALUES ($1, 'social', 'spam')`, [playerId]);
  const banRow = (clubId: number, playerId: number) => admin.query(`INSERT INTO social_club_bans (club_id, player_id) VALUES ($1, $2)`, [clubId, playerId]);
  /** A post's photo written straight to the table, as the owner. */
  async function photo(playerId: number, status = "approved", clubId = 1) {
    const url = `${STORE}/social-photos/${playerId}/${++n}-d.jpg`;
    const r = await rows(
      `INSERT INTO player_photos (tenant_id, player_id, purpose, status, original_url, display_url, thumb_url, width, height, bytes) VALUES ($1, $2, 'social', $3, $4, $4, $4, 1200, 800, 1000) RETURNING id`,
      [clubId, playerId, status, url],
    );
    return { id: Number(r[0].id), url };
  }
  /** An Arena game: Mia and Pete (posting) against Quinn and Tama (accepting), in club 1 unless said. */
  async function challenge(status: string, o: { posting?: number | null; accepting?: number | null; retiredBy?: string; clubId?: number; enteredBy?: number; enteredAgo?: string } = {}) {
    const r = await rows(
      `INSERT INTO arena_challenges (tenant_id, posting_pair, p1, p2, accepting_pair, a1, a2, status, available_until, posted_by, score_posting, score_accepting, retired_by, entered_by, entered_at, completed_at)
       VALUES ($1, 901, $2, $3, 902, $4, $5, $6, now() + interval '1 day', $2, $7, $8, $9, $10, now() - $11::interval, CASE WHEN $6 = 'completed' THEN now() END) RETURNING id`,
      [o.clubId ?? 1, MIA, PETE, QUINN, TAMA, status, o.posting === undefined ? 21 : o.posting, o.accepting === undefined ? 15 : o.accepting, o.retiredBy ?? null, o.enteredBy ?? MIA, o.enteredAgo ?? "1 minute"],
    );
    return Number(r[0].id);
  }
  const posts = async (where = "TRUE") => rows(`SELECT id, author_id, club_id, kind, ref_key, state, body, photo_id FROM social_posts WHERE ${where} ORDER BY id`);
  /** Nothing a person is sent may carry an account id, a real name, an email or a phone. */
  async function assertNoIdentity(payload: unknown, accounts: number[]) {
    const people = await rows(`SELECT id, email, first_name, last_name FROM players WHERE id = ANY($1::int[])`, [accounts]);
    const text = JSON.stringify(payload);
    for (const p of people) for (const secret of [p.email, p.last_name]) assert.ok(!text.includes(String(secret)), `${secret} in ${text}`);
    const walk = (v: unknown, path: string): void => {
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
        assert.doesNotMatch(k, /^(player_?id|author_?id|first_?name|last_?name|email|phone.*)$/i, `${path}.${k}`);
        walk(x, `${path}.${k}`);
      }
    };
    walk(payload, "");
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
      await admin.query(`INSERT INTO players (email, first_name, last_name) VALUES ('linh@hanoi.test', 'Linh', 'Nguyenova'), ('nam@hanoi.test', 'Nam', 'Tranova') RETURNING id`)
    ).rows.map((r) => Number(r.id));
    await admin.query(`INSERT INTO club_members (tenant_id, user_id, role, status) VALUES ($1, $2, 'member', 'active'), ($1, $3, 'member', 'active'), ($1, $4, 'member', 'active')`, [club2, LINH, NAM, SIONE]);
    process.env.POSTGRES_URL = urlFor(NAME);
    process.env.DATABASE_DRIVER = "postgres";
    process.env.TENANT_SLUG = "three-wolves";
    delete process.env.TENANT_SCOPE;
    delete process.env.APP_DATABASE_URL;
    delete process.env.ARENA_TABLE_PREFIX;
    delete process.env.VERCEL_ENV;
    delete process.env.SOCIAL_PILOT_TENANTS;
    delete process.env.MODERATION_KEKS;
    // How a test or a preview opens Social; production has only the pilot list.
    process.env.SOCIAL_AVAILABILITY = "available";
    database = await import("../lib/database.ts");
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

  for (const mode of ["off", "enforce"] as const) {
    describe(`TENANT_SCOPE=${mode}`, () => {
      let db: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; connect: () => Promise<TxClient> };
      const ids = (page: { posts: FeedPost[] }) => page.posts.map((p) => p.id);

      before(async () => {
        await database.closeDatabase();
        process.env.TENANT_SCOPE = mode;
        db = { query: (text, params) => database.sql.query(text, params), connect: () => database.sql.connect() };
      });
      beforeEach(async () => {
        await admin.query(`TRUNCATE content_reports, moderation_evidence, moderation_actions CASCADE`);
        await admin.query(`TRUNCATE social_follows, user_blocks, social_kudos, social_comments, social_posts, social_club_bans, social_profiles, player_suspensions`);
        await admin.query(`DELETE FROM player_photos WHERE id > 10`);
        await admin.query(`DELETE FROM arena_challenges WHERE posting_pair = 901`);
        await admin.query(`DELETE FROM arena_player_ranks WHERE player_id = $1`, [MIA]);
        await admin.query(`DELETE FROM club_roles WHERE player_id = $1`, [PETE]);
        await admin.query(`UPDATE players SET deleted_at = NULL WHERE id IN ($1, $2, $3, $4, $5, $6, $7)`, [MIA, PETE, QUINN, SIONE, TAMA, LINH, NAM]);
        await admin.query(`UPDATE club_members SET status = 'active' WHERE user_id IN ($1, $2, $3, $4, $5, $6, $7)`, [MIA, PETE, QUINN, SIONE, TAMA, LINH, NAM]);
        await admin.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES (1, 'social', true), ($1, 'social', true) ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = true`, [club2]);
        publicIds.clear();
      });

      test("the connection is what the mode says", async () => {
        const who = (await db.query(`SELECT current_user AS role, current_setting('app.tenant_id', true) AS club`)).rows[0];
        if (mode === "enforce") assert.deepEqual(who, { role: "luvallplay_app", club: "1" });
        else assert.notEqual(who.role, "luvallplay_app");
      });

      test("the gate in SQL answers as canSeePost does, for every combination", async () => {
        await everyone();
        const post = await rawPost(PETE, 1);
        let checked = 0;
        for (const postState of POST_STATES)
          for (const blocked of ["no", "viewer", "author"] as const)
            for (const authorSuspended of [false, true])
              for (const authorDeleted of [false, true])
                for (const authorVisibility of ["club", "everyone"] as const)
                  for (const follows of [false, true])
                    for (const sharesPostClub of [true, false])
                      for (const bannedInPostClub of [false, true]) {
                        // Mia is in the post's club; Linh is only in the other one.
                        const viewer = sharesPostClub ? MIA : LINH;
                        await admin.query(
                          `TRUNCATE user_blocks, social_follows, social_club_bans, player_suspensions;
                           UPDATE social_posts SET state = '${postState}' WHERE id = ${post};
                           UPDATE social_profiles SET visibility = '${authorVisibility}' WHERE player_id = ${PETE};
                           UPDATE players SET deleted_at = ${authorDeleted ? "now()" : "NULL"} WHERE id = ${PETE};
                           ${blocked === "viewer" ? `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${viewer}, ${PETE});` : ""}
                           ${blocked === "author" ? `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${PETE}, ${viewer});` : ""}
                           ${authorSuspended ? `INSERT INTO player_suspensions (player_id, scope, reason_code) VALUES (${PETE}, 'social', 'spam');` : ""}
                           ${follows ? `INSERT INTO social_follows (follower_id, followee_id) VALUES (${viewer}, ${PETE});` : ""}
                           ${bannedInPostClub ? `INSERT INTO social_club_bans (club_id, player_id) VALUES (1, ${viewer});` : ""}`,
                        );
                        const facts = { viewerId: viewer, authorId: PETE, authorSuspended, authorDeleted, authorVisibility, postState, blockedEitherWay: blocked !== "no", follows, sharesPostClub, bannedInPostClub };
                        const seen = (await loadVisiblePost(db, viewer, post)) !== null;
                        assert.equal(seen, canSeePost(facts), JSON.stringify(facts));
                        // The feed and the by-id read are one rule.
                        if (checked++ % 7 === 0) assert.equal(ids(await feed(db, viewer)).includes(post), seen, `feed: ${JSON.stringify(facts)}`);
                      }
        assert.equal(checked, 4 * 3 * 2 * 2 * 2 * 2 * 2 * 2);
        // The author's own post, in every state, whatever else is true around them.
        await admin.query(`TRUNCATE user_blocks, social_follows, social_club_bans, player_suspensions; UPDATE players SET deleted_at = NULL WHERE id = ${PETE}`);
        for (const postState of POST_STATES)
          for (const banned of [false, true]) {
            await admin.query(`UPDATE social_posts SET state = '${postState}' WHERE id = ${post}; TRUNCATE social_club_bans; ${banned ? `INSERT INTO social_club_bans (club_id, player_id) VALUES (1, ${PETE});` : ""}`);
            const facts = { viewerId: PETE, authorId: PETE, authorSuspended: false, authorDeleted: false, authorVisibility: "club" as const, postState, blockedEitherWay: false, follows: false, sharesPostClub: true, bannedInPostClub: banned };
            assert.equal((await loadVisiblePost(db, PETE, post)) !== null, canSeePost(facts), JSON.stringify(facts));
            assert.equal(ids(await feed(db, PETE)).includes(post), canSeePost(facts), `feed: ${JSON.stringify(facts)}`);
          }
      });

      test("the gate also hides: a banned author's posts in that club, an author with no club left, a viewer without access, ids that aren't ids", async () => {
        await everyone();
        const post = await rawPost(PETE, 1);
        assert.equal((await loadVisiblePost(db, MIA, post))?.id, post);
        assert.deepEqual(Object.keys((await loadVisiblePost(db, MIA, post))!).sort(), ["authorId", "body", "clubId", "createdAt", "id", "kind", "mine", "photoId", "state"]);
        // The club bans the AUTHOR: its space no longer shows them to anyone else.
        await banRow(1, PETE);
        assert.equal(await loadVisiblePost(db, MIA, post), null);
        assert.deepEqual(ids(await feed(db, MIA)), []);
        assert.equal((await loadVisiblePost(db, PETE, post))?.mine, true, "the author still sees their own");
        await admin.query(`TRUNCATE social_club_bans`);
        // The author leaves their last club with Social (Review Focus 2): the row stays, the post is out of sight.
        await admin.query(`UPDATE club_members SET status = 'disabled' WHERE user_id = $1`, [PETE]);
        assert.equal(await loadVisiblePost(db, MIA, post), null);
        assert.deepEqual(ids(await feed(db, MIA)), []);
        assert.equal((await posts()).length, 1);
        await admin.query(`UPDATE club_members SET status = 'active' WHERE user_id = $1`, [PETE]);
        assert.equal((await loadVisiblePost(db, MIA, post))?.id, post);
        // A viewer who may not use Social sees nothing: suspended, Social closed for the deployment, not an account.
        await suspendRow(MIA);
        assert.equal(await loadVisiblePost(db, MIA, post), null);
        assert.deepEqual(await feed(db, MIA), { posts: [], next: null });
        await admin.query(`TRUNCATE player_suspensions`);
        assert.equal(await loadVisiblePost(db, MIA, post, { env: {} }), null);
        assert.deepEqual(await feed(db, MIA, null, 20, { env: {} }), { posts: [], next: null });
        // The pilot list: a club that isn't on it has no Social, whatever its row says.
        assert.equal((await loadVisiblePost(db, MIA, post, { env: prod("1") }))?.id, post);
        assert.equal(await loadVisiblePost(db, MIA, post, { env: prod(String(club2)) }), null);
        const there = await rawPost(LINH, club2);
        assert.deepEqual(ids(await feed(db, SIONE)), [there, post]);
        assert.deepEqual(ids(await feed(db, SIONE, null, 20, { env: prod("1") })), [post], "Sione's other club isn't a pilot club");
        for (const id of [0, -1, 1.5, "1", null, undefined, Number.NaN, 2 ** 60, {}]) assert.equal(await loadVisiblePost(db, MIA, id), null, String(id));
        for (const viewer of [0, 999999, Number.NaN, "3" as unknown as number]) assert.equal(await loadVisiblePost(db, viewer, post), null);
      });

      // Review Focus 6: every by-id call, on everything the viewer (Mia) can't see, answers as for an id nobody has.
      const HIDDEN: Record<string, () => Promise<{ post: number; own: number; other: number }>> = {
        "an id nobody has": async () => ({ post: 999_999, own: 999_998, other: 999_997 }),
        "a held post": () => hiddenPost(PETE, 1, TAMA, async (p) => void (await admin.query(`UPDATE social_posts SET state = 'held' WHERE id = $1`, [p]))),
        "a hidden post": () => hiddenPost(PETE, 1, TAMA, async (p) => void (await admin.query(`UPDATE social_posts SET state = 'hidden' WHERE id = $1`, [p]))),
        "a removed post": () => hiddenPost(PETE, 1, TAMA, async (p) => void (await admin.query(`UPDATE social_posts SET state = 'removed' WHERE id = $1`, [p]))),
        "another club's `club` post, by someone she follows": () => hiddenPost(NAM, club2, LINH, async () => void (await followRow(MIA, NAM))),
        "a post whose author blocked her": () => hiddenPost(PETE, 1, TAMA, async () => void (await blockRow(PETE, MIA))),
        "a post whose author she blocked": () => hiddenPost(PETE, 1, TAMA, async () => void (await blockRow(MIA, PETE))),
        "a suspended author's post": () => hiddenPost(PETE, 1, TAMA, async () => void (await suspendRow(PETE))),
        "a deleted account's post": () => hiddenPost(PETE, 1, TAMA, async () => void (await admin.query(`UPDATE players SET deleted_at = now() WHERE id = $1`, [PETE]))),
        "a post in a club that banned her": () => hiddenPost(PETE, 1, TAMA, async () => void (await banRow(1, MIA))),
        "a match post whose match was voided": async () => {
          const c = await challenge("void");
          return hiddenPost(PETE, 1, TAMA, async () => {}, { kind: "match", refKey: `challenge:${c}:posting` });
        },
      };
      /** A post with a comment of Mia's own and one of somebody else's, then put out of her sight. */
      async function hiddenPost(author: number, clubId: number, commenter: number, hide: (post: number) => Promise<void>, o: { kind?: string; refKey?: string } = {}) {
        const post = await rawPost(author, clubId, o);
        const own = await rawComment(post, MIA, "mine");
        const other = await rawComment(post, commenter, "theirs");
        await hide(post);
        return { post, own, other };
      }
      const CALLS: Record<string, (t: { post: number; own: number; other: number }) => Promise<unknown>> = {
        loadVisiblePost: (t) => loadVisiblePost(db, MIA, t.post),
        addComment: (t) => addComment(db, MIA, t.post, "Well played"),
        listComments: (t) => listComments(db, MIA, t.post),
        "deleteComment (her own comment there)": (t) => deleteComment(db, MIA, t.own),
        "deleteComment (someone else's)": (t) => deleteComment(db, MIA, t.other),
        "setKudos on": (t) => setKudos(db, MIA, t.post, true),
        "setKudos off": (t) => setKudos(db, MIA, t.post, false),
        deletePost: (t) => deletePost(db, MIA, t.post),
        "fileReport on the post": (t) => fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: t.post, reason: "spam", details: "look" }),
        "fileReport on a comment there": (t) => fileReport(db, seal, { reporterId: MIA, targetType: "comment", targetId: t.other, reason: "child_safety" }),
      };
      for (const [what, build] of Object.entries(HIDDEN)) {
        test(`out of sight is the same as not there, for every call: ${what}`, async () => {
          await everyone();
          const missing = { post: 999_999, own: 999_998, other: 999_997 };
          const target = await build();
          const state = () => rows(`SELECT (SELECT count(*)::int FROM social_comments WHERE state <> 'removed') AS comments, (SELECT count(*)::int FROM social_kudos) AS kudos, (SELECT count(*)::int FROM content_reports) AS reports, (SELECT count(*)::int FROM moderation_evidence) AS evidence, (SELECT string_agg(state, ',') FROM social_posts) AS posts`);
          const beforeCalls = await state();
          for (const [name, call] of Object.entries(CALLS)) {
            const answer = await call(target);
            assert.deepEqual(answer, await call(missing), name);
            assert.deepEqual(answer, name === "loadVisiblePost" ? null : NOT_FOUND, name);
          }
          assert.deepEqual(await state(), beforeCalls, "and nothing was written");
          assert.equal(ids(await feed(db, MIA)).includes(target.post), false);
        });
      }

      test("every one of those calls works on a post she can see", async () => {
        await everyone();
        const t = await hiddenPost(PETE, 1, TAMA, async () => {});
        assert.equal((await loadVisiblePost(db, MIA, t.post))?.id, t.post);
        assert.equal((await addComment(db, MIA, t.post, "Well played")).ok, true);
        assert.equal((await listComments(db, MIA, t.post)).ok, true);
        assert.equal((await setKudos(db, MIA, t.post, true)).ok, true);
        assert.equal((await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: t.post, reason: "spam" })).ok, true);
        assert.equal((await fileReport(db, seal, { reporterId: MIA, targetType: "comment", targetId: t.other, reason: "spam" })).ok, true);
        assert.deepEqual(await deleteComment(db, MIA, t.own), { ok: true, value: null });
        assert.deepEqual(await deletePost(db, PETE, t.post), { ok: true, value: null });
      });

      test("writing a post: the club must be the author's, the words pass the screen, a held one is its author's alone", async () => {
        await everyone();
        const made = await createPost(db, MIA, { clubId: 1, body: "  Great   games\ntonight " });
        assert.ok(made.ok);
        assert.deepEqual(Object.keys(made.value).sort(), ["createdAt", "id", "kind", "state"]);
        assert.deepEqual([made.value.kind, made.value.state], ["text", "visible"]);
        assert.deepEqual((await posts())[0], { id: String(made.value.id), author_id: MIA, club_id: 1, kind: "text", ref_key: null, state: "visible", body: "Great games tonight", photo_id: null });
        // Not her club, not a club, a club that banned her; Sione posts in either of his.
        for (const clubId of [club2, 999, 0, -1, 1.5, "1", null, undefined]) assert.deepEqual(await createPost(db, MIA, { clubId: clubId as number, body: "hi" }), { ok: false, code: "not_member" }, String(clubId));
        assert.equal((await createPost(db, SIONE, { clubId: club2, body: "Xin chào" })).ok, true);
        assert.deepEqual(await createPost(db, SIONE, { clubId: club2, body: "hi" }, { env: prod("1") }), { ok: false, code: "not_member" }, "not a pilot club");
        await banRow(1, MIA);
        assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "hi" }), { ok: false, code: "not_member" });
        await admin.query(`TRUNCATE social_club_bans`);
        // The words.
        for (const body of ["", "   ", undefined, null, 42, "​"]) assert.deepEqual(await createPost(db, MIA, { clubId: 1, body }), { ok: false, code: "required" }, String(body));
        assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "x".repeat(SOCIAL_LIMITS.post + 1) }), { ok: false, code: "too_long" });
        assert.equal((await createPost(db, MIA, { clubId: 1, body: "ế".repeat(SOCIAL_LIMITS.post) })).ok, true);
        for (const body of ["kys", "you f4gg0t", "địt mẹ"]) assert.deepEqual(await createPost(db, MIA, { clubId: 1, body }), { ok: false, code: "not_allowed" }, body);
        // Someone without a profile, suspended, or with Social closed.
        await admin.query(`DELETE FROM social_profiles WHERE player_id = $1`, [QUINN]);
        assert.deepEqual(await createPost(db, QUINN, { clubId: 1, body: "hi" }), { ok: false, code: "not_joined" });
        await suspendRow(TAMA);
        assert.deepEqual(await createPost(db, TAMA, { clubId: 1, body: "hi" }), { ok: false, code: "not_member" });
        assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "hi" }, { env: {} }), { ok: false, code: "not_member" });
        assert.equal((await posts()).length, 3, "a refused post writes nothing");

        // A word the screen holds: saved, held, and only its author's.
        const held = await createPost(db, PETE, { clubId: 1, body: "Pay me in bitcoin" });
        assert.ok(held.ok);
        assert.equal(held.value.state, "held");
        assert.equal(await loadVisiblePost(db, MIA, held.value.id), null);
        assert.equal(ids(await feed(db, MIA)).includes(held.value.id), false);
        assert.equal((await loadVisiblePost(db, PETE, held.value.id))?.state, "held");
        const own = (await feed(db, PETE)).posts.find((p) => p.id === held.value.id);
        assert.deepEqual([own?.state, own?.mine, own?.body], ["held", true, "Pay me in bitcoin"]);
        const onProfile = await profilePosts(db, MIA, pid(PETE));
        assert.ok(onProfile.ok);
        assert.deepEqual(ids(onProfile.value), []);
      });

      test("the 11th post in a day is refused, and 12 at once make at most 10", async () => {
        await everyone();
        const answers = await Promise.all(Array.from({ length: 12 }, (_, i) => createPost(db, MIA, { clubId: 1, body: `post ${i}` })));
        assert.equal(answers.filter((a) => a.ok).length, POSTS_PER_DAY);
        assert.deepEqual(answers.filter((a) => !a.ok), [{ ok: false, code: "rate_limited" }, { ok: false, code: "rate_limited" }]);
        assert.equal((await posts(`author_id = ${MIA}`)).length, POSTS_PER_DAY);
        // Deleting one doesn't buy another; posts older than a day, and automatic ones, don't count.
        const first = Number((await posts())[0].id);
        assert.equal((await deletePost(db, MIA, first)).ok, true);
        assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "one more" }), { ok: false, code: "rate_limited" });
        await admin.query(`UPDATE social_posts SET created_at = now() - interval '25 hours' WHERE id = $1`, [first]);
        await rawPost(MIA, 1, { kind: "rank_up", refKey: "rank:3" });
        assert.equal((await createPost(db, MIA, { clubId: 1, body: "tomorrow" })).ok, true);
        assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "again" }), { ok: false, code: "rate_limited" });
        assert.equal((await createPost(db, PETE, { clubId: 1, body: "someone else is not held up" })).ok, true);
      });

      test("a photo post: her own approved photo, for this club, in one post only; one waiting for an admin keeps the post held", async () => {
        await everyone();
        const mine = await photo(MIA);
        const made = await createPost(db, MIA, { clubId: 1, photoId: mine.id });
        assert.ok(made.ok, JSON.stringify(made));
        assert.deepEqual([made.value.kind, made.value.state], ["photo", "visible"]);
        assert.deepEqual((await posts())[0].body, null, "a photo needs no words");
        const shown = (await feed(db, PETE)).posts[0];
        assert.deepEqual([shown.photoUrl, shown.photoWidth, shown.photoHeight], [mine.url, 1200, 800]);
        // The same photo again; someone else's; a Gallery photo; one filed under another club; ids that aren't ids.
        assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "again", photoId: mine.id }), { ok: false, code: "photo_not_found" });
        const petes = await photo(PETE);
        assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "his", photoId: petes.id }), { ok: false, code: "photo_not_found" });
        assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "gallery", photoId: 1 }), { ok: false, code: "photo_not_found" });
        const elsewhere = await photo(SIONE, "approved", club2);
        assert.deepEqual(await createPost(db, SIONE, { clubId: 1, body: "other club", photoId: elsewhere.id }), { ok: false, code: "photo_not_found" });
        for (const photoId of [0, -1, "7", 1.5, {}, 999_999]) assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "x", photoId }), { ok: false, code: "photo_not_found" }, String(photoId));
        for (const status of ["pending", "rejected", "hidden"]) assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "x", photoId: (await photo(MIA, status)).id }), { ok: false, code: "photo_not_found" }, status);
        // Too many words are still too many with a photo.
        const spare = await photo(MIA);
        assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "x".repeat(501), photoId: spare.id }), { ok: false, code: "too_long" });
        assert.equal((await posts()).length, 1);
        // Two posts racing for one photo: one gets it, the other is told it isn't there. Never an error.
        const race = await Promise.all([createPost(db, MIA, { clubId: 1, body: "a", photoId: spare.id }), createPost(db, MIA, { clubId: 1, body: "b", photoId: spare.id })]);
        assert.deepEqual(race.map((r) => (r.ok ? "ok" : r.code)).sort(), ["ok", "photo_not_found"]);
        // Waiting for an admin: the post is held, and only hers.
        const waiting = await photo(MIA, "needs_review");
        const held = await createPost(db, MIA, { clubId: 1, body: "Net play", photoId: waiting.id });
        assert.ok(held.ok);
        assert.equal(held.value.state, "held");
        assert.equal(await loadVisiblePost(db, PETE, held.value.id), null);
        const own = (await feed(db, MIA)).posts.find((p) => p.id === held.value.id)!;
        assert.equal(own.state, "held");
        assert.equal("photoUrl" in own, false, "not shown, even to her, until it is approved");
      });

      test("an admin hides a post's photo later: the post stays, the photo is gone, on the next read", async () => {
        await everyone();
        const mine = await photo(MIA);
        const post = await rawPost(MIA, 1, { photoId: mine.id, body: "Net play" });
        assert.equal((await feed(db, PETE)).posts[0].photoUrl, mine.url);
        for (const change of [`status = 'hidden'`, `status = 'rejected'`, `status = 'approved', deleted_at = now()`]) {
          await admin.query(`UPDATE player_photos SET ${change} WHERE id = $1`, [mine.id]);
          const shown = (await feed(db, PETE)).posts[0];
          assert.equal(shown.id, post, change);
          assert.equal(shown.body, "Net play");
          for (const k of ["photoUrl", "photoWidth", "photoHeight"]) assert.equal(k in shown, false, `${k} after ${change}`);
          assert.equal((await loadVisiblePost(db, PETE, post))?.id, post);
        }
      });

      test("deleting your own post: removed for everyone, and its photo goes with its file", async () => {
        await everyone();
        const mine = await photo(MIA);
        const post = await rawPost(MIA, 1, { photoId: mine.id });
        assert.deepEqual(await deletePost(db, PETE, post), NOT_FOUND, "not his");
        const gone: string[] = [];
        assert.deepEqual(await deletePost(db, MIA, post, { deleteFiles: async (urls) => void gone.push(...urls) }), { ok: true, value: null });
        assert.deepEqual(gone, [mine.url]);
        assert.deepEqual((await posts()).map((p) => [p.state, p.photo_id]), [["removed", null]]);
        assert.deepEqual(await rows(`SELECT id FROM player_photos WHERE id = $1`, [mine.id]), []);
        for (const viewer of [MIA, PETE]) {
          assert.equal(await loadVisiblePost(db, viewer, post), null);
          assert.deepEqual(ids(await feed(db, viewer)), []);
        }
        assert.deepEqual(await deletePost(db, MIA, post), NOT_FOUND, "a second time");
        // The store can't remove the file: the post is removed all the same, and the photo is out of every read until it can.
        const second = await photo(MIA);
        const other = await rawPost(MIA, 1, { photoId: second.id });
        const error = console.error;
        const logged: unknown[][] = [];
        console.error = (...a: unknown[]) => void logged.push(a);
        try {
          assert.deepEqual(await deletePost(db, MIA, other, { deleteFiles: async () => Promise.reject(new Error(`store is down for ${second.url}`)) }), { ok: true, value: null });
        } finally {
          console.error = error;
        }
        assert.equal(logged.length, 1);
        assert.ok(!JSON.stringify(logged).includes(second.url) && !JSON.stringify(logged).includes(String(MIA)), "the log names no file and no person");
        assert.equal((await posts(`id = ${other}`))[0].state, "removed");
        assert.deepEqual(await rows(`SELECT deleted_at IS NOT NULL AS marked FROM player_photos WHERE id = $1`, [second.id]), [{ marked: true }]);
        assert.deepEqual(await createPost(db, MIA, { clubId: 1, body: "reuse", photoId: second.id }), { ok: false, code: "photo_not_found" });
        // With no store connected at all (the default here) it is the same.
        const third = await photo(MIA);
        const last = await rawPost(MIA, 1, { photoId: third.id });
        console.error = () => {};
        try {
          assert.deepEqual(await deletePost(db, MIA, last), { ok: true, value: null });
        } finally {
          console.error = error;
        }
        assert.deepEqual(await rows(`SELECT deleted_at IS NOT NULL AS marked FROM player_photos WHERE id = $1`, [third.id]), [{ marked: true }]);
      });

      test("comments: written, screened, listed by display name; a held one is its author's alone; only your own can be deleted", async () => {
        await everyone();
        const post = await rawPost(PETE, 1);
        const made = await addComment(db, MIA, post, "  Well   played ");
        assert.ok(made.ok);
        assert.deepEqual({ ...made.value, id: 0, createdAt: "" }, { id: 0, author: { publicId: pid(MIA), displayName: "Smash Queen", avatarUrl: null }, body: "Well played", state: "visible", createdAt: "", mine: true });
        for (const body of ["", "  ", null, undefined, 7]) assert.deepEqual(await addComment(db, MIA, post, body), { ok: false, code: "required" }, String(body));
        assert.deepEqual(await addComment(db, MIA, post, "x".repeat(SOCIAL_LIMITS.comment + 1)), { ok: false, code: "too_long" });
        assert.deepEqual(await addComment(db, MIA, post, "kys"), { ok: false, code: "not_allowed" });
        // The words are checked before the post, so those answers say nothing about it.
        assert.deepEqual(await addComment(db, MIA, 999_999, ""), { ok: false, code: "required" });
        const held = await addComment(db, TAMA, post, "send money first");
        assert.ok(held.ok);
        assert.equal(held.value.state, "held");
        const seenBy = async (viewer: number) => {
          const r = await listComments(db, viewer, post);
          assert.ok(r.ok);
          return r.value.map((c) => `${c.author.displayName}: ${c.body}${c.state === "visible" ? "" : ` (${c.state})`}${c.mine ? " *" : ""}`);
        };
        assert.deepEqual(await seenBy(PETE), ["Smash Queen: Well played"]);
        assert.deepEqual(await seenBy(MIA), ["Smash Queen: Well played *"]);
        assert.deepEqual(await seenBy(TAMA), ["Smash Queen: Well played", "Tama T: send money first (held) *"]);
        const count = async (viewer: number) => (await feed(db, viewer)).posts.find((p) => p.id === post)!.comments;
        assert.deepEqual([await count(PETE), await count(MIA), await count(TAMA)], [1, 1, 2], "the count is what each can read");
        const listed = await listComments(db, TAMA, post);
        await assertNoIdentity(listed, [MIA, PETE, TAMA]);
        assert.deepEqual(Object.keys(listed.ok ? listed.value[0] : {}).sort(), ["author", "body", "createdAt", "id", "mine", "state"]);
        // No profile, no comment; a held or hidden post of your own takes none.
        await admin.query(`DELETE FROM social_profiles WHERE player_id = $1`, [QUINN]);
        assert.deepEqual(await addComment(db, QUINN, post, "hi"), { ok: false, code: "not_joined" });
        const waiting = await rawPost(PETE, 1, { state: "held" });
        assert.deepEqual(await addComment(db, PETE, waiting, "hi"), NOT_FOUND);
        assert.deepEqual(await setKudos(db, PETE, waiting, true), NOT_FOUND);
        assert.deepEqual(await listComments(db, PETE, waiting), { ok: true, value: [] });
        // Deleting: only your own. The post's author can't remove someone else's here.
        const hers = made.value.id;
        assert.deepEqual(await deleteComment(db, PETE, hers), NOT_FOUND);
        assert.deepEqual(await deleteComment(db, TAMA, hers), NOT_FOUND);
        for (const id of [0, -1, "1", null, 1.5, 999_999]) assert.deepEqual(await deleteComment(db, MIA, id), NOT_FOUND, String(id));
        assert.deepEqual(await deleteComment(db, MIA, hers), { ok: true, value: null });
        assert.deepEqual(await deleteComment(db, MIA, hers), NOT_FOUND, "a second time");
        assert.deepEqual(await seenBy(MIA), []);
        assert.equal(await count(MIA), 0);
        assert.deepEqual(await rows(`SELECT state FROM social_comments WHERE id = $1`, [hers]), [{ state: "removed" }]);
        // A club that banned her: its posts are out of her sight, so no comment either.
        await banRow(1, MIA);
        assert.deepEqual(await addComment(db, MIA, post, "hi"), NOT_FOUND);
        await admin.query(`TRUNCATE social_club_bans`);
        // Banned as the AUTHOR of the post: her own post is still hers to read, not to write on.
        const own = await rawPost(MIA, 1);
        await banRow(1, MIA);
        assert.equal((await listComments(db, MIA, own)).ok, true);
        assert.deepEqual(await addComment(db, MIA, own, "hi"), NOT_FOUND);
        assert.deepEqual(await setKudos(db, MIA, own, true), NOT_FOUND);
      });

      test("Review Focus 1: someone blocked can't comment on the blocker's post, and their old comment is gone from it", async () => {
        await everyone();
        const post = await rawPost(PETE, 1);
        assert.equal((await addComment(db, QUINN, post, "First!")).ok, true);
        assert.equal((await addComment(db, MIA, post, "Second")).ok, true);
        const bodies = async (viewer: number, of = post) => {
          const r = await listComments(db, viewer, of);
          return r.ok ? r.value.map((c) => c.body) : r.code;
        };
        const count = async (viewer: number, of = post) => (await feed(db, viewer)).posts.find((p) => p.id === of)?.comments;
        assert.deepEqual(await bodies(PETE), ["First!", "Second"]);
        // Pete blocks Quinn. They are still in the same club.
        await blockRow(PETE, QUINN);
        assert.deepEqual(await bodies(PETE), ["Second"]);
        assert.equal(await count(PETE), 1);
        assert.deepEqual(await bodies(MIA), ["Second"], "nor for anyone else reading Pete's post");
        assert.equal(await count(MIA), 1);
        assert.deepEqual(await addComment(db, QUINN, post, "Still here"), NOT_FOUND);
        assert.deepEqual(await addComment(db, QUINN, post, "Still here"), await addComment(db, QUINN, 999_999, "Still here"));
        assert.deepEqual(await setKudos(db, QUINN, post, true), NOT_FOUND);
        assert.deepEqual(await bodies(QUINN), "not_found");
        assert.equal((await rows(`SELECT count(*)::int AS n FROM social_comments`))[0].n, 2, "nothing was written or deleted");
        // On a third person's post the block is between those two only.
        const tamas = await rawPost(TAMA, 1);
        assert.equal((await addComment(db, QUINN, tamas, "From Quinn")).ok, true);
        assert.equal((await addComment(db, PETE, tamas, "From Pete")).ok, true);
        assert.deepEqual(await bodies(TAMA, tamas), ["From Quinn", "From Pete"]);
        assert.deepEqual(await bodies(PETE, tamas), ["From Pete"]);
        assert.deepEqual(await bodies(QUINN, tamas), ["From Quinn"]);
        assert.deepEqual([await count(TAMA, tamas), await count(PETE, tamas), await count(QUINN, tamas)], [2, 1, 1]);
      });

      test("counts and lists leave out a suspended, deleted or club-banned commenter; kudos twice counts once", async () => {
        await everyone();
        const post = await rawPost(PETE, 1);
        for (const who of [MIA, QUINN, TAMA, SIONE]) await rawComment(post, who, `from ${who}`);
        await rawComment(post, MIA, "taken down", "hidden");
        await rawComment(post, QUINN, "gone", "removed");
        const view = async (viewer: number) => {
          const r = await listComments(db, viewer, post);
          assert.ok(r.ok);
          const p = (await feed(db, viewer)).posts.find((x) => x.id === post)!;
          assert.equal(p.comments, r.value.length, "the count is the list");
          return { comments: r.value.map((c) => c.body), kudos: p.kudos, kudosByMe: p.kudosByMe };
        };
        assert.deepEqual((await view(PETE)).comments, [`from ${MIA}`, `from ${QUINN}`, `from ${TAMA}`, `from ${SIONE}`]);
        assert.deepEqual((await view(MIA)).comments, [`from ${MIA}`, `from ${QUINN}`, `from ${TAMA}`, `from ${SIONE}`, "taken down"], "her own hidden one, to her");
        await suspendRow(QUINN);
        await admin.query(`UPDATE players SET deleted_at = now() WHERE id = $1`, [TAMA]);
        await banRow(1, SIONE);
        assert.deepEqual((await view(PETE)).comments, [`from ${MIA}`]);

        // Kudos.
        assert.deepEqual(await setKudos(db, MIA, post, true), { ok: true, value: { kudos: 1, kudosByMe: true } });
        assert.deepEqual(await setKudos(db, MIA, post, true), { ok: true, value: { kudos: 1, kudosByMe: true } });
        assert.equal((await rows(`SELECT count(*)::int AS n FROM social_kudos`))[0].n, 1);
        assert.deepEqual(await setKudos(db, PETE, post, true), { ok: true, value: { kudos: 2, kudosByMe: true } }, "your own post");
        await admin.query(`INSERT INTO social_kudos (post_id, player_id) VALUES ($1, $2), ($1, $3), ($1, $4)`, [post, QUINN, TAMA, NAM]);
        const mias = await view(MIA);
        assert.deepEqual([mias.kudos, mias.kudosByMe], [3, true], "Mia, Pete and Nam: not the suspended or the deleted one");
        await blockRow(NAM, MIA);
        assert.equal((await view(MIA)).kudos, 2);
        assert.equal((await view(PETE)).kudos, 3);
        assert.deepEqual(await setKudos(db, MIA, post, false), { ok: true, value: { kudos: 1, kudosByMe: false } });
        assert.deepEqual(await setKudos(db, MIA, post, false), { ok: true, value: { kudos: 1, kudosByMe: false } });
        assert.equal((await view(MIA)).kudosByMe, false);
        for (const on of ["yes", 1, null, undefined]) assert.deepEqual(await setKudos(db, MIA, post, on as never), { ok: true, value: { kudos: 1, kudosByMe: false } }, "only exactly true gives");
        await admin.query(`DELETE FROM social_profiles WHERE player_id = $1`, [LINH]);
        assert.deepEqual(await setKudos(db, LINH, post, true), { ok: false, code: "not_joined" });
      });

      test("the 101st comment in a day is refused", async () => {
        await everyone();
        const post = await rawPost(PETE, 1);
        await admin.query(`INSERT INTO social_comments (post_id, author_id, body, state) SELECT $1, $2, 'c' || g, CASE WHEN g % 2 = 0 THEN 'removed' ELSE 'visible' END FROM generate_series(1, $3) g`, [post, MIA, COMMENTS_PER_DAY - 1]);
        const answers = await Promise.all([addComment(db, MIA, post, "a"), addComment(db, MIA, post, "b"), addComment(db, MIA, post, "c")]);
        assert.deepEqual(answers.map((a) => (a.ok ? "ok" : a.code)).sort(), ["ok", "rate_limited", "rate_limited"]);
        assert.equal((await addComment(db, QUINN, post, "not held up")).ok, true);
      });

      test("the feed: the viewer's clubs, the people they follow, their own; each post by display name, public id and club", async () => {
        await everyone();
        await admin.query(`UPDATE social_profiles SET visibility = 'everyone' WHERE player_id = $1`, [NAM]);
        const a = await rawPost(PETE, 1, { body: "club 1, Pete" });
        const b = await rawPost(LINH, club2, { body: "club 2, Linh (club only)" });
        const c = await rawPost(NAM, club2, { body: "club 2, Nam (everyone)" });
        const d = await rawPost(MIA, 1, { body: "club 1, Mia" });
        const e = await rawPost(SIONE, club2, { body: "club 2, Sione" });
        assert.deepEqual(ids(await feed(db, MIA)), [d, a], "her club only");
        assert.deepEqual(ids(await feed(db, LINH)), [e, c, b]);
        assert.deepEqual(ids(await feed(db, SIONE)), [e, d, c, b, a], "both of his clubs");
        // Following: an `everyone` author's posts cross clubs; a `club` author's don't.
        await followRow(MIA, NAM);
        await followRow(MIA, LINH);
        assert.deepEqual(ids(await feed(db, MIA)), [d, c, a]);
        const page = await feed(db, MIA);
        assert.deepEqual(page.next, null);
        assert.equal((await feed(db, MIA, null, 3)).next, null, "a page that ends the list has no next");
        assert.deepEqual((await feed(db, MIA, null, 2)).next?.beforeId, c);
        assert.deepEqual(Object.keys(page.posts[1]).sort(), ["author", "body", "club", "comments", "createdAt", "id", "kind", "kudos", "kudosByMe", "mine", "state"]);
        assert.deepEqual({ ...page.posts[1], createdAt: "" }, { id: c, kind: "text", state: "visible", author: { publicId: pid(NAM), displayName: "Nam T", avatarUrl: null }, club: { slug: "hanoi-smash", name: "Hanoi Smash" }, body: "club 2, Nam (everyone)", kudos: 0, kudosByMe: false, comments: 0, createdAt: "", mine: false });
        assert.deepEqual([page.posts[0].mine, page.posts[0].club.slug], [true, "three-wolves"]);
        await assertNoIdentity(page, [MIA, PETE, NAM]);
        // Nam switches to `club`: the follower in another club stops seeing his posts on the next read.
        await admin.query(`UPDATE social_profiles SET visibility = 'club' WHERE player_id = $1`, [NAM]);
        assert.deepEqual(ids(await feed(db, MIA)), [d, a]);
        assert.equal(await loadVisiblePost(db, MIA, c), null);
        assert.deepEqual(await profilePosts(db, MIA, pid(NAM)), NOT_FOUND);
        await admin.query(`UPDATE social_profiles SET visibility = 'everyone' WHERE player_id = $1`, [NAM]);
        // His posts, on his profile; and an id nobody has.
        const his = await profilePosts(db, MIA, pid(NAM));
        assert.ok(his.ok);
        assert.deepEqual(ids(his.value), [c]);
        assert.deepEqual(await profilePosts(db, MIA, "Abcdefgh1234"), NOT_FOUND);
        assert.deepEqual(await profilePosts(db, MIA, pid(LINH)), NOT_FOUND);
        const sharedClub = await profilePosts(db, SIONE, pid(MIA));
        assert.ok(sharedClub.ok);
        assert.deepEqual(ids(sharedClub.value), [d]);
        // A club's ban: the banned viewer sees none of its posts but their own; a block hides both ways.
        await banRow(1, MIA);
        assert.deepEqual(ids(await feed(db, MIA)), [d, c]);
        await admin.query(`TRUNCATE social_club_bans`);
        await blockRow(PETE, MIA);
        assert.deepEqual(ids(await feed(db, MIA)), [d, c]);
        assert.deepEqual(ids(await feed(db, PETE)), [a]);
        // A cursor that isn't one gives nothing rather than the first page.
        for (const cursor of [{ before: "yesterday", beforeId: 1 }, { before: "2026-01-01T00:00:00.000Z", beforeId: 0 }, { before: "2026-01-01T00:00:00.000Z; DROP", beforeId: 1 }, {}, "x"]) assert.deepEqual(await feed(db, MIA, cursor as FeedCursor), { posts: [], next: null }, JSON.stringify(cursor));
      });

      test("paging: no repeats and no gaps, with posts at the same instant and a post arriving between pages", async () => {
        await everyone();
        const made: number[] = [];
        // 45 posts: three instants shared by ten posts each, the rest a microsecond apart.
        for (let i = 0; i < 45; i++) {
          const group = i < 30 ? Math.floor(i / 10) : null;
          made.push(await rawPost(i % 2 ? PETE : MIA, 1, { at: group === null ? `2026-11-01T10:00:00.${String(100000 + i).padStart(6, "0")}Z` : `2026-11-01T09:0${group}:00.123456Z` }));
        }
        const expected = (await rows(`SELECT id FROM social_posts ORDER BY created_at DESC, id DESC`)).map((r) => Number(r.id));
        const seen: number[] = [];
        let cursor: FeedCursor | null = null;
        let pages = 0;
        do {
          const page: { posts: FeedPost[]; next: FeedCursor | null } = await feed(db, QUINN, cursor, 7);
          seen.push(...ids(page));
          cursor = page.next;
          pages++;
          // Someone posts while she reads on: it belongs to a later first page, never to this walk.
          await rawPost(TAMA, 1);
          if (cursor) assert.match(cursor.before, /^2026-11-01T\d\d:\d\d:\d\d\.\d{6}Z$/, "to the microsecond");
        } while (cursor);
        assert.deepEqual(seen, expected);
        assert.equal(pages, 7);
        assert.equal(new Set(seen).size, 45);
        // The default page is 20; the most is 50; nonsense is the default.
        assert.equal((await feed(db, QUINN)).posts.length, 20);
        assert.equal((await feed(db, QUINN, null, 500)).posts.length, 50);
        assert.equal((await feed(db, QUINN, null, -3)).posts.length, 20);
        // One author's posts page the same way.
        const profile: number[] = [];
        let at: FeedCursor | null = null;
        do {
          const page = await profilePosts(db, QUINN, pid(PETE), at, 5);
          assert.ok(page.ok);
          profile.push(...ids(page.value));
          at = page.value.next;
        } while (at);
        assert.deepEqual(profile, (await rows(`SELECT id FROM social_posts WHERE author_id = $1 ORDER BY created_at DESC, id DESC`, [PETE])).map((r) => Number(r.id)));
      });

      test("the feed's query walks the indexes of 0022 in order: no sort, and the cursor is an index condition", async () => {
        await everyone();
        await rawPost(PETE, 1);
        // Enough rows that the planner has a reason to choose.
        await admin.query(`INSERT INTO social_posts (author_id, club_id, kind, body, created_at) SELECT (ARRAY[$1, $2, $3, $4]::int[])[1 + g % 4], 1, 'text', 'p' || g, now() - g * interval '1 minute' FROM generate_series(1, 4000) g`, [MIA, PETE, QUINN, TAMA]);
        await admin.query(`ANALYZE social_posts`);
        const sent: { text: string; params?: unknown[] }[] = [];
        const spy = { query: (text: string, params?: unknown[]) => (sent.push({ text, params }), db.query(text, params)), connect: db.connect };
        const first = await feed(spy, MIA, null, 1);
        await feed(spy, MIA, { before: "2030-01-01T00:00:00.000000Z", beforeId: 5 }, 1);
        const his = await profilePosts(spy, MIA, pid(PETE), { before: "2030-01-01T00:00:00.000000Z", beforeId: 5 });
        assert.ok(first.posts.length === 1 && his.ok);
        const pages = sent.filter((q) => /FROM social_posts p\b/.test(q.text) && /LIMIT/.test(q.text));
        assert.equal(pages.length, 3);
        const plan = async (q: { text: string; params?: unknown[] }) => {
          await admin.query("BEGIN");
          try {
            return (await admin.query(`EXPLAIN ${q.text}`, q.params)).rows.map((r) => r["QUERY PLAN"]).join("\n");
          } finally {
            await admin.query("ROLLBACK");
          }
        };
        const [firstPage, nextPage, profilePage] = [await plan(pages[0]), await plan(pages[1]), await plan(pages[2])];
        for (const p of [firstPage, nextPage, profilePage]) assert.doesNotMatch(p, /^\s*(->\s*)?(Incremental )?Sort\b/m, p);
        assert.match(firstPage, /Index Scan using social_posts_created_idx on social_posts p/);
        assert.match(nextPage, /Index Scan using social_posts_created_idx on social_posts p\s*\(.*\)\s*\n\s*Index Cond: \(ROW\(created_at, id\) < ROW\(/);
        assert.match(profilePage, /Index Scan using social_posts_author_created_idx on social_posts p\s*\(.*\)\s*\n\s*Index Cond: \(\(author_id = .*ROW\(created_at, id\) < ROW\(/);
      });

      test("a confirmed match posts once per side, however often it is confirmed; the feed names only people the viewer can see", async () => {
        await everyone();
        const c = await challenge("completed");
        await Promise.all([postConfirmedMatch(db, c), postConfirmedMatch(db, c), postConfirmedMatch(db, c)]);
        await postConfirmedMatch(db, c);
        const made = await posts();
        assert.deepEqual(made.map((p) => [p.author_id, p.club_id, p.kind, p.ref_key, p.state, p.body]), [
          [MIA, 1, "match", `challenge:${c}:posting`, "visible", null],
          [QUINN, 1, "match", `challenge:${c}:accepting`, "visible", null],
        ]);
        const [winners, losers] = [Number(made[0].id), Number(made[1].id)];
        const view = async (viewer: number) => Object.fromEntries((await feed(db, viewer)).posts.map((p) => [p.id, p.match]));
        // Sione is in the club and saw neither side play.
        assert.deepEqual(await view(SIONE), {
          [winners]: { partner: "Pete the Smash", opponents: ["Quinn Q", "Tama T"], score: "21-15", won: true },
          [losers]: { partner: "Tama T", opponents: ["Smash Queen", "Pete the Smash"], score: "15-21", won: false },
        });
        const page = await feed(db, SIONE);
        assert.deepEqual(Object.keys(page.posts[0]).sort(), ["author", "body", "club", "comments", "createdAt", "id", "kind", "kudos", "kudosByMe", "match", "mine", "state"]);
        assert.deepEqual([page.posts[1].author, page.posts[1].body, page.posts[1].kind], [{ publicId: pid(MIA), displayName: "Smash Queen", avatarUrl: null }, null, "match"]);
        await assertNoIdentity(page, [MIA, PETE, QUINN, TAMA]);
        // Tama blocks Sione: Sione isn't told Tama played. Pete leaves Social: nobody is told he did.
        await blockRow(TAMA, SIONE);
        await admin.query(`DELETE FROM social_profiles WHERE player_id = $1`, [PETE]);
        assert.deepEqual(await view(SIONE), {
          [winners]: { partner: null, opponents: ["Quinn Q", null], score: "21-15", won: true },
          [losers]: { partner: null, opponents: ["Smash Queen", null], score: "15-21", won: false },
        });
        // Mia, who played, is told the same way: by who she can see.
        assert.deepEqual((await view(MIA))[winners], { partner: null, opponents: ["Quinn Q", "Tama T"], score: "21-15", won: true });
        // A suspended opponent, and one whose account is deleted, are not named either.
        await suspendRow(QUINN);
        assert.deepEqual((await view(MIA))[winners]?.opponents, [null, "Tama T"]);
        await admin.query(`UPDATE players SET deleted_at = now() WHERE id = $1`, [TAMA]);
        assert.deepEqual((await view(MIA))[winners]?.opponents, [null, null]);
      });

      test("a match post is written by the side's first player with a profile and access, in a club that has them; nobody, no post", async () => {
        // Nobody has a profile: nothing.
        const c = await challenge("completed");
        await postConfirmedMatch(db, c);
        assert.deepEqual(await posts(), []);
        // Mia has none; Pete has: he writes his side's. Quinn is suspended and Tama is banned by the club: no post for theirs.
        await join(PETE, "Pete the Smash");
        await join(QUINN, "Quinn Q");
        await join(TAMA, "Tama T");
        await suspendRow(QUINN);
        await banRow(1, TAMA);
        await postConfirmedMatch(db, c);
        assert.deepEqual((await posts()).map((p) => [p.author_id, p.ref_key]), [[PETE, `challenge:${c}:posting`]]);
        // Mia joins and the confirmation comes again: her side has its post already.
        await join(MIA, "Smash Queen");
        await admin.query(`TRUNCATE player_suspensions, social_club_bans`);
        await postConfirmedMatch(db, c);
        assert.deepEqual((await posts()).map((p) => [p.author_id, p.ref_key]), [[PETE, `challenge:${c}:posting`], [QUINN, `challenge:${c}:accepting`]]);
        // Rules a person hasn't accepted yet: no post in their name.
        await admin.query(`UPDATE social_profiles SET rules_version = '2025-01'`);
        const d = await challenge("completed");
        await postConfirmedMatch(db, d);
        // Social closed for the deployment, and a club that isn't a pilot club.
        await admin.query(`UPDATE social_profiles SET rules_version = $1`, [COMMUNITY_RULES_VERSION]);
        await postConfirmedMatch(db, d, { env: {} });
        await postConfirmedMatch(db, d, { env: prod(String(club2)) });
        assert.equal((await posts()).length, 2);
        // A game decided without a score (a pair retired): no score, and the other pair won.
        const e = await challenge("completed", { posting: null, accepting: null, retiredBy: "posting" });
        await postConfirmedMatch(db, e);
        const shown = (await feed(db, TAMA)).posts.filter((p) => p.match).map((p) => [p.author.displayName, p.match!.score, p.match!.won]);
        assert.deepEqual(shown.slice(0, 2).sort(), [["Quinn Q", null, true], ["Smash Queen", null, false]]);
        for (const id of [0, -1, 1.5, Number.NaN, "7" as unknown as number, 999_999]) await postConfirmedMatch(db, id);
        assert.equal((await posts()).length, 4);
      });

      test("only a completed match posts, and a post whose match stops standing is gone for everyone", async () => {
        await everyone();
        for (const status of ["awaiting", "disputed", "void", "live", "lapsed"]) await postConfirmedMatch(db, await challenge(status));
        assert.deepEqual(await posts(), [], "a dispute that raced the confirmation makes no post");
        const c = await challenge("completed");
        await postConfirmedMatch(db, c);
        const [mine] = (await posts()).map((p) => Number(p.id));
        assert.equal((await feed(db, SIONE)).posts.length, 2);
        assert.equal((await loadVisiblePost(db, SIONE, mine))?.kind, "match");
        // An admin voids it later; the score is disputed again.
        for (const status of ["void", "disputed"]) {
          await admin.query(`UPDATE arena_challenges SET status = $2 WHERE id = $1`, [c, status]);
          for (const viewer of [SIONE, MIA]) {
            assert.deepEqual(ids(await feed(db, viewer)), [], `${status}, for ${viewer}`);
            assert.equal(await loadVisiblePost(db, viewer, mine), null);
          }
          assert.deepEqual(await setKudos(db, SIONE, mine, true), NOT_FOUND);
        }
        // Resolved as entered: the same posts are back, with the score as it now stands.
        await admin.query(`UPDATE arena_challenges SET status = 'completed', score_posting = 19, score_accepting = 21 WHERE id = $1`, [c]);
        await postConfirmedMatch(db, c);
        assert.equal((await posts()).length, 2);
        assert.deepEqual((await feed(db, SIONE)).posts.find((p) => p.id === mine)?.match, { partner: "Pete the Smash", opponents: ["Quinn Q", "Tama T"], score: "19-21", won: false });
        // A key that isn't a match's key shows nothing rather than failing the page.
        await rawPost(MIA, 1, { kind: "match", refKey: "challenge:x:posting" });
        await rawPost(MIA, 1, { kind: "match", refKey: `challenge:${c}:sideways` });
        assert.equal((await feed(db, SIONE)).posts.length, 2);
      });

      test("at most five automatic posts a day per person; rank-ups post once per rank; nothing here ever throws", async () => {
        await everyone();
        for (let i = 0; i < AUTO_POSTS_PER_DAY + 2; i++) await postConfirmedMatch(db, await challenge("completed"));
        assert.equal((await posts(`author_id = ${MIA}`)).length, AUTO_POSTS_PER_DAY);
        // The side's post is not handed to the partner when the first player is at the cap.
        assert.equal((await posts(`author_id = ${PETE}`)).length, 0);
        await postRankUp(db, MIA, "7", { clubId: 1 });
        assert.equal((await posts(`author_id = ${MIA} AND kind = 'rank_up'`)).length, 0, "the cap is for both kinds together");

        await Promise.all([postRankUp(db, TAMA, "7"), postRankUp(db, TAMA, "7"), postRankUp(db, TAMA, "7", { clubId: 1 })]);
        await postRankUp(db, TAMA, "7");
        assert.deepEqual((await posts(`author_id = ${TAMA}`)).map((p) => [p.club_id, p.kind, p.ref_key, p.body, p.state]), [[1, "rank_up", "rank:7", null, "visible"]]);
        const shown = (await feed(db, SIONE)).posts.find((p) => p.kind === "rank_up")!;
        assert.deepEqual([shown.rankIndex, shown.author.displayName, shown.body, "match" in shown], [7, "Tama T", null, false]);
        await postRankUp(db, TAMA, "8");
        assert.equal((await posts(`author_id = ${TAMA}`)).length, 2);
        // The author deletes it: it doesn't come back.
        const first = Number((await posts(`author_id = ${TAMA}`))[0].id);
        assert.equal((await deletePost(db, TAMA, first)).ok, true);
        await postRankUp(db, TAMA, "7");
        assert.deepEqual((await posts(`author_id = ${TAMA}`)).map((p) => p.state), ["removed", "visible"]);
        // Not a rank, not a person, a club that isn't theirs, no profile, Social closed.
        for (const rank of ["", "x", "-1", "07", "999", "1.5", 7 as unknown as string, "7; DROP"]) await postRankUp(db, QUINN, rank);
        await postRankUp(db, 999_999, "3");
        await postRankUp(db, QUINN, "3", { clubId: club2 });
        await postRankUp(db, QUINN, "3", { env: {} });
        await admin.query(`DELETE FROM social_profiles WHERE player_id = $1`, [PETE]);
        await postRankUp(db, PETE, "3");
        assert.equal((await posts(`kind = 'rank_up' AND author_id IN (${QUINN}, ${PETE})`)).length, 0);

        // A database that fails: caught, and logged without the error's own words.
        const error = console.error;
        const logged: unknown[][] = [];
        console.error = (...a: unknown[]) => void logged.push(a);
        const broken = { query: async () => Promise.reject(Object.assign(new Error(`duplicate key for player ${MIA} mia@secret.test`), { code: "23505" })), connect: db.connect };
        try {
          await postConfirmedMatch(broken, 1);
          await postRankUp(broken, MIA, "3");
        } finally {
          console.error = error;
        }
        assert.deepEqual(logged, [["[social] match post failed:", "Error", "23505"], ["[social] rank-up post failed:", "Error", "23505"]]);
      });

      test("reporting a post or a comment: through the gate, filed in the post's club, to the platform when it is about that club's admin", async () => {
        await everyone();
        const post = await rawPost(PETE, 1, { body: "Buy my rackets" });
        const comment = await rawComment(post, TAMA, "Scam!");
        const report = async (id: number) => (await rows(`SELECT target_type, target_id, club_id, reason, severity, queue FROM content_reports WHERE id = $1`, [id]))[0];
        const a = await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: post, reason: "spam", details: "selling" });
        assert.ok(a.ok);
        assert.deepEqual(await report(a.value.id), { target_type: "post", target_id: String(post), club_id: 1, reason: "spam", severity: "normal", queue: "club" });
        assert.deepEqual(await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: post, reason: "spam" }), { ok: false, code: "duplicate" });
        const b = await fileReport(db, seal, { reporterId: MIA, targetType: "comment", targetId: comment, reason: "harassment" });
        assert.ok(b.ok);
        assert.deepEqual(await report(b.value.id), { target_type: "comment", target_id: String(comment), club_id: 1, reason: "harassment", severity: "normal", queue: "club" });
        // Your own post and your own comment; a comment you can't read (held, or from someone you blocked).
        assert.deepEqual(await fileReport(db, seal, { reporterId: PETE, targetType: "post", targetId: post, reason: "spam" }), NOT_FOUND);
        assert.deepEqual(await fileReport(db, seal, { reporterId: TAMA, targetType: "comment", targetId: comment, reason: "spam" }), NOT_FOUND);
        const held = await rawComment(post, TAMA, "waiting", "held");
        assert.deepEqual(await fileReport(db, seal, { reporterId: QUINN, targetType: "comment", targetId: held, reason: "spam" }), NOT_FOUND);
        await blockRow(QUINN, TAMA);
        assert.deepEqual(await fileReport(db, seal, { reporterId: QUINN, targetType: "comment", targetId: comment, reason: "spam" }), NOT_FOUND);
        for (const id of ["7", 0, -1, 1.5, null, pid(PETE)]) for (const targetType of ["post", "comment"] as const) assert.deepEqual(await fileReport(db, seal, { reporterId: MIA, targetType, targetId: id, reason: "spam" }), NOT_FOUND, `${targetType} ${id}`);
        // The author is an admin of that club: not left to the club.
        await admin.query(`INSERT INTO club_roles (tenant_id, player_id, role) VALUES (1, $1, 'admin')`, [PETE]);
        const c = await fileReport(db, seal, { reporterId: SIONE, targetType: "post", targetId: post, reason: "spam" });
        assert.ok(c.ok);
        assert.equal((await report(c.value.id)).queue, "platform");
        // Child safety: the words, and the photo's address, are kept sealed as they were.
        const mine = await photo(PETE);
        const withPhoto = await rawPost(PETE, 1, { photoId: mine.id, body: "Look" });
        const e = await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: withPhoto, reason: "child_safety" });
        const f = await fileReport(db, seal, { reporterId: SIONE, targetType: "comment", targetId: comment, reason: "child_safety" });
        assert.ok(e.ok && f.ok);
        const kept = async (id: number) => {
          const r = (await rows(`SELECT sealed, author_player_id FROM moderation_evidence WHERE report_id = $1`, [id]))[0];
          return { author: r.author_player_id, ...JSON.parse(seal.openEvidence(id, String(r.sealed))) };
        };
        assert.deepEqual(await kept(e.value.id), { author: PETE, targetType: "post", targetId: withPhoto, content: { body: "Look", photoUrl: mine.url } });
        assert.deepEqual(await kept(f.value.id), { author: TAMA, targetType: "comment", targetId: comment, content: { body: "Scam!" } });
        assert.deepEqual(await report(e.value.id), { target_type: "post", target_id: String(withPhoto), club_id: 1, reason: "child_safety", severity: "serious", queue: "platform" });
      });
    });
  }
});
