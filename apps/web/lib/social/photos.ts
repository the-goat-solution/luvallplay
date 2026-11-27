// Photos for Social posts and Marketplace listings.
//
// They are rows of player_photos, like a Gallery photo, with their own
// `purpose` ('social' or 'market', migration 0024). The same image check
// reads every one (lib/photo-moderation.ts) and a held one waits in the same
// admin review (Admin → Photos). What differs from the Gallery's photos
// (lib/photos-service.ts):
//
// - They never join the Gallery, "My photos" or the Gallery's 20 a day:
//   everything there reads `purpose = 'gallery'`.
// - No Gallery consent is asked or stored (consent_at stays empty): the
//   photo is shown with the post or the listing it was uploaded for.
// - ONE file, not three. The file the image check reads is the file every
//   page shows: the row's three URL columns all hold it, so no column can
//   carry a picture nobody checked. (The Gallery stores an original, a
//   display copy and a thumbnail, and checks the display copy.)
// - The file must be in OUR photo store, by its exact host (ownStoreHost()),
//   in the person's own folder for this purpose. Any other store's owner
//   could change the file after the check. With no store connected nothing
//   is accepted.
// - One file is one photo (a unique index): the same URL can't be
//   registered twice, so deleting one photo never removes another's file.
//   And one photo is in at most one post (a unique index on the post).
// - Their own daily cap, per person and purpose, counted and written behind
//   the person's lock (lib/player-lock.ts) so parallel requests can't pass it.
// - Nobody is emailed about a held or a blocked photo. The Gallery's alert
//   goes to the deployment's own admin list, which is not this photo's
//   club's; the photo waits in Admin → Photos, and moderation alerts are the
//   moderation pages' job.
// - Deleting removes the files FIRST and says so when it can't, so a row is
//   never dropped while its public file is still there.
// - The path is the account's, not a club's `gallery` module: the caller has
//   already checked Social (socialAccess) or the Marketplace. The person
//   must still be an active member of the club the photo is filed under.
//
// player_photos is a club's table (tenant_id, row-level security). The photo
// is stored under the club it is for. Under TENANT_SCOPE=enforce the
// connection sees one club's rows: a photo can be registered for that club
// only (another answers `not_member`), and usablePostPhoto, the feed's join
// and deleteSocialPhotos see that club's photos only.
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { z } from "zod";
import { err, ok, type Result } from "../moderation/result.ts";
import { moderateImage, type ModerationResult } from "../photo-moderation.ts";
import { ownBlob, ownStoreHost, photoUploadAnswer } from "../photos-service.ts";
import { withPlayerLock, type LockPool } from "../player-lock.ts";
import { publicStorage } from "../storage.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
/** A `Db` that can also hand out a connection, for the daily cap's lock (the app's `sql` is one). */
export type LockDb = Db & LockPool;

export type SocialPhotoPurpose = "social" | "market";
export const SOCIAL_PHOTO_PURPOSES: readonly SocialPhotoPurpose[] = ["social", "market"];

/** Photos a person may upload in 24 hours, for each purpose on its own. */
export const SOCIAL_PHOTOS_PER_DAY = 20;

/** The photo store's top folder for each purpose: <folder>/<player id>/… */
export const SOCIAL_PHOTO_FOLDERS: Record<SocialPhotoPurpose, string> = { social: "social-photos", market: "market-photos" };

const MAX_INT4 = 2_147_483_647;
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= MAX_INT4;
const isPurpose = (v: unknown): v is SocialPhotoPurpose => v === "social" || v === "market";

/** The one uploaded file of a photo and its size, as the device reports them. */
const fileSchema = z.object({
  url: z.string().url().max(500),
  width: z.number().int().positive().max(20000).nullable(),
  height: z.number().int().positive().max(20000).nullable(),
  bytes: z.number().int().nonnegative().max(100 * 1024 * 1024),
});

export type SocialPhotoInput = { clubId: number; purpose: SocialPhotoPurpose } & z.infer<typeof fileSchema>;

export type RegisteredPhoto = { id: number; status: "approved" | "needs_review" | "rejected" };

export type RegisterOptions = {
  /** The image check, given the photo's one file. Default: lib/photo-moderation.ts. */
  moderate?: (url: string) => Promise<ModerationResult>;
};

/** Is this person an active member of this club, as this connection sees it? */
async function memberOf(db: Db, playerId: number, clubId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM club_members cm
     JOIN tenants t ON t.id = cm.tenant_id AND t.status = 'active'
     JOIN players p ON p.id = cm.user_id AND p.deleted_at IS NULL
     WHERE cm.tenant_id = $1 AND cm.user_id = $2 AND cm.status = 'active'`,
    [clubId, playerId],
  );
  return rows.length > 0;
}

const TODAY = `SELECT count(*)::int AS n FROM player_photos WHERE player_id = $1 AND purpose = $2 AND created_at > now() - interval '24 hours'`;

/**
 * Answers the Blob client's upload call for a post's or a listing's photo:
 * the same answer as the Gallery's (lib/photos-service.ts), into this
 * purpose's own folder, refused for someone who isn't a member of the club
 * or who is at the day's cap. The cap is only looked at here, over the
 * photos registered so far (a file that goes over it is refused again,
 * behind the lock, when it is registered).
 */
export async function socialPhotoUploadAnswer(
  db: Db,
  request: Request,
  playerId: number,
  input: { clubId: number; purpose: SocialPhotoPurpose },
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  if (!id(playerId) || !id(input?.clubId) || !isPurpose(input?.purpose)) return { status: 400, json: { error: "invalid" } };
  if (!(await memberOf(db, playerId, input.clubId))) return { status: 403, json: { error: "not_member" } };
  return photoUploadAnswer(request, playerId, body, {
    folder: SOCIAL_PHOTO_FOLDERS[input.purpose],
    refuse: async () => (Number((await db.query(TODAY, [playerId, input.purpose])).rows[0]?.n ?? 0) >= SOCIAL_PHOTOS_PER_DAY ? "Daily photo limit reached" : null),
  });
}

/**
 * Registers an uploaded photo for a post or a listing, runs the image check
 * on its file and files it. The answer's status is what the row ended as:
 * `approved`, `needs_review` (held for an admin; a post with it stays held)
 * or `rejected` (never shown; also told for a photo an admin hid meanwhile).
 *
 * `invalid`: not one file in our own store, in the person's own folder for
 * this purpose (or no store is connected). `duplicate`: that file is a photo
 * already. At most SOCIAL_PHOTOS_PER_DAY a day for each purpose, whatever
 * came of them.
 */
export async function registerSocialPhoto(
  db: LockDb,
  playerId: number,
  input: SocialPhotoInput,
  { moderate = moderateImage }: RegisterOptions = {},
): Promise<Result<RegisteredPhoto, "invalid" | "not_member" | "rate_limited" | "duplicate">> {
  const file = fileSchema.safeParse(input);
  if (!id(playerId) || !file.success || !id(input.clubId) || !isPurpose(input.purpose)) return err("invalid");
  const { url, width, height, bytes } = file.data;
  const { clubId, purpose } = input;
  if (!ownBlob(url, playerId, SOCIAL_PHOTO_FOLDERS[purpose], { host: ownStoreHost() })) return err("invalid");
  if (!(await memberOf(db, playerId, clubId))) return err("not_member");

  // Count, then insert, one request of this person at a time. The one file
  // goes in all three columns: whichever a page reads, it is the checked one.
  const made = await withPlayerLock(db, playerId, `${purpose}.photos`, async (tx) => {
    if ((await tx.query(`SELECT 1 FROM player_photos WHERE display_url = $1 AND purpose <> 'gallery'`, [url])).rows.length > 0) return "duplicate" as const;
    if (Number((await tx.query(TODAY, [playerId, purpose])).rows[0]?.n ?? 0) >= SOCIAL_PHOTOS_PER_DAY) return "rate_limited" as const;
    // Another club's row with this file is out of this connection's sight under enforce: the index still refuses it.
    const { rows } = await tx.query(
      `INSERT INTO player_photos (tenant_id, player_id, purpose, original_url, display_url, thumb_url, width, height, bytes)
       VALUES ($1, $2, $3, $4, $4, $4, $5, $6, $7)
       ON CONFLICT (display_url) WHERE purpose <> 'gallery' DO NOTHING RETURNING id`,
      [clubId, playerId, purpose, url, width, height, bytes],
    );
    return rows[0] ? Number(rows[0].id) : ("duplicate" as const);
  });
  if (typeof made === "string") return err(made);

  // The check takes seconds and talks to another service: outside the lock.
  // Until it answers the row is `pending`, which nothing shows and no post can use.
  let result: ModerationResult;
  try {
    result = await moderate(url);
  } catch (e) {
    // The check never decides by failing: held for an admin.
    result = { status: "needs_review", safesearch: null, reason: "error", detail: (e as Error)?.message };
  }
  const checked = result.status === "approved" || result.status === "rejected" ? result.status : "needs_review";
  // Only a row still waiting takes the check's answer. An admin who decided
  // meanwhile is not overruled, and the answer is what the row now says.
  await db.query(`UPDATE player_photos SET status = $2, safesearch = $3::jsonb WHERE id = $1 AND status = 'pending'`, [made, checked, result.safesearch ? JSON.stringify(result.safesearch) : null]);
  const now = (await db.query(`SELECT status FROM player_photos WHERE id = $1 AND deleted_at IS NULL`, [made])).rows[0]?.status;
  if (now === undefined) return err("invalid");
  return ok({ id: made, status: now === "approved" || now === "needs_review" ? now : "rejected" });
}

export type PostPhoto = {
  id: number;
  /** `needs_review`: the caller keeps the post held until an admin approves the photo. */
  status: "approved" | "needs_review";
  /** The club the photo is filed under. A post shows it in that club's space. */
  clubId: number;
  /** The photo's one file: the one that was checked. */
  url: string;
  width: number | null;
  height: number | null;
};

/**
 * The photo a new post may carry: the author's own, uploaded for a post, not
 * deleted, not in a post already, and approved or still waiting for an admin
 * (then the caller holds the post). Null for anything else: someone else's
 * photo, a Gallery or a listing photo, a deleted, blocked, hidden or
 * not-yet-checked one, one another post has, an id that isn't one.
 *
 * Two posts made with the same photo at the same moment both get it here;
 * the second insert is refused by social_posts_photo_id_key (23505), which
 * the caller answers as `photo_not_found`.
 */
export async function usablePostPhoto(db: Db, authorId: number, photoId: unknown): Promise<PostPhoto | null> {
  if (!id(authorId) || !id(photoId)) return null;
  const { rows } = await db.query(
    `SELECT ph.id, ph.status, ph.tenant_id, ph.display_url, ph.width, ph.height FROM player_photos ph
     WHERE ph.id = $2 AND ph.player_id = $1 AND ph.purpose = 'social' AND ph.deleted_at IS NULL AND ph.status IN ('approved', 'needs_review')
       AND NOT EXISTS (SELECT 1 FROM social_posts po WHERE po.photo_id = ph.id)`,
    [authorId, photoId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    status: r.status === "approved" ? "approved" : "needs_review",
    clubId: Number(r.tenant_id),
    url: String(r.display_url),
    width: r.width === null ? null : Number(r.width),
    height: r.height === null ? null : Number(r.height),
  };
}

const ALIAS = /^[a-z_][a-z0-9_]*$/;

/**
 * The feed's join to a post's photo, checked again on every read: the row is
 * there only while the photo is still the author's own post photo, filed
 * under the post's club, approved and not deleted. A photo an admin later
 * hides or blocks, or that is deleted, drops out of the post (the columns
 * read NULL) without the post being touched. `post` and `photo` are table
 * aliases from the code; anything else throws. Use it as
 *   FROM social_posts p ${postPhotoJoinSql("p", "ph")}
 * and read ph.display_url (the checked file), ph.width and ph.height.
 */
export function postPhotoJoinSql(post: string, photo: string): string {
  for (const alias of [post, photo]) if (!ALIAS.test(alias)) throw new Error(`postPhotoJoinSql: "${alias}" is not a table alias.`);
  if (post === photo) throw new Error("postPhotoJoinSql: the two aliases must differ.");
  return `LEFT JOIN player_photos ${photo} ON ${photo}.id = ${post}.photo_id AND ${photo}.player_id = ${post}.author_id AND ${photo}.tenant_id = ${post}.club_id AND ${photo}.purpose = 'social' AND ${photo}.status = 'approved' AND ${photo}.deleted_at IS NULL`;
}

/**
 * Removes files from this deployment's photo store and throws when it can't:
 * no store connected, a file that isn't the store's own, or the store saying
 * no. (lib/public-blob.ts's deletePublicBlobs, which the Gallery uses, logs a
 * failure and carries on; here a failure has to stop the caller.)
 */
async function deleteStoredFiles(urls: string[]): Promise<void> {
  const storage = publicStorage();
  if (!storage.configured()) throw new Error("deleteSocialPhotos: no photo store is connected, so the files can't be removed.");
  const strangers = urls.filter((u) => !storage.owns(u));
  if (strangers.length > 0) throw new Error(`deleteSocialPhotos: ${strangers.length} file(s) are not in this deployment's photo store and can't be removed by it.`);
  await storage.delete(urls);
}

export type DeleteOptions = {
  /** Only this photo (a post's photo, when its author deletes the post). Default: all of them. */
  only?: number;
  /** Removes the files, and throws when it can't. Default: this deployment's photo store. */
  deleteFiles?: (urls: string[]) => Promise<void>;
};

/**
 * Removes every photo this person uploaded for posts and listings, with the
 * files (deleting an account). Gallery photos are left alone.
 *
 * The files go FIRST. If the store can't remove them this THROWS and no row
 * is touched: the caller must fail too (the account stays), and asking again
 * asks the store again. Only then do the rows go. A photo a post still
 * points at can't be deleted as a row (the post's foreign key): it is marked
 * deleted, which takes it out of every read. Call this after the person's
 * posts are gone and every row goes.
 *
 * Answers how many photos were newly removed. Rows marked deleted before are
 * asked of the store again each time (removing a file that is gone is not an
 * error) and are dropped once no post points at them.
 */
export async function deleteSocialPhotos(db: Db, playerId: number, { only, deleteFiles = deleteStoredFiles }: DeleteOptions = {}): Promise<{ photos: number }> {
  if (!id(playerId) || (only !== undefined && !id(only))) return { photos: 0 };
  const mine = (
    await db.query(
      `SELECT id, original_url, display_url, thumb_url, deleted_at FROM player_photos
       WHERE player_id = $1 AND purpose IN ('social', 'market') AND ($2::int IS NULL OR id = $2) ORDER BY id`,
      [playerId, only ?? null],
    )
  ).rows;
  if (mine.length === 0) return { photos: 0 };
  // The three columns hold one file; a row written by hand could hold more.
  const urls = [...new Set(mine.flatMap((r) => [r.original_url, r.display_url, r.thumb_url].map(String)))];
  await deleteFiles(urls);
  // The files are gone. One statement: the rows no post points at are deleted, the rest marked.
  await db.query(
    `WITH mine AS (
       SELECT ph.id, EXISTS (SELECT 1 FROM social_posts po WHERE po.photo_id = ph.id) AS in_post
       FROM player_photos ph WHERE ph.id = ANY($2::int[]) AND ph.player_id = $1 AND ph.purpose IN ('social', 'market')
       FOR UPDATE OF ph
     ), gone AS (
       DELETE FROM player_photos ph USING mine WHERE ph.id = mine.id AND NOT mine.in_post
     )
     UPDATE player_photos ph SET deleted_at = now() FROM mine WHERE ph.id = mine.id AND mine.in_post AND ph.deleted_at IS NULL`,
    [playerId, mine.map((r) => Number(r.id))],
  );
  return { photos: mine.filter((r) => r.deleted_at === null).length };
}
