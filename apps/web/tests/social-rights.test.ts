// Social plan, Task 6: deleting an account deletes its Social data
// (lib/social/data-rights.ts forgetSocial, called by both delete paths), and
// "Download my data" includes it (exportSocial). Against a real Postgres,
// with two clubs, once as the database owner (TENANT_SCOPE=off) and once as
// the app's role for one club (TENANT_SCOPE=enforce). Made-up people only.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { COMMUNITY_RULES_VERSION } from "@luvallplay/core/social";
import { migrate } from "../scripts/db/migrate.mjs";
import { block } from "../lib/moderation/blocks.ts";
import { fileReport } from "../lib/moderation/reports.ts";
import { moderationSeal } from "../lib/moderation/seal.ts";
import { activeSuspension, suspend } from "../lib/moderation/suspensions.ts";
import { newPublicId } from "../lib/social/public-id.ts";
import { joinSocial } from "../lib/social/profiles.ts";
import { listComments } from "../lib/social/comments.ts";
import { loadVisiblePost } from "../lib/social/posts.ts";
import { exportSocial, forgetSocial } from "../lib/social/data-rights.ts";
import { memoryStorage, setPublicStorage, type MemoryStorage } from "../lib/storage.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `social_rights_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const STORE = "https://store.example/files";
const key = () => randomBytes(32).toString("base64");
type TxClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; command?: string }>; release(destroy?: Error | boolean): void };
type TestDb = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; connect: () => Promise<TxClient> };

// Every table a migration from 0022 on creates (Social, moderation, and whatever comes next: the Marketplace's
// tables are searched the day their migration lands, with nothing to add here), read from the migrations themselves.
const MIGRATIONS = new URL("../../../packages/db/migrations/", import.meta.url);
const TABLES = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 22)
  .sort()
  .flatMap((f) => [...fs.readFileSync(new URL(f, MIGRATIONS), "utf8").matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?([a-z_0-9]+)"?/gm)].map((m) => m[1]));
// Sealed columns, and how each opens: the search reads inside them too.
const SEALED: Record<string, "details" | "evidence"> = { "content_reports.details_sealed": "details", "moderation_evidence.sealed": "evidence" };

test("the tables searched are read from the migrations, and hold every one Social and moderation made", () => {
  for (const t of ["social_profiles", "social_follows", "social_posts", "social_comments", "social_kudos", "social_club_bans", "user_blocks", "content_reports", "moderation_actions", "moderation_evidence", "player_suspensions"]) {
    assert.ok(TABLES.includes(t), t);
  }
  assert.equal(new Set(TABLES).size, TABLES.length);
});

describe("deleting an account deletes its Social data; the download includes it", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const saved = { ...process.env };
  let admin: pg.Client;
  let database: typeof import("../lib/database.ts");
  let account: typeof import("../lib/app-account.ts");
  let website: typeof import("../app/api/profile/delete/route.ts");
  let auth: typeof import("../lib/player-auth.ts");
  let exporter: typeof import("../lib/player-export.ts");
  let players: typeof import("../lib/player-db.ts");
  let club2 = 0;
  let store: MemoryStorage;
  // Seed accounts in Three Wolves (club 1): 2 is its admin; 3 Mia, 4 Pete, 5 Quinn, 8 Tama are members.
  const ADMIN = 2;
  const MIA = 3;
  const PETE = 4;
  const QUINN = 5;
  const TAMA = 8;
  const KEYS = { MODERATION_KEKS: `m1:${key()}`, CONTACT_INDEX_KEYS: `i1:${key()}` };
  const seal = moderationSeal(KEYS);
  const rows = async (text: string, params: unknown[] = []) => (await admin.query(text, params)).rows;
  const one = async (text: string, params: unknown[] = []) => (await rows(text, params))[0];
  const publicIds = new Map<number, string>();
  const pid = (playerId: number) => publicIds.get(playerId)!;
  let n = 0;

  /** A new account, a member of the clubs named, signed in. Every test deletes its own. */
  async function person(first: string, last: string, clubs: number[] = [1]) {
    const email = `${first.toLowerCase()}.${++n}@rights.test`;
    const id = Number((await one(`INSERT INTO players (email, first_name, last_name) VALUES ($1, $2, $3) RETURNING id`, [email, first, last])).id);
    for (const club of clubs) await admin.query(`INSERT INTO club_members (tenant_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [club, id]);
    const token = `rights-token-${n}-${randomBytes(8).toString("hex")}`;
    await admin.query(`INSERT INTO player_sessions (player_id, token_hash, user_agent, expires_at) VALUES ($1, $2, 'test', now() + interval '60 days')`, [id, createHash("sha256").update(token).digest("hex")]);
    return { id, email, firstName: first, lastName: last, token };
  }
  type Person = Awaited<ReturnType<typeof person>>;
  const asPlayer = (p: Person) => p as unknown as Parameters<typeof account.deleteAccount>[0];
  async function join(playerId: number, displayName: string, bio: string | null = null, visibility: "club" | "everyone" = "club") {
    const publicId = newPublicId();
    await admin.query(`INSERT INTO social_profiles (player_id, public_id, display_name, bio, visibility, adult_confirmed_at, rules_version) VALUES ($1, $2, $3, $4, $5, now(), $6)`, [playerId, publicId, displayName, bio, visibility, COMMUNITY_RULES_VERSION]);
    publicIds.set(playerId, publicId);
  }
  async function rawPost(authorId: number, body: string | null, o: { clubId?: number; state?: string; photoId?: number } = {}) {
    const r = await one(`INSERT INTO social_posts (author_id, club_id, kind, body, photo_id, state) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [authorId, o.clubId ?? 1, o.photoId ? "photo" : "text", body, o.photoId ?? null, o.state ?? "visible"]);
    return Number(r.id);
  }
  const rawComment = async (postId: number, authorId: number, body: string) => Number((await one(`INSERT INTO social_comments (post_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`, [postId, authorId, body])).id);
  const kudos = (postId: number, playerId: number) => admin.query(`INSERT INTO social_kudos (post_id, player_id) VALUES ($1, $2)`, [postId, playerId]);
  const blockRow = (a: number, b: number) => admin.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [a, b]);
  const followRow = (a: number, b: number) => admin.query(`INSERT INTO social_follows (follower_id, followee_id) VALUES ($1, $2)`, [a, b]);
  /** A post's photo, with its file in the store. */
  async function photo(playerId: number, clubId = 1, purpose: "social" | "market" | "gallery" = "social") {
    const path = `${purpose === "gallery" ? "photos" : `${purpose}-photos`}/${playerId}/${++n}-d.jpg`;
    const url = `${STORE}/${path}`;
    store.objects.set(path, { body: Buffer.from("x"), contentType: "image/jpeg" });
    const r = await one(
      `INSERT INTO player_photos (tenant_id, player_id, purpose, status, original_url, display_url, thumb_url, width, height, bytes, consent_at)
       VALUES ($1, $2, $3, 'approved', $4, $4, $4, 1200, 800, 1000, CASE WHEN $3 = 'gallery' THEN now() END) RETURNING id`,
      [clubId, playerId, purpose, url],
    );
    return { id: Number(r.id), url, path };
  }
  /** Every row of every Social and moderation table, the post and listing photos, and the store's files. */
  async function everything() {
    const out: Record<string, unknown> = {};
    for (const t of TABLES) out[t] = await rows(`SELECT to_jsonb(t) AS row FROM ${t} t ORDER BY to_jsonb(t)::text`);
    out.player_photos = await rows(`SELECT to_jsonb(t) AS row FROM player_photos t WHERE id > 10 ORDER BY id`);
    out.files = [...store.objects.keys()].sort();
    return out;
  }
  const accountRow = (id: number) => one(`SELECT email, first_name, last_name, deleted_at, (SELECT count(*)::int FROM player_sessions s WHERE s.player_id = p.id) AS sessions FROM players p WHERE id = $1`, [id]);
  /**
   * Where this account's id, or any of the words given, still appears:
   * `table.column` for every column of every table above (and of the post and
   * listing photos) that holds it. The columns come from the database, so a
   * new one is searched without being named here. Every whole-number column
   * is compared with the id (accounts made here have ids from 700000, which
   * no post, report or club has); every text and JSON column is searched for
   * the words and for the id written out (a photo's URL carries it); sealed
   * columns are opened and searched the same way.
   */
  async function traces(id: number, words: string[]) {
    const found = new Set<string>();
    const needles = [...words, String(id)];
    const within = (text: string) => needles.some((w) => text.includes(w));
    for (const table of [...TABLES, "player_photos"]) {
      const columns = await rows(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]);
      assert.ok(columns.length > 0, `${table} has no columns: is it a table?`);
      const kind = new Map(columns.map((c) => [String(c.column_name), String(c.data_type)]));
      for (const { row } of await rows(`SELECT to_jsonb(t) AS row FROM ${table} t ${table === "player_photos" ? "WHERE purpose <> 'gallery'" : ""}`)) {
        for (const [column, value] of Object.entries(row as Record<string, unknown>)) {
          if (value === null) continue;
          const type = kind.get(column)!;
          const sealed = SEALED[`${table}.${column}`];
          if (sealed) {
            const key = Number((row as Record<string, unknown>)[sealed === "details" ? "id" : "report_id"]);
            const opened = sealed === "details" ? seal.open(key, String(value)) : seal.openEvidence(key, String(value));
            if (within(opened)) found.add(`${table}.${column} (opened)`);
          } else if (["integer", "bigint", "smallint", "numeric"].includes(type)) {
            if (Number(value) === id) found.add(`${table}.${column}`);
          } else if (["text", "character varying", "jsonb", "json", "ARRAY"].includes(type)) {
            if (within(typeof value === "string" ? value : JSON.stringify(value))) found.add(`${table}.${column}`);
          } else {
            assert.ok(["timestamp with time zone", "boolean", "date"].includes(type), `${table}.${column} is ${type}: say how to search it`);
          }
        }
      }
    }
    return [...found].sort();
  }
  // What deleting leaves of a person who had one of everything: the action log, the suspension, the evidence, and reports about them.
  const KEPT = [
    "content_reports.target_id",
    "moderation_actions.actor_id",
    "moderation_actions.target_id",
    "moderation_evidence.author_player_id",
    "moderation_evidence.sealed (opened)",
    "player_suspensions.player_id",
  ];
  /** Runs `fn` with console.error caught; answers the lines. */
  async function quietly(fn: () => Promise<unknown>): Promise<string[]> {
    const lines: string[] = [];
    const real = console.error;
    console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
      await fn();
    } finally {
      console.error = real;
    }
    return lines;
  }
  /** A database whose transaction client goes through `wrap`, and which remembers what was sent where. */
  function spying(db: TestDb, fail: (text: string, nth: number) => unknown = () => null) {
    const sent: { on: "pool" | "tx"; text: string }[] = [];
    const seen = new Map<string, number>();
    const spy: TestDb = {
      query: (text, params) => {
        sent.push({ on: "pool", text });
        return db.query(text, params);
      },
      connect: async () => {
        const client = await db.connect();
        return {
          release: (e) => client.release(e),
          query: async (text, params) => {
            sent.push({ on: "tx", text });
            const nth = (seen.get(text) ?? 0) + 1;
            seen.set(text, nth);
            const error = fail(text, nth);
            if (error) throw error;
            return client.query(text, params);
          },
        };
      },
    };
    return { spy, sent };
  }
  const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });

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
    // Accounts made here get ids no post, report or club will ever have, so an id found anywhere is the person.
    await admin.query(`SELECT setval(pg_get_serial_sequence('players', 'id'), 700000)`);
    club2 = (
      await admin.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, payment_mode, incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
    process.env.POSTGRES_URL = urlFor(NAME);
    process.env.DATABASE_DRIVER = "postgres";
    process.env.TENANT_SLUG = "three-wolves";
    delete process.env.TENANT_SCOPE;
    delete process.env.APP_DATABASE_URL;
    delete process.env.ARENA_TABLE_PREFIX;
    delete process.env.VERCEL_ENV;
    delete process.env.SOCIAL_PILOT_TENANTS;
    delete process.env.RESEND_API_KEY;
    // How a test or a preview opens Social; production has only the pilot list.
    process.env.SOCIAL_AVAILABILITY = "available";
    // The real delete paths read their keys from the deployment's settings.
    Object.assign(process.env, KEYS);
    database = await import("../lib/database.ts");
    account = await import("../lib/app-account.ts");
    website = await import("../app/api/profile/delete/route.ts");
    auth = await import("../lib/player-auth.ts");
    exporter = await import("../lib/player-export.ts");
    players = await import("../lib/player-db.ts");
  });
  after(async () => {
    setPublicStorage(null);
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
      let db: TestDb;

      before(async () => {
        await database.closeDatabase();
        process.env.TENANT_SCOPE = mode;
        db = { query: (text, params) => database.sql.query(text, params), connect: () => database.sql.connect() };
      });
      beforeEach(async () => {
        await admin.query(`TRUNCATE content_reports, moderation_evidence, moderation_actions CASCADE`);
        await admin.query(`TRUNCATE social_follows, user_blocks, social_kudos, social_comments, social_posts, social_club_bans, social_profiles, player_suspensions`);
        await admin.query(`DELETE FROM player_photos WHERE id > 10`);
        await admin.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES (1, 'social', true), ($1, 'social', true) ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = true`, [club2]);
        publicIds.clear();
        store = memoryStorage(STORE);
        setPublicStorage(store);
        await join(MIA, "Smash Queen");
        await join(PETE, "Pete the Smash");
        await join(QUINN, "Quinn Q");
        await join(TAMA, "Tama T");
      });

      /**
       * Zed, with one of everything: a profile, posts (one with a photo, one
       * held, one removed), comments and kudos both ways, follows and blocks
       * both ways, a club's ban, reports filed and received, a suspension,
       * and a moderator's actions by and about them.
       */
      async function zedWithEverything() {
        const zed = await person("Zedekiah", "Smashington");
        await join(zed.id, "Zed the Lobber", "zedbio left-handed");
        const pic = await photo(zed.id);
        const listing = await photo(zed.id, 1, "market");
        const gallery = await photo(zed.id, 1, "gallery");
        const words = await rawPost(zed.id, "zedword alpha post");
        const withPhoto = await rawPost(zed.id, "zedword photo post", { photoId: pic.id });
        const held = await rawPost(zed.id, "zedword held post", { state: "held" });
        const removed = await rawPost(zed.id, "zedword removed post", { state: "removed" });
        const miasPost = await rawPost(MIA, "Mia's own post");
        const petesPost = await rawPost(PETE, "Pete's own post");
        const onMias = await rawComment(miasPost, zed.id, "zedword comment on Mia's");
        const miasOnZeds = await rawComment(words, MIA, "miaword on Zed's post");
        const petesOnMias = await rawComment(miasPost, PETE, "peteword on Mia's post");
        await kudos(words, MIA);
        await kudos(miasPost, zed.id);
        await kudos(miasPost, PETE);
        // Reports, while everyone can still see everyone.
        const filed = await fileReport(db, seal, { reporterId: zed.id, targetType: "post", targetId: petesPost, reason: "spam", details: "zedword report details" });
        const aboutProfile = await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(zed.id), reason: "harassment", details: "Mia's words about Zed" });
        const aboutPost = await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: words, reason: "child_safety" });
        const aboutComment = await fileReport(db, seal, { reporterId: PETE, targetType: "comment", targetId: onMias, reason: "spam" });
        assert.deepEqual([filed.ok, aboutProfile.ok, aboutPost.ok, aboutComment.ok], [true, true, true, true]);
        const id = (r: typeof filed) => (r.ok ? r.value.id : 0);
        // A report Zed closed as a moderator, and the log of it.
        const handled = Number((await one(`INSERT INTO content_reports (reporter_id, target_type, target_id, club_id, reason, severity, queue, status, due_at, handled_by, handled_at) VALUES ($1, 'post', $2, 1, 'spam', 'normal', 'club', 'dismissed', now(), $3, now()) RETURNING id`, [PETE, miasPost, zed.id])).id);
        await admin.query(`INSERT INTO moderation_actions (actor_id, target_type, target_id, action, reason, report_id) VALUES ($1, 'post', $2, 'dismiss', 'not_spam', $3), ($4, 'profile', $1, 'suspend', 'harassment', $5), ($4, 'post', $6, 'remove', 'spam', NULL)`, [zed.id, miasPost, handled, ADMIN, id(aboutProfile), removed]);
        await followRow(zed.id, MIA);
        await followRow(PETE, zed.id);
        await blockRow(zed.id, QUINN);
        await blockRow(TAMA, zed.id);
        await admin.query(`INSERT INTO social_club_bans (club_id, player_id, created_by) VALUES (1, $1, $2), (1, $3, $1)`, [zed.id, ADMIN, TAMA]);
        assert.equal((await suspend(db, { playerId: zed.id, scope: "social", until: null, reasonCode: "harassment", actorId: ADMIN })).ok, true);
        return { zed, pic, listing, gallery, words, withPhoto, held, removed, miasPost, petesPost, onMias, miasOnZeds, petesOnMias, filed: id(filed), aboutProfile: id(aboutProfile), aboutPost: id(aboutPost), aboutComment: id(aboutComment), handled };
      }
      const ZED_WORDS = ["zedword", "zedbio", "Zed the Lobber", "Zedekiah", "Smashington", "miaword on Zed's post"];

      test("the connection is what the mode says", async () => {
        const who = (await db.query(`SELECT current_user AS role, current_setting('app.tenant_id', true) AS club`)).rows[0];
        if (mode === "enforce") assert.deepEqual(who, { role: "luvallplay_app", club: "1" });
        else assert.notEqual(who.role, "luvallplay_app");
      });

      test("forgetSocial: no row names the person except the action log, the suspension, the evidence and reports about them", async () => {
        const s = await zedWithEverything();
        const zed = s.zed.id;
        const wasSuspensions = (await one(`SELECT count(*)::int AS n FROM player_suspensions`)).n;
        const wasActions = await rows(`SELECT to_jsonb(t) AS row FROM moderation_actions t ORDER BY id`);
        const wasEvidence = await rows(`SELECT to_jsonb(t) AS row FROM moderation_evidence t ORDER BY report_id`);

        const done = await forgetSocial(db, zed);
        assert.deepEqual(done, { posts: 4, comments: 1, photos: 2, unreachablePhotoIds: [], retainedForEvidence: [] });

        assert.deepEqual(await traces(zed, [...ZED_WORDS, s.pic.url, s.listing.url]), KEPT);
        // Their rows are deleted, not marked.
        for (const [table, where] of [["social_profiles", "player_id = $1"], ["social_posts", "author_id = $1"], ["social_comments", "author_id = $1"], ["social_kudos", "player_id = $1"], ["social_follows", "follower_id = $1 OR followee_id = $1"], ["user_blocks", "blocker_id = $1 OR blocked_id = $1"], ["social_club_bans", "player_id = $1"]] as const) {
          assert.equal((await one(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, [zed])).n, 0, table);
        }
        // What others wrote on their posts went with the posts; what others wrote elsewhere is untouched.
        assert.deepEqual((await rows(`SELECT id FROM social_comments ORDER BY id`)).map((r) => Number(r.id)), [s.petesOnMias]);
        assert.deepEqual((await rows(`SELECT post_id, player_id FROM social_kudos`)).map((r) => [Number(r.post_id), r.player_id]), [[s.miasPost, PETE]]);
        assert.deepEqual((await rows(`SELECT id FROM social_posts ORDER BY id`)).map((r) => Number(r.id)), [s.miasPost, s.petesPost]);
        assert.equal((await one(`SELECT count(*)::int AS n FROM social_profiles`)).n, 4);
        // The ban Zed made as an admin stands, without them.
        assert.deepEqual(await rows(`SELECT club_id, player_id, created_by FROM social_club_bans`), [{ club_id: 1, player_id: TAMA, created_by: null }]);
        // The photos of posts and listings are gone, files too; the Gallery's is not Social's to delete.
        assert.deepEqual((await rows(`SELECT id FROM player_photos WHERE player_id = $1`, [zed])).map((r) => r.id), [s.gallery.id]);
        assert.deepEqual([...store.objects.keys()], [s.gallery.path]);

        // A report they filed stays, with no reporter and no details.
        assert.deepEqual(await one(`SELECT reporter_id, details_sealed, target_type, target_id::int, reason, status FROM content_reports WHERE id = $1`, [s.filed]), {
          reporter_id: null, details_sealed: null, target_type: "post", target_id: s.petesPost, reason: "spam", status: "open",
        });
        // Reports about them and their content stay as they were (the content is gone: "content removed").
        assert.deepEqual(
          await rows(`SELECT id::int, reporter_id, target_type, target_id::int, status, details_sealed IS NOT NULL AS has_details FROM content_reports WHERE id = ANY($1::bigint[]) ORDER BY id`, [[s.aboutProfile, s.aboutPost, s.aboutComment]]),
          [
            { id: s.aboutProfile, reporter_id: MIA, target_type: "profile", target_id: zed, status: "open", has_details: true },
            { id: s.aboutPost, reporter_id: MIA, target_type: "post", target_id: s.words, status: "open", has_details: false },
            { id: s.aboutComment, reporter_id: PETE, target_type: "comment", target_id: s.onMias, status: "open", has_details: false },
          ],
        );
        assert.equal(seal.open(s.aboutProfile, String((await one(`SELECT details_sealed FROM content_reports WHERE id = $1`, [s.aboutProfile])).details_sealed)), "Mia's words about Zed");
        // The report they handled is still handled, by nobody named; the log says who.
        assert.deepEqual(await one(`SELECT status, handled_by, handled_at IS NOT NULL AS handled FROM content_reports WHERE id = $1`, [s.handled]), { status: "dismissed", handled_by: null, handled: true });
        // Untouched: the action log, the evidence, the suspension.
        assert.deepEqual(await rows(`SELECT to_jsonb(t) AS row FROM moderation_actions t ORDER BY id`), wasActions);
        assert.deepEqual(await rows(`SELECT to_jsonb(t) AS row FROM moderation_evidence t ORDER BY report_id`), wasEvidence);
        assert.equal((await one(`SELECT count(*)::int AS n FROM player_suspensions`)).n, wasSuspensions);
        assert.equal((await activeSuspension(db, { playerId: zed }, "social"))?.reasonCode, "harassment");
        // The account itself is not this function's: it is still there and signed in.
        assert.deepEqual(await accountRow(zed), { email: s.zed.email, first_name: "Zedekiah", last_name: "Smashington", deleted_at: null, sessions: 1 });

        // Again: nothing left to do, nothing breaks. And an account with no Social data at all.
        assert.deepEqual(await forgetSocial(db, zed), { posts: 0, comments: 0, photos: 0, unreachablePhotoIds: [], retainedForEvidence: [] });
        assert.deepEqual(await forgetSocial(db, (await person("Nobody", "Social")).id), { posts: 0, comments: 0, photos: 0, unreachablePhotoIds: [], retainedForEvidence: [] });
        await assert.rejects(() => forgetSocial(db, 0), /account id/);
        await assert.rejects(() => forgetSocial({ query: db.query } as TestDb, zed), /connect\(\)/);
      });

      test("the app's real delete: afterwards the person is found only in the action log, the suspension, the evidence and reports about them", async () => {
        const s = await zedWithEverything();
        const zed = s.zed.id;
        assert.deepEqual(await account.deleteAccount(asPlayer(s.zed)), { ok: true });
        assert.deepEqual(await traces(zed, [...ZED_WORDS, s.zed.email, s.pic.url, s.listing.url]), KEPT);
        assert.deepEqual([...store.objects.keys()], [s.gallery.path]);
        const gone = await accountRow(zed);
        assert.deepEqual([gone.email, gone.first_name, gone.last_name, gone.deleted_at !== null, gone.sessions], [`deleted-${zed}@deleted.invalid`, "", "", true, 0]);
        assert.equal(await auth.sessionForToken(s.zed.token), null);
        // Nobody reads anything of theirs any more.
        assert.equal(await loadVisiblePost(db, MIA, s.words), null);
        const left = await listComments(db, MIA, s.miasPost);
        assert.deepEqual(left.ok && left.value.map((c) => c.id), [s.petesOnMias]);
      });

      test("a child_safety report's evidence about their post survives their deletion and still opens", async () => {
        const s = await zedWithEverything();
        assert.deepEqual(await account.deleteAccount(asPlayer(s.zed)), { ok: true });
        assert.equal((await one(`SELECT count(*)::int AS n FROM social_posts WHERE id = $1`, [s.words])).n, 0, "the post itself is gone");
        const evidence = await one(`SELECT sealed, author_player_id FROM moderation_evidence WHERE report_id = $1`, [s.aboutPost]);
        assert.equal(evidence.author_player_id, s.zed.id);
        assert.ok(!String(evidence.sealed).includes("zedword"));
        assert.deepEqual(JSON.parse(seal.openEvidence(s.aboutPost, String(evidence.sealed))), { targetType: "post", targetId: s.words, content: { body: "zedword alpha post", photoUrl: null } });
        assert.deepEqual(await one(`SELECT reason, severity, queue, status, target_id::int FROM content_reports WHERE id = $1`, [s.aboutPost]), { reason: "child_safety", severity: "serious", queue: "platform", status: "open", target_id: s.words });
      });

      test("when the photo store can't delete, the app's delete answers 500 delete_failed: the account is intact, still signed in, nothing half-deleted; trying again works", async () => {
        const s = await zedWithEverything();
        const before = await everything();
        const account0 = await accountRow(s.zed.id);
        // A store's error can carry the file's URL, and the URL carries the account's id.
        setPublicStorage({ ...store, delete: async (urls) => { throw Object.assign(new Error(`the store said no to ${urls.join(", ")}`), { name: "BlobError", code: "store_down" }); } });
        const lines = await quietly(async () => assert.deepEqual(await account.deleteAccount(asPlayer(s.zed)), { ok: false, status: 500, code: "delete_failed" }));
        // One line, saying what kind of error and nothing from its message: no URL, no id, no email.
        assert.deepEqual(lines, ["[app-api] account not deleted: its Social data couldn't be removed: BlobError (store_down)"]);
        assert.deepEqual(await everything(), before);
        assert.deepEqual(await accountRow(s.zed.id), account0);
        assert.equal((await auth.sessionForToken(s.zed.token))?.player.id, s.zed.id, "still signed in");
        assert.equal((await exportSocial(db, s.zed.id)).posts.length, 4, "their data is all still theirs");
        // The store is back: the same call finishes the job.
        setPublicStorage(store);
        assert.deepEqual(await account.deleteAccount(asPlayer(s.zed)), { ok: true });
        assert.equal((await one(`SELECT count(*)::int AS n FROM social_posts WHERE author_id = $1`, [s.zed.id])).n, 0);
        assert.deepEqual([...store.objects.keys()], [s.gallery.path]);
      });

      test("a statement failing half way rolls everything back, files included; no store connected fails the same way", async () => {
        const s = await zedWithEverything();
        const before = await everything();
        const failing: TestDb = {
          query: db.query,
          connect: async () => {
            const client = await db.connect();
            return {
              release: (e) => client.release(e),
              query: (text, params) => (/DELETE FROM social_profiles/.test(text) ? Promise.reject(new Error("injected failure")) : client.query(text, params)),
            };
          },
        };
        await assert.rejects(() => forgetSocial(failing, s.zed.id), /injected failure/);
        assert.deepEqual(await everything(), before);
        // A transaction that a swallowed error aborted doesn't count as done.
        const swallowing: TestDb = {
          query: db.query,
          connect: async () => {
            const client = await db.connect();
            return {
              release: (e) => client.release(e),
              // One statement fails, and every error from then on is swallowed: only the COMMIT's own answer tells.
              query: async (text, params) => {
                if (/DELETE FROM social_follows/.test(text)) return client.query(`SELECT 1 FROM no_such_table_here`).catch(() => ({ rows: [] }));
                return client.query(text, params).catch(() => ({ rows: [] }));
              },
            };
          },
        };
        await assert.rejects(() => forgetSocial(swallowing, s.zed.id, { deleteFiles: async () => {} }), /didn't commit/);
        assert.deepEqual(await everything(), before);
        // No photo store connected at all: the files can't be removed, so nothing is.
        setPublicStorage({ ...store, configured: () => false });
        await assert.rejects(() => forgetSocial(db, s.zed.id), /no photo store/);
        assert.deepEqual(await everything(), before);
        // Someone with no post or listing photo needs no store.
        const plain = await person("Plain", "Texter");
        await join(plain.id, "Plain Texter");
        await rawPost(plain.id, "words only");
        assert.deepEqual(await forgetSocial(db, plain.id), { posts: 1, comments: 0, photos: 0, unreachablePhotoIds: [], retainedForEvidence: [] });
      });

      test("the website's delete path does the same: 500 delete_failed and still signed in when it can't, everything gone when it can", async () => {
        const s = await zedWithEverything();
        const before = await everything();
        const request = () => new Request("https://club.test/api/profile/delete", { method: "POST", headers: { cookie: `${auth.PLAYER_COOKIE}=${s.zed.token}`, "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) });
        setPublicStorage({ ...store, delete: async (urls) => { throw new Error(`the store said no to ${urls.join(", ")}`); } });
        let refused!: Response;
        const lines = await quietly(async () => {
          refused = await website.POST(request());
        });
        assert.deepEqual(lines, ["[profile] account not deleted: its Social data couldn't be removed: Error"]);
        assert.equal(refused.status, 500);
        assert.deepEqual(await refused.json(), { error: "delete_failed" });
        assert.equal(refused.headers.get("set-cookie"), null, "the sign-in cookie is not cleared");
        assert.deepEqual(await everything(), before);
        assert.equal((await accountRow(s.zed.id)).deleted_at, null);
        assert.equal((await auth.sessionForToken(s.zed.token))?.player.id, s.zed.id);

        setPublicStorage(store);
        const done = await website.POST(request());
        assert.equal(done.status, 200);
        assert.match(String(done.headers.get("set-cookie")), new RegExp(`${auth.PLAYER_COOKIE}=;`));
        assert.deepEqual(await traces(s.zed.id, [...ZED_WORDS, s.zed.email, s.pic.url]), KEPT);
        assert.notEqual((await accountRow(s.zed.id)).deleted_at, null);
      });

      test("Review Focus 7, end to end: suspended, a new email and phone, the real delete, signing up again: joining answers `suspended`", async () => {
        const rex = await person("Rex", "Returner");
        await admin.query(`UPDATE players SET phone = '021 555 7001', phone_e164 = '+64215557001', phone_verified_at = now() WHERE id = $1`, [rex.id]);
        await join(rex.id, "Rex R");
        assert.equal((await suspend(db, { playerId: rex.id, scope: "social", until: null, reasonCode: "harassment", actorId: ADMIN })).ok, true);
        // They change both, so the suspension's row knows neither.
        await admin.query(`UPDATE players SET email = 'rex.fresh@rights.test', phone = '021 555 7002', phone_e164 = '+64215557002', phone_verified_at = now() WHERE id = $1`, [rex.id]);
        assert.equal(await activeSuspension(db, { email: "rex.fresh@rights.test" }, "social"), null, "the hole the delete path has to close");
        assert.deepEqual(await account.deleteAccount(asPlayer({ ...rex, email: "rex.fresh@rights.test" })), { ok: true });
        // Carried once, by the first pass only.
        assert.equal((await one(`SELECT count(*)::int AS n FROM player_suspensions WHERE player_id = $1`, [rex.id])).n, 2);

        const input = { displayName: "Brand New", visibility: "club", adultConfirmed: true, rulesVersion: COMMUNITY_RULES_VERSION };
        const byEmail = await person("Rex", "Again");
        await admin.query(`UPDATE players SET email = 'rex.fresh@rights.test' WHERE id = $1`, [byEmail.id]);
        assert.deepEqual(await joinSocial(db, byEmail.id, input), { ok: false, code: "suspended" });
        const byPhone = await person("Rex", "Thirdtime");
        await admin.query(`UPDATE players SET phone = '021 555 7002', phone_e164 = '+64215557002', phone_verified_at = now() WHERE id = $1`, [byPhone.id]);
        assert.deepEqual(await joinSocial(db, byPhone.id, input), { ok: false, code: "suspended" });
        // The old email is still suspended too; a stranger is not.
        assert.equal((await activeSuspension(db, { email: rex.email }, "social"))?.reasonCode, "harassment");
        const stranger = await person("Sam", "Stranger");
        assert.equal((await joinSocial(db, stranger.id, input)).ok, true);
        // Free the email and the number for the next mode.
        await admin.query(`UPDATE players SET email = 'used-' || id || '@rights.test', phone = NULL, phone_e164 = NULL, phone_verified_at = NULL WHERE id IN ($1, $2)`, [byEmail.id, byPhone.id]);
      });

      test("a blocked person's old comment on the blocker's post is gone once the blocked person deletes their account", async () => {
        const bo = await person("Bo", "Blocked");
        await join(bo.id, "Bo B");
        const post = await rawPost(MIA, "Mia's post");
        const comment = await rawComment(post, bo.id, "boword from before the block");
        await blockRow(MIA, bo.id);
        // Out of everyone's sight, Bo's own included, but still stored.
        const seen = await listComments(db, PETE, post);
        assert.deepEqual(seen.ok && seen.value, []);
        assert.equal((await one(`SELECT count(*)::int AS n FROM social_comments WHERE id = $1`, [comment])).n, 1);
        assert.deepEqual(await account.deleteAccount(asPlayer(bo)), { ok: true });
        assert.equal((await one(`SELECT count(*)::int AS n FROM social_comments`)).n, 0);
        assert.equal((await one(`SELECT count(*)::int AS n FROM user_blocks`)).n, 0);
        assert.deepEqual(await traces(bo.id, ["boword", "Bo B"]), []);
      });

      test("a photo posted in another club's space: deleted with the rest when the connection can see it, reported when it can't", async () => {
        const vy = await person("Vy", "Twoclubs", [1, club2]);
        await join(vy.id, "Vy V");
        const here = await photo(vy.id, 1);
        const there = await photo(vy.id, club2);
        await rawPost(vy.id, null, { photoId: here.id });
        await rawPost(vy.id, null, { photoId: there.id, clubId: club2 });
        // Filed under the other club and never posted: no post points at these.
        const loose = await photo(vy.id, club2);
        const listing = await photo(vy.id, club2, "market");
        let done: Awaited<ReturnType<typeof forgetSocial>> | undefined;
        const lines = await quietly(async () => {
          done = await forgetSocial(db, vy.id);
        });
        // Both posts go either way: the posts table is platform-wide.
        assert.equal((await one(`SELECT count(*)::int AS n FROM social_posts WHERE author_id = $1`, [vy.id])).n, 0);
        if (mode === "off") {
          assert.deepEqual(done, { posts: 2, comments: 0, photos: 4, unreachablePhotoIds: [], retainedForEvidence: [] });
          assert.equal((await one(`SELECT count(*)::int AS n FROM player_photos WHERE player_id = $1`, [vy.id])).n, 0);
          assert.deepEqual([...store.objects.keys()], []);
          assert.deepEqual(lines, []);
        } else {
          // The known limit. The other club's rows are out of this connection's reach: the posted one is at least
          // known by its post and reported; the two no post points at can't even be counted.
          assert.deepEqual((await db.query(`SELECT id FROM player_photos WHERE player_id = $1`, [vy.id])).rows, [], "this connection sees none of them");
          assert.deepEqual(done, { posts: 2, comments: 0, photos: 1, unreachablePhotoIds: [there.id], retainedForEvidence: [] });
          assert.deepEqual((await rows(`SELECT id FROM player_photos WHERE player_id = $1 ORDER BY id`, [vy.id])).map((r) => r.id), [there.id, loose.id, listing.id]);
          assert.deepEqual([...store.objects.keys()].sort(), [there.path, loose.path, listing.path].sort());
          assert.deepEqual(lines, [`[social] account deletion: 1 post photo(s) filed under another club can't be reached from this deployment and are still in the store: player_photos ids ${there.id}.`]);
        }
      });

      test("a photo that child-safety evidence is about is kept, file and row, out of every read; every other photo goes", async () => {
        const zed = await person("Zara", "Evidence");
        await join(zed.id, "Zara E");
        const reported = await photo(zed.id);
        const closed = await photo(zed.id);
        const plain = await photo(zed.id);
        const spamOnly = await photo(zed.id);
        const posts = [await rawPost(zed.id, null, { photoId: reported.id }), await rawPost(zed.id, null, { photoId: closed.id }), await rawPost(zed.id, "zaraword", { photoId: plain.id }), await rawPost(zed.id, null, { photoId: spamOnly.id })];
        const a = await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: posts[0], reason: "child_safety" });
        const b = await fileReport(db, seal, { reporterId: PETE, targetType: "post", targetId: posts[0], reason: "child_safety" });
        const c = await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: posts[1], reason: "child_safety" });
        const d = await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: posts[3], reason: "spam" });
        assert.deepEqual([a.ok, b.ok, c.ok, d.ok], [true, true, true, true]);
        const reportId = (r: typeof a) => (r.ok ? r.value.id : 0);
        // A report already closed keeps its evidence, and so its photo.
        await admin.query(`UPDATE content_reports SET status = 'actioned', handled_at = now(), handled_by = $2 WHERE id = $1`, [reportId(c), ADMIN]);

        const lines = await quietly(async () => assert.deepEqual(await account.deleteAccount(asPlayer(zed)), { ok: true }));
        assert.deepEqual(lines, [`[social] account deletion: 2 post photo(s) kept, file and row, as evidence for a child-safety report: player_photos ids ${reported.id}, ${closed.id}.`]);

        // The evidence still opens, and what it points at is still there.
        for (const [report, post, pic] of [[reportId(a), posts[0], reported], [reportId(b), posts[0], reported], [reportId(c), posts[1], closed]] as const) {
          const sealed = String((await one(`SELECT sealed FROM moderation_evidence WHERE report_id = $1`, [report])).sealed);
          assert.deepEqual(JSON.parse(seal.openEvidence(report, sealed)), { targetType: "post", targetId: post, content: { body: null, photoUrl: pic.url } });
          assert.ok(store.objects.has(pic.path), "the file is still in the store");
        }
        assert.deepEqual([...store.objects.keys()].sort(), [reported.path, closed.path].sort(), "the other files are gone");
        // The rows: kept, marked deleted, and marked with the (first) report they are kept for. The others are gone.
        assert.deepEqual(
          await rows(`SELECT id, player_id, purpose, deleted_at IS NOT NULL AS deleted, caption FROM player_photos WHERE player_id = $1 ORDER BY id`, [zed.id]),
          [
            { id: reported.id, player_id: zed.id, purpose: "social", deleted: true, caption: `retained-evidence:report:${reportId(a)}` },
            { id: closed.id, player_id: zed.id, purpose: "social", deleted: true, caption: `retained-evidence:report:${reportId(c)}` },
          ],
        );
        // No post is left to show them, and the account is gone.
        assert.equal((await one(`SELECT count(*)::int AS n FROM social_posts`)).n, 0);
        assert.notEqual((await accountRow(zed.id)).deleted_at, null);
        // So the person is now also found on those two photo rows (the id, and the URLs that carry it), and nowhere new besides.
        assert.deepEqual(await traces(zed.id, ["zaraword", "Zara E", "Zara", "Evidence", zed.email]), [
          "moderation_evidence.author_player_id",
          "moderation_evidence.sealed (opened)",
          "player_photos.display_url",
          "player_photos.original_url",
          "player_photos.player_id",
          "player_photos.thumb_url",
        ]);
        // Asking again (the second pass did, already) keeps them: the mark is on the row, the post is not needed.
        assert.deepEqual(await forgetSocial(db, zed.id, { carry: false }), { posts: 0, comments: 0, photos: 0, unreachablePhotoIds: [], retainedForEvidence: [reported.id, closed.id] });
        assert.deepEqual([...store.objects.keys()].sort(), [reported.path, closed.path].sort());
      });

      test("suspensions are carried inside the transaction, under the account's lock: a failed delete carries nothing, a finished one does", async () => {
        const rex = await person("Rex", "Locked");
        await join(rex.id, "Rex L");
        assert.equal((await suspend(db, { playerId: rex.id, scope: "social", until: null, reasonCode: "harassment", actorId: ADMIN })).ok, true);
        await admin.query(`UPDATE players SET email = $2 WHERE id = $1`, [rex.id, `rex.moved.${rex.id}@rights.test`]);
        const count = async () => (await one(`SELECT count(*)::int AS n FROM player_suspensions WHERE player_id = $1`, [rex.id])).n;
        const failing = spying(db, (text) => (/DELETE FROM social_profiles/.test(text) ? new Error("injected failure") : null));
        await assert.rejects(() => forgetSocial(failing.spy, rex.id), /injected failure/);
        assert.equal(await count(), 1, "rolled back with the rest");
        const { spy, sent } = spying(db);
        await forgetSocial(spy, rex.id);
        assert.equal(await count(), 2);
        // Every statement went to the transaction's own connection, and the carry came after the lock.
        assert.deepEqual(sent.filter((q) => q.on === "pool"), []);
        const at = (re: RegExp) => sent.findIndex((q) => re.test(q.text));
        assert.ok(at(/FROM players WHERE id = \$1 FOR UPDATE/) > at(/^BEGIN$/));
        assert.ok(at(/INSERT INTO player_suspensions/) > at(/FROM players WHERE id = \$1 FOR UPDATE/));
        assert.ok(at(/INSERT INTO player_suspensions/) < at(/DELETE FROM social_kudos/));
        assert.equal((await activeSuspension(db, { email: `rex.moved.${rex.id}@rights.test` }, "social"))?.reasonCode, "harassment");
      });

      test("a deadlock is tried again, three times in all: forgetSocial and block", async () => {
        const s = await zedWithEverything();
        const before = await everything();
        // Twice the loser, then through.
        const twice = spying(db, (text, nth) => (/DELETE FROM social_follows/.test(text) && nth <= 2 ? deadlock() : null));
        // Three times: it gives up with the database's own error, and nothing has changed.
        const always = spying(db, (text) => (/DELETE FROM social_follows/.test(text) ? deadlock() : null));
        await assert.rejects(() => forgetSocial(always.spy, s.zed.id), (e: { code?: string }) => e.code === "40P01");
        assert.equal(always.sent.filter((q) => q.text === "BEGIN").length, 3);
        assert.deepEqual(await everything(), before);
        assert.equal((await forgetSocial(twice.spy, s.zed.id)).posts, 4);
        assert.equal(twice.sent.filter((q) => q.text === "BEGIN").length, 3);
        assert.equal(twice.sent.filter((q) => q.text === "ROLLBACK").length, 2);
        // Any other error is not tried again.
        const other = spying(db, (text) => (/DELETE FROM social_kudos/.test(text) ? Object.assign(new Error("no"), { code: "23505" }) : null));
        await assert.rejects(() => forgetSocial(other.spy, s.zed.id), /^Error: no$/);
        assert.equal(other.sent.filter((q) => q.text === "BEGIN").length, 1);

        // block(): the same, from the other side.
        await followRow(PETE, MIA);
        const blockTwice = spying(db, (text, nth) => (/INSERT INTO user_blocks/.test(text) && nth <= 2 ? deadlock() : null));
        assert.deepEqual(await block(blockTwice.spy, MIA, pid(PETE)), { ok: true, value: null });
        assert.equal((await one(`SELECT count(*)::int AS n FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [MIA, PETE])).n, 1);
        assert.equal((await one(`SELECT count(*)::int AS n FROM social_follows WHERE follower_id = $1`, [PETE])).n, 0);
        const blockAlways = spying(db, (text) => (/INSERT INTO user_blocks/.test(text) ? deadlock() : null));
        await assert.rejects(() => block(blockAlways.spy, MIA, pid(QUINN)), (e: { code?: string }) => e.code === "40P01");
        assert.equal(blockAlways.sent.filter((q) => /INSERT INTO user_blocks/.test(q.text)).length, 3);
      });

      test("a real deadlock with someone blocking them at that moment: the deletion still finishes", async () => {
        const dee = await person("Dee", "Deadlock");
        await join(dee.id, "Dee D");
        await rawPost(dee.id, "deeword");
        await followRow(dee.id, MIA);
        // As block() does: the follow's row is taken first, the account's row is needed second.
        const other = new pg.Client({ connectionString: urlFor(NAME) });
        await other.connect();
        try {
          await other.query("BEGIN");
          await other.query(`DELETE FROM social_follows WHERE follower_id = $1 AND followee_id = $2`, [dee.id, MIA]);
          // forgetSocial takes the account's row, then waits for the follow's.
          const forgetting = forgetSocial(db, dee.id);
          forgetting.catch(() => {});
          for (let i = 0; ; i++) {
            const waiting = await rows(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'DELETE FROM social_follows%'`);
            if (waiting.length > 0) break;
            assert.ok(i < 200, "forgetSocial never reached the follow's row");
            await new Promise((r) => setTimeout(r, 25));
          }
          // Now the other side needs the account's row (the block's foreign key): a deadlock. Postgres stops one of the two.
          const blocking = other.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [MIA, dee.id]).then(
            () => other.query("COMMIT").then(() => "committed"),
            (e: { code?: string }) => other.query("ROLLBACK").then(() => e.code),
          );
          const [done, theirs] = await Promise.all([forgetting, blocking]);
          assert.ok(theirs === "committed" || theirs === "40P01", String(theirs));
          assert.equal(done.posts, 1);
        } finally {
          await other.end();
        }
        assert.equal((await one(`SELECT count(*)::int AS n FROM social_posts WHERE author_id = $1`, [dee.id])).n, 0);
        assert.equal((await one(`SELECT count(*)::int AS n FROM social_profiles WHERE player_id = $1`, [dee.id])).n, 0);
        // A block that committed after the deletion's last look is the one thing left; the second pass takes it.
        await forgetSocial(db, dee.id, { carry: false });
        assert.deepEqual(await traces(dee.id, ["deeword", "Dee D"]), []);
      });

      test("the export holds what they wrote and chose, and nothing written by others; other people by display name and public id only", async () => {
        const s = await zedWithEverything();
        const zed = s.zed.id;
        const out = await exportSocial(db, zed);
        assert.deepEqual(Object.keys(out).sort(), ["blocked", "clubBans", "comments", "following", "kudos", "posts", "profile", "reports", "suspensions"]);
        assert.deepEqual({ ...out.profile, adultConfirmedAt: null, joinedAt: null, updatedAt: null }, {
          publicId: pid(zed), displayName: "Zed the Lobber", bio: "zedbio left-handed", visibility: "club", rulesVersion: COMMUNITY_RULES_VERSION, adultConfirmedAt: null, joinedAt: null, updatedAt: null,
        });
        // Every post of theirs, held and removed ones too, with its state.
        assert.deepEqual(out.posts.map((p) => [p.id, p.kind, p.state, p.body, p.photoUrl]), [
          [s.words, "text", "visible", "zedword alpha post", null],
          [s.withPhoto, "photo", "visible", "zedword photo post", s.pic.url],
          [s.held, "text", "held", "zedword held post", null],
          [s.removed, "text", "removed", "zedword removed post", null],
        ]);
        assert.deepEqual(out.comments.map((c) => [c.id, c.postId, c.state, c.body]), [[s.onMias, s.miasPost, "visible", "zedword comment on Mia's"]]);
        assert.deepEqual(out.kudos.map((k) => k.postId), [s.miasPost]);
        assert.deepEqual(out.following.map((p) => [p.publicId, p.displayName]), [[pid(MIA), "Smash Queen"]]);
        assert.deepEqual(out.blocked.map((p) => [p.publicId, p.displayName]), [[pid(QUINN), "Quinn Q"]]);
        // Their own report, in their own words; not what or who it was about.
        assert.deepEqual(out.reports.map((r) => ({ ...r, createdAt: null })), [{ targetType: "post", reason: "spam", status: "open", details: "zedword report details", createdAt: null }]);
        assert.deepEqual(out.clubBans.map((b) => b.clubId), [1]);
        assert.deepEqual(out.suspensions.map((x) => [x.action, x.scope, x.until, x.reasonCode]), [["suspend", "social", null, "harassment"]]);

        // Nothing anyone else wrote, nobody who follows or blocked them, no real name, email or account id of anyone.
        const text = JSON.stringify(out);
        for (const others of ["miaword", "peteword", "Mia's own post", "Pete's own post", "Mia's words about Zed", "Pete the Smash", "Tama T", pid(PETE), pid(TAMA)]) assert.ok(!text.includes(others), others);
        const people = await rows(`SELECT id, email, first_name, last_name FROM players WHERE id = ANY($1::int[])`, [[MIA, PETE, QUINN, TAMA, ADMIN]]);
        for (const p of people) for (const secret of [p.email, p.last_name]) assert.ok(!text.includes(String(secret)), String(secret));
        const walk = (v: unknown, path: string): void => {
          if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
            assert.doesNotMatch(k, /^(player_?id|author_?id|reporter_?id|target_?id|created_?by|handled_?by|actor_?id|first_?name|last_?name|email|phone.*)$/i, `${path}.${k}`);
            walk(x, `${path}.${k}`);
          }
        };
        walk(out, "");
        // The same every time.
        assert.deepEqual(await exportSocial(db, zed), out);

        // Details that can't be opened (no key, or a key that never sealed them) are left out; the download still works.
        assert.equal((await exportSocial(db, zed, { env: {} })).reports[0].details, null);
        assert.equal((await exportSocial(db, zed, { env: { MODERATION_KEKS: `m9:${key()}` } })).reports[0].details, null);
        assert.equal((await exportSocial(db, zed, { env: { MODERATION_KEKS: "not a key list" } })).reports[0].details, null);
        // Someone they follow or blocked who is no longer in sight is listed by public id, without a name: a name taken
        // after a suspension, after leaving the club, or left on a retired account is not handed out.
        const named = async () => {
          const e = await exportSocial(db, zed);
          return [e.following.map((p) => [p.publicId, p.displayName]), e.blocked.map((p) => [p.publicId, p.displayName])];
        };
        assert.deepEqual(await named(), [[[pid(MIA), "Smash Queen"]], [[pid(QUINN), "Quinn Q"]]]);
        await admin.query(`UPDATE players SET deleted_at = now() WHERE id = $1`, [QUINN]);
        assert.deepEqual(await named(), [[[pid(MIA), "Smash Queen"]], [[pid(QUINN), null]]]);
        await admin.query(`UPDATE players SET deleted_at = NULL WHERE id = $1`, [QUINN]);
        await admin.query(`INSERT INTO player_suspensions (player_id, scope, reason_code) VALUES ($1, 'social', 'spam')`, [MIA]);
        await admin.query(`UPDATE social_profiles SET display_name = 'Renamed In Anger' WHERE player_id = $1`, [MIA]);
        assert.deepEqual(await named(), [[[pid(MIA), null]], [[pid(QUINN), "Quinn Q"]]]);
        assert.ok(!JSON.stringify(await exportSocial(db, zed)).includes("Renamed In Anger"));
        await admin.query(`DELETE FROM player_suspensions WHERE player_id = $1 AND reason_code = 'spam'`, [MIA]);
        await admin.query(`UPDATE club_members SET status = 'disabled' WHERE user_id = $1`, [QUINN]);
        assert.deepEqual(await named(), [[[pid(MIA), "Renamed In Anger"]], [[pid(QUINN), null]]]);
        // An `everyone` profile in a club the exporter isn't in is still in sight; with no club left it is not.
        await admin.query(`UPDATE social_profiles SET visibility = 'everyone' WHERE player_id = $1`, [QUINN]);
        assert.deepEqual((await named())[1], [[pid(QUINN), null]]);
        await admin.query(`UPDATE club_members SET status = 'active', tenant_id = $2 WHERE user_id = $1`, [QUINN, club2]);
        assert.deepEqual((await named())[1], [[pid(QUINN), "Quinn Q"]]);
        await admin.query(`UPDATE social_profiles SET visibility = 'club' WHERE player_id = $1`, [QUINN]);
        assert.deepEqual((await named())[1], [[pid(QUINN), null]]);
        await admin.query(`UPDATE club_members SET tenant_id = 1 WHERE user_id = $1`, [QUINN]);
        await admin.query(`UPDATE social_profiles SET display_name = 'Smash Queen' WHERE player_id = $1`, [MIA]);
        const out2 = await exportSocial(db, zed);
        assert.deepEqual(out2, out);

        // "Download my data" carries it, on both the app's and the website's route (one function).
        const download = await exporter.collectPlayerData((await players.getPlayerById(zed))!);
        assert.deepEqual(download.social, out);
        // A person who never joined: an empty section, not an error.
        assert.deepEqual(await exportSocial(db, (await person("Never", "Joined")).id), { profile: null, posts: [], comments: [], kudos: [], following: [], blocked: [], reports: [], clubBans: [], suspensions: [] });
      });
    });
  }
});
