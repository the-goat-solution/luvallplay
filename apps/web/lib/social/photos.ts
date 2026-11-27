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
// - Their own folders in the photo store, so a file uploaded for one
//   purpose can't be registered for another.
// - Their own daily cap, per person and purpose, counted and written behind
//   the person's lock (lib/player-lock.ts) so parallel requests can't pass it.
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
import { err, ok, type Result } from "../moderation/result.ts";
import { moderateImage, type ModerationResult } from "../photo-moderation.ts";
import { ownBlob, photoFilesSchema, photoUploadAnswer } from "../photos-service.ts";
import { withPlayerLock, type LockPool } from "../player-lock.ts";
import { deletePublicBlobs } from "../public-blob.ts";

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

export type SocialPhotoInput = {
  clubId: number;
  purpose: SocialPhotoPurpose;
  originalUrl: string;
  displayUrl: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  bytes: number;
};

export type RegisteredPhoto = { id: number; status: "approved" | "needs_review" | "rejected" };

type Alert = (kind: "needs_review" | "rejected", purpose: SocialPhotoPurpose, result: ModerationResult) => Promise<void>;
export type RegisterOptions = {
  /** The image check. Default: lib/photo-moderation.ts. */
  moderate?: (...urls: string[]) => Promise<ModerationResult>;
  /** Tells the club's admins about a held or blocked photo. Default: the admin alert email. */
  alert?: Alert;
};

/** The admins hear about a held or a blocked photo, as for a Gallery photo. The email names nobody: the review page does. */
const emailAdmins: Alert = async (kind, purpose, result) => {
  const { sendAdminAlertEmail } = await import("../player-email.ts");
  const what = purpose === "social" ? "a post" : "a listing";
  if (kind === "rejected") {
    await sendAdminAlertEmail({
      subject: `Photo blocked: uploaded for ${what}`,
      heading: "A photo was blocked by the safety check",
      lines: [
        `A photo uploaded for ${what} was rated as inappropriate by Google's SafeSearch. It's hidden everywhere and was not shown.`,
        `Ratings: ${Object.entries(result.safesearch ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")}`,
      ],
      cta: { label: "Review in Admin → Photos", path: "/admin/photos?tab=blocked" },
    });
    return;
  }
  await sendAdminAlertEmail({
    subject: `Photo to review, uploaded for ${what}`,
    heading: "A photo is waiting for review",
    lines: [
      result.reason === "checked"
        ? `SafeSearch wasn't sure about a photo uploaded for ${what}, so it's held until an admin approves it.`
        : `The automatic check isn't available right now, so a photo uploaded for ${what} is held until an admin approves it.`,
    ],
    cta: { label: "Review in Admin → Photos", path: "/admin/photos" },
  });
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
 * or who is at the day's cap. The cap is only looked at here (a file that
 * goes over it is refused again, behind the lock, when it is registered).
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
 * and files it. The answer's status is the check's: `approved`,
 * `needs_review` (held for an admin; a post with it stays held) or
 * `rejected` (never shown). The files must be in the person's own folder for
 * this purpose. At most SOCIAL_PHOTOS_PER_DAY a day for each purpose,
 * whatever came of them.
 */
export async function registerSocialPhoto(
  db: LockDb,
  playerId: number,
  input: SocialPhotoInput,
  { moderate = moderateImage, alert = emailAdmins }: RegisterOptions = {},
): Promise<Result<RegisteredPhoto, "invalid" | "not_member" | "rate_limited">> {
  const files = photoFilesSchema.safeParse(input);
  if (!id(playerId) || !files.success || !id(input.clubId) || !isPurpose(input.purpose)) return err("invalid");
  const { originalUrl, displayUrl, thumbUrl, width, height, bytes } = files.data;
  const { clubId, purpose } = input;
  if (![originalUrl, displayUrl, thumbUrl].every((u) => ownBlob(u, playerId, SOCIAL_PHOTO_FOLDERS[purpose]))) return err("invalid");
  if (!(await memberOf(db, playerId, clubId))) return err("not_member");

  // Count, then insert, one request of this person at a time.
  const photoId = await withPlayerLock(db, playerId, `${purpose}.photos`, async (tx) => {
    if (Number((await tx.query(TODAY, [playerId, purpose])).rows[0]?.n ?? 0) >= SOCIAL_PHOTOS_PER_DAY) return null;
    const { rows } = await tx.query(
      `INSERT INTO player_photos (tenant_id, player_id, purpose, original_url, display_url, thumb_url, width, height, bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [clubId, playerId, purpose, originalUrl, displayUrl, thumbUrl, width, height, bytes],
    );
    return Number(rows[0].id);
  });
  if (photoId === null) return err("rate_limited");

  // The check takes seconds and talks to another service: outside the lock.
  // Until it answers the row is `pending`, which nothing shows and no post can use.
  let result: ModerationResult;
  try {
    result = await moderate(displayUrl, originalUrl);
  } catch (e) {
    // The check never decides by failing: held for an admin.
    result = { status: "needs_review", safesearch: null, reason: "error", detail: (e as Error)?.message };
  }
  const status = result.status === "approved" || result.status === "rejected" ? result.status : "needs_review";
  await db.query(`UPDATE player_photos SET status = $2, safesearch = $3::jsonb WHERE id = $1 AND status = 'pending'`, [
    photoId,
    status,
    result.safesearch ? JSON.stringify(result.safesearch) : null,
  ]);
  if (status !== "approved") await alert(status, purpose, result).catch((e) => console.error("[social photos] alert failed:", e));
  return ok({ id: photoId, status });
}

export type PostPhoto = {
  id: number;
  /** `needs_review`: the caller keeps the post held until an admin approves the photo. */
  status: "approved" | "needs_review";
  /** The club the photo is filed under. A post shows it in that club's space. */
  clubId: number;
  displayUrl: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
};

/**
 * The photo a new post may carry: the author's own, uploaded for a post, not
 * deleted, and approved or still waiting for an admin (then the caller holds
 * the post). Null for anything else: someone else's photo, a Gallery or a
 * listing photo, a deleted, blocked, hidden or not-yet-checked one, an id
 * that isn't one.
 */
export async function usablePostPhoto(db: Db, authorId: number, photoId: unknown): Promise<PostPhoto | null> {
  if (!id(authorId) || !id(photoId)) return null;
  const { rows } = await db.query(
    `SELECT id, status, tenant_id, display_url, thumb_url, width, height FROM player_photos
     WHERE id = $2 AND player_id = $1 AND purpose = 'social' AND deleted_at IS NULL AND status IN ('approved', 'needs_review')`,
    [authorId, photoId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    status: r.status === "approved" ? "approved" : "needs_review",
    clubId: Number(r.tenant_id),
    displayUrl: String(r.display_url),
    thumbUrl: String(r.thumb_url),
    width: r.width === null ? null : Number(r.width),
    height: r.height === null ? null : Number(r.height),
  };
}

const ALIAS = /^[a-z_][a-z0-9_]*$/;

/**
 * The feed's join to a post's photo, checked again on every read: the row is
 * there only while the photo is still the author's own post photo, approved
 * and not deleted. A photo an admin later hides or blocks, or that is
 * deleted, drops out of the post (the columns read NULL) without the post
 * being touched. `post` and `photo` are table aliases from the code;
 * anything else throws. Use it as
 *   FROM social_posts p ${postPhotoJoinSql("p", "ph")}
 * and read ph.display_url, ph.thumb_url, ph.width, ph.height.
 */
export function postPhotoJoinSql(post: string, photo: string): string {
  for (const alias of [post, photo]) if (!ALIAS.test(alias)) throw new Error(`postPhotoJoinSql: "${alias}" is not a table alias.`);
  if (post === photo) throw new Error("postPhotoJoinSql: the two aliases must differ.");
  return `LEFT JOIN player_photos ${photo} ON ${photo}.id = ${post}.photo_id AND ${photo}.player_id = ${post}.author_id AND ${photo}.tenant_id = ${post}.club_id AND ${photo}.purpose = 'social' AND ${photo}.status = 'approved' AND ${photo}.deleted_at IS NULL`;
}

export type DeleteOptions = {
  /** Only this photo (a post's photo, when its author deletes the post). Default: all of them. */
  only?: number;
  /** Removes the files. Default: the public photo store (lib/public-blob.ts). */
  deleteBlobs?: (urls: string[]) => Promise<void>;
};

/**
 * Removes every photo this person uploaded for posts and listings, with the
 * files (deleting an account). Gallery photos are left alone. A photo a post
 * still points at can't be deleted as a row (the post's foreign key): it is
 * marked deleted, which takes it out of every read, and its files go all the
 * same. Call it after the person's posts are gone and every row goes.
 * Answers how many photos were removed (not counting ones removed before).
 */
export async function deleteSocialPhotos(db: Db, playerId: number, { only, deleteBlobs = deletePublicBlobs }: DeleteOptions = {}): Promise<{ photos: number }> {
  if (!id(playerId) || (only !== undefined && !id(only))) return { photos: 0 };
  // One statement: the rows no post points at are deleted, the rest marked.
  const { rows } = await db.query(
    `WITH mine AS (
       SELECT ph.id, ph.original_url, ph.display_url, ph.thumb_url, ph.deleted_at,
              EXISTS (SELECT 1 FROM social_posts po WHERE po.photo_id = ph.id) AS in_post
       FROM player_photos ph WHERE ph.player_id = $1 AND ph.purpose IN ('social', 'market') AND ($2::int IS NULL OR ph.id = $2)
       FOR UPDATE OF ph
     ), gone AS (
       DELETE FROM player_photos ph USING mine WHERE ph.id = mine.id AND NOT mine.in_post
     ), marked AS (
       UPDATE player_photos ph SET deleted_at = now() FROM mine WHERE ph.id = mine.id AND mine.in_post AND ph.deleted_at IS NULL
     )
     SELECT id, original_url, display_url, thumb_url, deleted_at FROM mine`,
    [playerId, only ?? null],
  );
  // A row marked deleted earlier has no files left, and was counted then.
  const live = rows.filter((r) => r.deleted_at === null);
  const urls = live.flatMap((r) => [r.original_url, r.display_url, r.thumb_url].map(String));
  if (urls.length > 0) await deleteBlobs(urls);
  return { photos: live.length };
}
