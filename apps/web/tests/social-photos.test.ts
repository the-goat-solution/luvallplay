// Social plan, Task 4 (the photo groundwork, lane H): migration 0024's
// `purpose` column, the Gallery's reads that must not see a post's photo
// (lib/photos-db.ts), and the account's own photo path for posts and
// listings (lib/social/photos.ts). Against a real Postgres, with two clubs,
// once as the database owner (TENANT_SCOPE=off) and once as the app's role
// for one club (TENANT_SCOPE=enforce). Made-up people only.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";
import type { ModerationResult } from "../lib/photo-moderation.ts";
import { GALLERY_FOLDER, ownBlob } from "../lib/photos-service.ts";
import {
  SOCIAL_PHOTO_FOLDERS,
  SOCIAL_PHOTOS_PER_DAY,
  deleteSocialPhotos,
  postPhotoJoinSql,
  registerSocialPhoto,
  socialPhotoUploadAnswer,
  usablePostPhoto,
  type LockDb,
  type SocialPhotoPurpose,
} from "../lib/social/photos.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `social_photos_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const STORE = "https://store.public.blob.vercel-storage.com";

test("a file is the player's own only in the folder it was uploaded for", () => {
  assert.equal(GALLERY_FOLDER, "photos");
  assert.deepEqual(SOCIAL_PHOTO_FOLDERS, { social: "social-photos", market: "market-photos" });
  assert.equal(ownBlob(`${STORE}/photos/3/a.jpg`, 3), true, "the Gallery's folder is the default");
  assert.equal(ownBlob(`${STORE}/social-photos/3/a.jpg`, 3, "social-photos"), true);
  for (const [url, playerId, folder] of [
    [`${STORE}/social-photos/3/a.jpg`, 3, undefined],
    [`${STORE}/photos/3/a.jpg`, 3, "social-photos"],
    [`${STORE}/market-photos/3/a.jpg`, 3, "social-photos"],
    [`${STORE}/social-photos/4/a.jpg`, 3, "social-photos"],
    [`${STORE}/social-photos/33/a.jpg`, 3, "social-photos"],
    [`${STORE}/photos/3/../../social-photos/3/a.jpg`, 3, undefined],
    [`${STORE}/social-photos/3/%2e%2e/4/a.jpg`, 3, "social-photos"],
    [`http://store.public.blob.vercel-storage.com/social-photos/3/a.jpg`, 3, "social-photos"],
    [`https://evil.test/social-photos/3/a.jpg`, 3, "social-photos"],
    [`https://public.blob.vercel-storage.com.evil.test/social-photos/3/a.jpg`, 3, "social-photos"],
    [`${STORE}/social-photos/3/a.jpg`, 3, "social-photos/3/.."],
    [`${STORE}/social-photos/3/a.jpg`, 3, ""],
    ["not a url", 3, "social-photos"],
  ] as const) {
    assert.equal(ownBlob(url, playerId, folder as string | undefined), false, `${url} for ${playerId} in ${folder}`);
  }
});

test("the feed's photo join takes two table aliases and nothing else", () => {
  const join = postPhotoJoinSql("p", "ph");
  assert.match(join, /^LEFT JOIN player_photos ph ON ph\.id = p\.photo_id AND ph\.player_id = p\.author_id AND ph\.tenant_id = p\.club_id /);
  for (const part of ["ph.purpose = 'social'", "ph.status = 'approved'", "ph.deleted_at IS NULL"]) assert.ok(join.includes(part), part);
  for (const [post, photo] of [["p", "p"], ["p; DROP TABLE players", "ph"], ["p", "ph ON true --"], ["", "ph"], ["p", ""], ["p.x", "ph"], ["P", "ph"]]) {
    assert.throws(() => postPhotoJoinSql(post, photo), /not a table alias|must differ/, `${post} / ${photo}`);
  }
});

describe("photos for posts and listings", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const env = { ...process.env };
  let admin: pg.Client;
  let database: typeof import("../lib/database.ts");
  let photosDb: typeof import("../lib/photos-db.ts");
  let club2 = 0;
  // Seed accounts in Three Wolves (club 1): 3 Mia, 4 Pete, 7 Sione (also joins club 2).
  const MIA = 3;
  const PETE = 4;
  const SIONE = 7;
  // Hanoi Smash (club 2) only.
  let LINH = 0;
  const rows = async (text: string, params: unknown[] = []) => (await admin.query(text, params)).rows;
  let n = 0;
  /** What a device sends after uploading a photo's three files into the player's own folder. */
  const files = (playerId: number, purpose: SocialPhotoPurpose, clubId = 1) => {
    const base = `${STORE}/${SOCIAL_PHOTO_FOLDERS[purpose]}/${playerId}/${++n}`;
    return { clubId, purpose, originalUrl: `${base}-original.jpg`, displayUrl: `${base}-display.jpg`, thumbUrl: `${base}-thumb.jpg`, width: 1200, height: 800, bytes: 345_678 };
  };
  const says = (status: ModerationResult["status"]) => ({
    moderate: async (): Promise<ModerationResult> => ({ status, safesearch: { adult: "UNLIKELY" }, reason: "checked" }),
    alert: async () => {},
  });
  /** A photo written straight to the table, as the owner. */
  async function photo(playerId: number, purpose: string, status = "approved", o: { clubId?: number; deleted?: boolean; age?: string } = {}) {
    const base = `${STORE}/${purpose === "gallery" ? "photos" : SOCIAL_PHOTO_FOLDERS[purpose as SocialPhotoPurpose]}/${playerId}/${++n}`;
    const r = await rows(
      `INSERT INTO player_photos (tenant_id, player_id, purpose, status, original_url, display_url, thumb_url, width, height, bytes, consent_at, deleted_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1200, 800, 1000, CASE WHEN $3 = 'gallery' THEN now() END, CASE WHEN $8 THEN now() END, now() - $9::interval) RETURNING id`,
      [o.clubId ?? 1, playerId, purpose, status, `${base}-o.jpg`, `${base}-d.jpg`, `${base}-t.jpg`, o.deleted ?? false, o.age ?? "0"],
    );
    return Number(r[0].id);
  }
  const post = async (authorId: number, clubId: number, photoId: number) =>
    Number((await rows(`INSERT INTO social_posts (author_id, club_id, kind, body, photo_id) VALUES ($1, $2, 'photo', 'Net play', $3) RETURNING id`, [authorId, clubId, photoId]))[0].id);

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
    LINH = Number((await admin.query(`INSERT INTO players (email, first_name, last_name) VALUES ('linh@hanoi.test', 'Linh', 'Nguyen') RETURNING id`)).rows[0].id);
    await admin.query(`INSERT INTO club_members (tenant_id, user_id, role, status) VALUES ($1, $2, 'member', 'active'), ($1, $3, 'member', 'active')`, [club2, LINH, SIONE]);
    process.env.POSTGRES_URL = urlFor(NAME);
    process.env.DATABASE_DRIVER = "postgres";
    process.env.TENANT_SLUG = "three-wolves";
    delete process.env.TENANT_SCOPE;
    delete process.env.APP_DATABASE_URL;
    delete process.env.PHOTO_BLOB_READ_WRITE_TOKEN;
    delete process.env.PHOTO_STORE_ID;
    database = await import("../lib/database.ts");
    photosDb = await import("../lib/photos-db.ts");
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

  test("0024: every photo so far is a Gallery photo; the purpose is one of three; only a Gallery photo needs the Gallery's consent", async () => {
    assert.deepEqual(await rows(`SELECT purpose, count(*)::int AS n FROM player_photos GROUP BY 1`), [{ purpose: "gallery", n: 10 }]);
    const column = (await rows(`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'player_photos' AND column_name = 'purpose'`))[0];
    assert.deepEqual(column, { column_default: "'gallery'::text", is_nullable: "NO" });
    const insert = (purpose: string, consent: string) =>
      admin.query(`INSERT INTO player_photos (player_id, purpose, original_url, display_url, thumb_url, consent_at) VALUES ($1, $2, 'o', 'd', 't', ${consent}) RETURNING id`, [MIA, purpose]);
    await assert.rejects(insert("avatar", "now()"), /player_photos_purpose_check/);
    await assert.rejects(insert("gallery", "NULL"), /player_photos_gallery_consent_check/);
    const made = [(await insert("social", "NULL")).rows[0].id, (await insert("market", "NULL")).rows[0].id];
    await admin.query(`DELETE FROM player_photos WHERE id = ANY($1::int[])`, [made]);
    // Still one club's table, behind the club's row-level security.
    const table = (await rows(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'player_photos'`))[0];
    assert.deepEqual(table, { relrowsecurity: true, relforcerowsecurity: true });
    assert.deepEqual(await rows(`SELECT policyname FROM pg_policies WHERE tablename = 'player_photos'`), [{ policyname: "tenant_isolation" }]);
  });

  for (const mode of ["off", "enforce"] as const) {
    describe(`TENANT_SCOPE=${mode}`, () => {
      let db: LockDb;

      before(async () => {
        await database.closeDatabase();
        process.env.TENANT_SCOPE = mode;
        db = { query: (text, params) => database.sql.query(text, params), connect: () => database.sql.connect() } as LockDb;
      });
      beforeEach(async () => {
        await admin.query(`TRUNCATE social_kudos, social_comments, social_posts`);
        // The fixture's ten Gallery photos stay (ids 1 to 10); everything a test added goes.
        await admin.query(`DELETE FROM player_photos WHERE id > 10`);
        await admin.query(`UPDATE club_members SET status = 'active'`);
      });

      test("the connection is what the mode says", async () => {
        const who = (await db.query(`SELECT current_user AS role, current_setting('app.tenant_id', true) AS club`)).rows[0];
        if (mode === "enforce") assert.deepEqual(who, { role: "luvallplay_app", club: "1" });
        else assert.notEqual(who.role, "luvallplay_app");
      });

      test("a photo for a post or a listing never shows in the Gallery, My photos, or the Gallery's daily count", async () => {
        const gallery = async () => ({
          pool: (await photosDb.listGalleryPhotos()).map((p) => p.id).sort((a, b) => a - b),
          mine: (await photosDb.listPhotosForPlayer(MIA)).map((p) => p.id).sort((a, b) => a - b),
          today: await photosDb.countPhotosToday(MIA),
        });
        const before = await gallery();
        assert.ok(before.pool.length > 0 && before.mine.length > 0, "the fixture has Gallery photos");
        const social = await registerSocialPhoto(db, MIA, files(MIA, "social"), says("approved"));
        const market = await registerSocialPhoto(db, MIA, files(MIA, "market"), says("approved"));
        assert.ok(social.ok && market.ok);
        assert.deepEqual(await gallery(), before, "nothing about the Gallery moved");
        // The same photo as a Gallery photo would have: the filter is the purpose, nothing else.
        const shared = await photo(MIA, "gallery");
        const now = await gallery();
        assert.deepEqual([now.pool.includes(shared), now.mine.includes(shared), now.today], [true, true, before.today + 1]);
        assert.ok(!now.pool.includes(social.value.id) && !now.mine.includes(social.value.id) && !now.pool.includes(market.value.id));
        // A player's own Gallery delete and "featured" don't reach a post's photo.
        assert.equal(await photosDb.deletePlayerPhoto(MIA, social.value.id), null);
        await photosDb.adminSetFeatured(social.value.id, true);
        assert.deepEqual(await rows(`SELECT featured, deleted_at FROM player_photos WHERE id = $1`, [social.value.id]), [{ featured: false, deleted_at: null }]);
        assert.equal((await photosDb.deletePlayerPhoto(MIA, shared))?.id, shared, "a Gallery photo is deleted as before");
      });

      test("the admin's review sees a held photo whatever it is for, and approving it makes it usable", async () => {
        const waiting = await photosDb.countPhotosNeedingReview();
        const held = await registerSocialPhoto(db, MIA, files(MIA, "social"), says("needs_review"));
        assert.deepEqual(held.ok && held.value.status, "needs_review");
        const id = held.ok ? held.value.id : 0;
        assert.equal(await photosDb.countPhotosNeedingReview(), waiting + 1);
        const listed = (await photosDb.listPhotosForAdmin("review")).find((p) => p.id === id);
        assert.deepEqual([listed?.purpose, listed?.status], ["social", "needs_review"]);
        assert.equal((await photosDb.listPhotosForAdmin("review")).find((p) => p.id === 2)?.purpose, "gallery");
        assert.equal((await usablePostPhoto(db, MIA, id))?.status, "needs_review");
        await photosDb.adminSetPhotoStatus(id, "approved");
        assert.equal((await usablePostPhoto(db, MIA, id))?.status, "approved");
        assert.ok(!(await photosDb.listGalleryPhotos()).some((p) => p.id === id), "approved, and still not in the Gallery");
        assert.equal((await photosDb.getPhotoById(id))?.purpose, "social");
      });

      test("registering: the check's answer is the status; no Gallery consent is stored; the files must be in the purpose's own folder", async () => {
        const alerts: string[] = [];
        const check = (status: ModerationResult["status"]) => ({ ...says(status), alert: async (kind: string, purpose: string) => void alerts.push(`${kind}:${purpose}`) });
        const approved = await registerSocialPhoto(db, MIA, files(MIA, "social"), check("approved"));
        const held = await registerSocialPhoto(db, MIA, files(MIA, "market"), check("needs_review"));
        const blocked = await registerSocialPhoto(db, MIA, files(MIA, "social"), check("rejected"));
        assert.deepEqual([approved, held, blocked].map((r) => r.ok && r.value.status), ["approved", "needs_review", "rejected"]);
        assert.deepEqual(alerts, ["needs_review:market", "rejected:social"], "the admins hear about a held and a blocked photo only");
        const stored = await rows(`SELECT purpose, status, tenant_id, consent_at, safesearch, caption, featured FROM player_photos WHERE id > 10 ORDER BY id`);
        assert.deepEqual(stored.map((r) => [r.purpose, r.status, r.tenant_id, r.consent_at, r.featured]), [
          ["social", "approved", 1, null, false],
          ["market", "needs_review", 1, null, false],
          ["social", "rejected", 1, null, false],
        ]);
        assert.deepEqual(stored[0].safesearch, { adult: "UNLIKELY" });
        // A check that breaks, or can't say, holds the photo. It never approves by failing.
        const broken = await registerSocialPhoto(db, MIA, files(MIA, "social"), { moderate: async () => Promise.reject(new Error("vision is down")), alert: async () => {} });
        const odd = await registerSocialPhoto(db, MIA, files(MIA, "social"), says("pending"));
        assert.deepEqual([broken, odd].map((r) => r.ok && r.value.status), ["needs_review", "needs_review"]);
        // An alert that fails doesn't lose the photo.
        const quiet = await registerSocialPhoto(db, MIA, files(MIA, "social"), { ...says("needs_review"), alert: async () => Promise.reject(new Error("no email")) });
        assert.equal(quiet.ok, true);

        const count = async () => Number((await rows(`SELECT count(*)::int AS n FROM player_photos WHERE id > 10`))[0].n);
        const had = await count();
        const good = files(MIA, "social");
        for (const bad of [
          { ...good, displayUrl: good.displayUrl.replace("/social-photos/", "/photos/") },
          { ...good, originalUrl: good.originalUrl.replace("/social-photos/", "/market-photos/") },
          { ...good, thumbUrl: good.thumbUrl.replace(`/${MIA}/`, `/${PETE}/`) },
          { ...good, displayUrl: "https://evil.test/social-photos/3/x.jpg" },
          { ...good, purpose: "gallery" },
          { ...good, purpose: undefined },
          { ...good, clubId: "1" },
          { ...good, clubId: 0 },
          { ...good, bytes: -1 },
          { ...good, width: 0 },
          { ...files(MIA, "market"), purpose: "social" },
        ]) {
          assert.deepEqual(await registerSocialPhoto(db, MIA, bad as never, says("approved")), { ok: false, code: "invalid" }, JSON.stringify(bad));
        }
        assert.deepEqual(await registerSocialPhoto(db, 0, good, says("approved")), { ok: false, code: "invalid" });
        assert.equal(await count(), had, "nothing was stored for any of them");
      });

      test("registering needs an active membership of that club", async () => {
        // Linh is in Hanoi Smash only; Pete in Three Wolves only.
        assert.deepEqual(await registerSocialPhoto(db, LINH, files(LINH, "social", 1), says("approved")), { ok: false, code: "not_member" });
        assert.deepEqual(await registerSocialPhoto(db, PETE, files(PETE, "social", club2), says("approved")), { ok: false, code: "not_member" });
        assert.deepEqual(await registerSocialPhoto(db, PETE, files(PETE, "market", 999_999), says("approved")), { ok: false, code: "not_member" });
        await admin.query(`UPDATE club_members SET status = 'disabled' WHERE tenant_id = 1 AND user_id = $1`, [PETE]);
        assert.deepEqual(await registerSocialPhoto(db, PETE, files(PETE, "social"), says("approved")), { ok: false, code: "not_member" }, "a membership that was switched off");
        assert.deepEqual(await rows(`SELECT 1 FROM player_photos WHERE id > 10`), []);

        // Sione is in both clubs. The photo is filed under the club it was uploaded for.
        const own = await registerSocialPhoto(db, SIONE, files(SIONE, "social", 1), says("approved"));
        assert.equal(own.ok, true);
        const other = await registerSocialPhoto(db, SIONE, files(SIONE, "social", club2), says("approved"));
        if (mode === "enforce") {
          // This connection is club 1's: it can't see the membership in club 2, nor write a row there.
          assert.deepEqual(other, { ok: false, code: "not_member" });
        } else {
          assert.equal(other.ok, true);
          assert.deepEqual((await rows(`SELECT tenant_id FROM player_photos WHERE id = $1`, [other.ok && other.value.id]))[0], { tenant_id: club2 });
          assert.equal((await usablePostPhoto(db, SIONE, other.ok ? other.value.id : 0))?.clubId, club2);
        }
      });

      test("usablePostPhoto: the author's own post photo, approved or held; anything else is null", async () => {
        const mine = await photo(MIA, "social", "approved");
        assert.deepEqual(await usablePostPhoto(db, MIA, mine), {
          id: mine,
          status: "approved",
          clubId: 1,
          displayUrl: (await rows(`SELECT display_url FROM player_photos WHERE id = $1`, [mine]))[0].display_url,
          thumbUrl: (await rows(`SELECT thumb_url FROM player_photos WHERE id = $1`, [mine]))[0].thumb_url,
          width: 1200,
          height: 800,
        });
        assert.equal((await usablePostPhoto(db, MIA, await photo(MIA, "social", "needs_review")))?.status, "needs_review");
        assert.equal(await usablePostPhoto(db, PETE, mine), null, "someone else's photo");
        assert.equal(await usablePostPhoto(db, MIA, await photo(MIA, "gallery", "approved")), null, "a Gallery photo");
        assert.equal(await usablePostPhoto(db, MIA, 2), null, "one of the fixture's Gallery photos");
        assert.equal(await usablePostPhoto(db, MIA, await photo(MIA, "market", "approved")), null, "a listing's photo");
        assert.equal(await usablePostPhoto(db, MIA, await photo(MIA, "social", "approved", { deleted: true })), null, "deleted");
        for (const status of ["rejected", "hidden", "pending"]) assert.equal(await usablePostPhoto(db, MIA, await photo(MIA, "social", status)), null, status);
        for (const bad of [0, -1, 1.5, 2 ** 31, Number.NaN, "7", `${mine}`, null, undefined, { valueOf: () => mine }]) assert.equal(await usablePostPhoto(db, MIA, bad), null, String(bad));
        assert.equal(await usablePostPhoto(db, Number.NaN, mine), null);
        // Another club's photo: there for the owner's connection, out of sight for club 1's.
        const abroad = await photo(SIONE, "social", "approved", { clubId: club2 });
        assert.equal((await usablePostPhoto(db, SIONE, abroad))?.clubId ?? null, mode === "enforce" ? null : club2);
      });

      test("the feed's join checks the photo again on every read", async () => {
        const read = async (postId: number) =>
          (await db.query(`SELECT p.id, ph.display_url FROM social_posts p ${postPhotoJoinSql("p", "ph")} WHERE p.id = $1`, [postId])).rows[0];
        const photoId = await photo(MIA, "social", "approved");
        const postId = await post(MIA, 1, photoId);
        assert.match(String((await read(postId)).display_url), /\/social-photos\/3\//);
        for (const [change, undo] of [
          [`status = 'hidden'`, `status = 'approved'`],
          [`status = 'rejected'`, `status = 'approved'`],
          [`status = 'needs_review'`, `status = 'approved'`],
          [`deleted_at = now()`, `deleted_at = NULL`],
          [`purpose = 'market'`, `purpose = 'social'`],
          [`player_id = ${PETE}`, `player_id = ${MIA}`],
        ]) {
          await admin.query(`UPDATE player_photos SET ${change} WHERE id = $1`, [photoId]);
          assert.deepEqual(await read(postId), { id: String(postId), display_url: null }, `after ${change}: the post is still there, without the photo`);
          await admin.query(`UPDATE player_photos SET ${undo} WHERE id = $1`, [photoId]);
        }
        assert.ok((await read(postId)).display_url, "and back when the photo is approved again");
        // A photo filed under another club than the post's doesn't show.
        const elsewhere = await post(SIONE, 1, await photo(SIONE, "social", "approved", { clubId: club2 }));
        assert.equal((await read(elsewhere)).display_url, null);
      });

      test(`at most ${SOCIAL_PHOTOS_PER_DAY} a day for each purpose, however many arrive at once, and apart from the Gallery's count`, async () => {
        for (let i = 0; i < SOCIAL_PHOTOS_PER_DAY - 3; i++) await photo(MIA, "social", i % 2 ? "approved" : "rejected", { deleted: i % 5 === 0 });
        // Yesterday's, a listing's, the Gallery's and another person's don't count.
        await photo(MIA, "social", "approved", { age: "25 hours" });
        await photo(MIA, "market");
        await photo(PETE, "social");
        for (let i = 0; i < 5; i++) await photo(MIA, "gallery");
        const galleryToday = await photosDb.countPhotosToday(MIA);
        const answers = await Promise.all(Array.from({ length: 8 }, () => registerSocialPhoto(db, MIA, files(MIA, "social"), says("approved"))));
        assert.equal(answers.filter((a) => a.ok).length, 3);
        assert.deepEqual(answers.filter((a) => !a.ok).map((a) => !a.ok && a.code), Array(5).fill("rate_limited"));
        const today = `SELECT count(*)::int AS n FROM player_photos WHERE player_id = $1 AND purpose = $2 AND created_at > now() - interval '24 hours'`;
        assert.equal((await rows(today, [MIA, "social"]))[0].n, SOCIAL_PHOTOS_PER_DAY);
        assert.deepEqual(await registerSocialPhoto(db, MIA, files(MIA, "social"), says("approved")), { ok: false, code: "rate_limited" });
        // The other purpose and the Gallery have their own room.
        assert.equal((await registerSocialPhoto(db, MIA, files(MIA, "market"), says("approved"))).ok, true);
        assert.equal(await photosDb.countPhotosToday(MIA), galleryToday);
        assert.equal((await registerSocialPhoto(db, PETE, files(PETE, "social"), says("approved"))).ok, true);
      });

      test("the upload answer: only a member, only into the purpose's own folder, not past the day's cap", async () => {
        const request = new Request("https://club.test/api/upload", { method: "POST" });
        const ask = (playerId: number, purpose: string, pathname: string, clubId = 1) =>
          socialPhotoUploadAnswer(db, request, playerId, { clubId, purpose: purpose as SocialPhotoPurpose }, { type: "blob.generate-client-token", payload: { pathname, callbackUrl: "", clientPayload: null, multipart: false } });
        assert.deepEqual(await ask(LINH, "social", `social-photos/${LINH}/a.jpg`), { status: 403, json: { error: "not_member" } });
        assert.deepEqual(await ask(MIA, "gallery", `photos/${MIA}/a.jpg`), { status: 400, json: { error: "invalid" } });
        assert.deepEqual(await ask(MIA, "social", `social-photos/${MIA}/a.jpg`), { status: 503, json: { error: "not_configured" } }, "no photo store connected");
        process.env.PHOTO_BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_notarealsecret";
        try {
          const good = await ask(MIA, "social", `social-photos/${MIA}/a.jpg`);
          assert.deepEqual([good.status, good.json.type, typeof good.json.clientToken], [200, "blob.generate-client-token", "string"]);
          assert.equal((await ask(MIA, "market", `market-photos/${MIA}/a.jpg`)).status, 200);
          for (const pathname of [`photos/${MIA}/a.jpg`, `market-photos/${MIA}/a.jpg`, `social-photos/${PETE}/a.jpg`, `social-photos/${MIA}/../${PETE}/a.jpg`, `social-photos/a.jpg`]) {
            assert.deepEqual(await ask(MIA, "social", pathname), { status: 400, json: { error: "Wrong folder" } }, pathname);
          }
          for (let i = 0; i < SOCIAL_PHOTOS_PER_DAY; i++) await photo(MIA, "social");
          assert.deepEqual(await ask(MIA, "social", `social-photos/${MIA}/b.jpg`), { status: 400, json: { error: "Daily photo limit reached" } });
          assert.equal((await ask(MIA, "market", `market-photos/${MIA}/b.jpg`)).status, 200, "the other purpose has its own count");
        } finally {
          delete process.env.PHOTO_BLOB_READ_WRITE_TOKEN;
        }
      });

      test("deleteSocialPhotos: the person's post and listing photos go, with their files; Gallery photos and other people's stay", async () => {
        const gallery = await photo(MIA, "gallery");
        const loose = await photo(MIA, "social");
        const listing = await photo(MIA, "market", "needs_review");
        const posted = await photo(MIA, "social");
        const goneBefore = await photo(MIA, "social", "approved", { deleted: true });
        const petes = await photo(PETE, "social");
        const postId = await post(MIA, 1, posted);
        const removed: string[] = [];
        const deleteBlobs = async (urls: string[]) => void removed.push(...urls);
        const fixture = await rows(`SELECT id, deleted_at FROM player_photos WHERE id <= 10 ORDER BY id`);

        assert.deepEqual(await deleteSocialPhotos(db, MIA, { deleteBlobs }), { photos: 3 });
        const left = await rows(`SELECT id, purpose, deleted_at IS NOT NULL AS deleted FROM player_photos WHERE id > 10 ORDER BY id`);
        assert.deepEqual(left, [
          { id: gallery, purpose: "gallery", deleted: false },
          // Still pointed at by the post: marked, not removed.
          { id: posted, purpose: "social", deleted: true },
          { id: petes, purpose: "social", deleted: false },
        ]);
        assert.deepEqual(await rows(`SELECT id, deleted_at FROM player_photos WHERE id <= 10 ORDER BY id`), fixture);
        assert.equal(removed.length, 9, "three files for each of the three live photos");
        assert.ok(removed.every((u) => u.includes(`/${MIA}/`) && !u.includes("/photos/")));
        assert.ok(![loose, listing, goneBefore].some((id) => left.some((r) => r.id === id)));
        assert.equal(await usablePostPhoto(db, MIA, posted), null);
        assert.equal((await db.query(`SELECT ph.id FROM social_posts p ${postPhotoJoinSql("p", "ph")} WHERE p.id = $1`, [postId])).rows[0].id, null);

        // Again: nothing more to remove, no file asked for twice. With the post gone, the last row goes.
        removed.length = 0;
        assert.deepEqual(await deleteSocialPhotos(db, MIA, { deleteBlobs }), { photos: 0 });
        assert.deepEqual(removed, []);
        await admin.query(`DELETE FROM social_posts WHERE id = $1`, [postId]);
        assert.deepEqual(await deleteSocialPhotos(db, MIA, { deleteBlobs }), { photos: 0 });
        assert.deepEqual((await rows(`SELECT id FROM player_photos WHERE id > 10 ORDER BY id`)).map((r) => r.id), [gallery, petes]);

        // One photo only: a post's photo, when its author deletes the post.
        const a = await photo(PETE, "social");
        assert.deepEqual(await deleteSocialPhotos(db, PETE, { only: gallery, deleteBlobs }), { photos: 0 }, "not theirs, and a Gallery photo");
        assert.deepEqual(await deleteSocialPhotos(db, MIA, { only: a, deleteBlobs }), { photos: 0 }, "someone else's");
        assert.deepEqual(await deleteSocialPhotos(db, PETE, { only: a, deleteBlobs }), { photos: 1 });
        assert.deepEqual((await rows(`SELECT id FROM player_photos WHERE id > 10 ORDER BY id`)).map((r) => r.id), [gallery, petes]);
        assert.equal(removed.length, 3);
        for (const bad of [0, 1.5, Number.NaN, "7"]) assert.deepEqual(await deleteSocialPhotos(db, PETE, { only: bad as never, deleteBlobs }), { photos: 0 });
        assert.deepEqual(await deleteSocialPhotos(db, 0, { deleteBlobs }), { photos: 0 });
        assert.equal((await rows(`SELECT count(*)::int AS n FROM player_photos WHERE id = $1`, [petes]))[0].n, 1);

        // Under enforce, another club's photos are out of this connection's reach.
        const abroad = await photo(SIONE, "social", "approved", { clubId: club2 });
        const here = await photo(SIONE, "social");
        assert.deepEqual(await deleteSocialPhotos(db, SIONE, { deleteBlobs }), { photos: mode === "enforce" ? 1 : 2 });
        const kept = (await rows(`SELECT id FROM player_photos WHERE id = ANY($1::int[])`, [[abroad, here]])).map((r) => r.id);
        assert.deepEqual(kept, mode === "enforce" ? [abroad] : []);
      });
    });
  }
});
