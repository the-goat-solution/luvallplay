// Posts (Social plan, Task 4): writing one, deleting your own, and the ONE
// gate that says whether a person may see a post.
//
// Who sees a post is decided by canSeePost (@luvallplay/core/social). This
// file holds the same rule as SQL (postVisibleSql), used by loadVisiblePost
// for every by-id call and by the feed (lib/social/feed.ts), so a list and a
// by-id read can't disagree. tests/social-feed.test.ts checks the SQL against
// canSeePost over every combination.
//
// On top of canSeePost's inputs the SQL also hides, from everybody:
// - a post whose author has no social profile, or no club left with Social
//   on (Review Focus 2: the rows stay, the person disappears);
// - a match post whose match is no longer `completed` (see auto-posts.ts).
// And from everybody but the author: a post whose author the post's club has
// banned (the club's ban closes its space both ways).
//
// A post the viewer can't see answers exactly like one that doesn't exist
// (Review Focus 6): loadVisiblePost gives null and says nothing more.
//
// Rules for writing:
// - the club must be one of the author's clubs with Social on, and the author
//   not banned there (`not_member` either way);
// - the text is cleaned and screened: `reject` refuses it, `hold` saves the
//   post `held` (only its author sees it until a moderator looks);
// - a photo must be the author's own post photo, filed under the same club
//   and in no other post; one still waiting for an admin keeps the post held;
// - a post needs words unless it has a photo;
// - at most POSTS_PER_DAY text and photo posts in 24 hours, counted and
//   written behind the person's lock, deleted ones included.
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { SOCIAL_LIMITS, cleanText, screenText, type PostKind, type PostState } from "@luvallplay/core/social";
import { notBlockedSql } from "../moderation/blocks.ts";
import { registerReportTarget } from "../moderation/reports.ts";
import { err, ok, type Result } from "../moderation/result.ts";
import { notSuspendedSql } from "../moderation/suspensions.ts";
import type { Env } from "../juniors/switch-rule.ts";
import { withPlayerLock, type LockPool } from "../player-lock.ts";
import { socialAccess } from "./access.ts";
import { deleteSocialPhotos, usablePostPhoto, type DeleteOptions } from "./photos.ts";
import { socialClubsParam } from "./visible.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
/** A `Db` that can also hand out a connection, for the daily cap's lock (the app's `sql` is one). */
export type LockDb = Db & LockPool;

/** Text and photo posts a person may make in 24 hours. Automatic posts have their own cap. */
export const POSTS_PER_DAY = 10;

const MAX_INT4 = 2_147_483_647;
/** A post's or a comment's id as a person may send it. */
export const isRowId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const isAccountId = (v: unknown): v is number => isRowId(v) && v <= MAX_INT4;

const PARAM = /^\$[1-9][0-9]*$/;

/** A match post's key: "challenge:<id>:<side>". */
export const MATCH_REF = /^challenge:([1-9][0-9]{0,8}):(posting|accepting)$/;

/**
 * The match behind a match post still stands. Anything else that is a match
 * post (the match was voided or is disputed again, or its club's rows can't
 * be read from this connection) is out of sight for everybody.
 */
const MATCH_STANDS = `(p.kind <> 'match' OR EXISTS (
         SELECT 1 FROM arena_challenges ac
         WHERE p.ref_key ~ '^challenge:[1-9][0-9]{0,8}:(posting|accepting)$'
           AND ac.id = split_part(p.ref_key, ':', 2)::int AND ac.tenant_id = p.club_id AND ac.status = 'completed'))`;

/**
 * The condition that the viewer may see post `p`. The query must have
 *   social_posts p
 *   JOIN players a ON a.id = p.author_id AND a.deleted_at IS NULL
 *   JOIN social_profiles sp ON sp.player_id = p.author_id
 * `viewerParam` is the viewer's account id, `viewerClubsParam` the viewer's
 * clubs with Social on (socialAccess().clubIds, an int[]), `pilotParam`
 * socialClubsParam(). canSeePost in SQL: change one, change the other.
 */
export function postVisibleSql(viewerParam: string, viewerClubsParam: string, pilotParam: string): string {
  for (const p of [viewerParam, viewerClubsParam, pilotParam]) if (!PARAM.test(p)) throw new Error(`postVisibleSql: "${p}" is not a parameter like $1.`);
  return `(p.state <> 'removed'
     AND ${MATCH_STANDS}
     AND EXISTS (SELECT 1 FROM social_clubs_of(p.author_id) AS ac(c) WHERE (${pilotParam}::int[] IS NULL OR ac.c = ANY(${pilotParam}::int[])))
     AND (p.author_id = ${viewerParam} OR (
           p.state = 'visible'
       AND ${notBlockedSql(viewerParam, "p.author_id")}
       AND ${notSuspendedSql("p.author_id", "social")}
       AND NOT EXISTS (SELECT 1 FROM social_club_bans cb WHERE cb.club_id = p.club_id AND cb.player_id IN (${viewerParam}, p.author_id))
       AND (p.club_id = ANY(${viewerClubsParam}::int[])
            OR (sp.visibility = 'everyone' AND EXISTS (SELECT 1 FROM social_follows f WHERE f.follower_id = ${viewerParam} AND f.followee_id = p.author_id))))))`;
}

/**
 * A post as the libraries pass it around. `authorId` is for joins and checks
 * inside the server and is never sent to a person: what goes out is the
 * feed's shape (lib/social/feed.ts), with the author's public id.
 */
export type VisiblePost = {
  id: number;
  authorId: number;
  clubId: number;
  kind: PostKind;
  state: Exclude<PostState, "removed">;
  body: string | null;
  photoId: number | null;
  createdAt: string;
  /** It is the viewer's own. */
  mine: boolean;
};

/**
 * The post with this id, if `viewerId` may see it and may use Social;
 * otherwise null, whatever the reason. Everything that takes a post's id from
 * a person (comments, kudos, deleting, reporting) asks here first.
 */
export async function loadVisiblePost(db: Db, viewerId: number, postId: unknown, { env = process.env }: { env?: Env } = {}): Promise<VisiblePost | null> {
  if (!isAccountId(viewerId) || !isRowId(postId)) return null;
  const access = await socialAccess(db, viewerId, env);
  if (!access.ok) return null;
  const { rows } = await db.query(
    `SELECT p.id, p.author_id, p.club_id, p.kind, p.state, p.body, p.photo_id, p.created_at
     FROM social_posts p
     JOIN players a ON a.id = p.author_id AND a.deleted_at IS NULL
     JOIN social_profiles sp ON sp.player_id = p.author_id
     WHERE p.id = $4 AND ${postVisibleSql("$1", "$2", "$3")}`,
    [viewerId, access.clubIds, socialClubsParam(env), postId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    authorId: Number(r.author_id),
    clubId: Number(r.club_id),
    kind: r.kind as PostKind,
    state: r.state as VisiblePost["state"],
    body: r.body === null ? null : String(r.body),
    photoId: r.photo_id === null ? null : Number(r.photo_id),
    createdAt: new Date(r.created_at as string | Date).toISOString(),
    mine: Number(r.author_id) === viewerId,
  };
}

/** Whether the club has banned this person from its space. */
export async function bannedInClub(db: Db, playerId: number, clubId: number): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM social_club_bans WHERE club_id = $1 AND player_id = $2`, [clubId, playerId])).rows.length > 0;
}

export type CreatedPost = { id: number; kind: "text" | "photo"; state: "visible" | "held"; createdAt: string };

export type PostInput = { clubId: number; body?: unknown; photoId?: unknown };

/**
 * Writes a post in one of the author's clubs. See the top of the file for the
 * rules. `held` in the answer means only the author sees it for now.
 * `db` must be able to give a connection (the daily cap's lock); not to be
 * called inside another withPlayerLock.
 */
export async function createPost(
  db: LockDb,
  authorId: number,
  input: PostInput,
  { env = process.env }: { env?: Env } = {},
): Promise<Result<CreatedPost, "not_allowed" | "required" | "too_long" | "not_member" | "not_joined" | "photo_not_found" | "rate_limited">> {
  if (!isAccountId(authorId)) return err("not_member");
  const access = await socialAccess(db, authorId, env);
  if (!access.ok) return err("not_member");
  if (!access.profile) return err("not_joined");
  const clubId = input?.clubId;
  if (!isAccountId(clubId) || !access.clubIds.includes(clubId) || (await bannedInClub(db, authorId, clubId))) return err("not_member");

  const withPhoto = input.photoId !== undefined && input.photoId !== null;
  const cleaned = cleanText(input.body, SOCIAL_LIMITS.post);
  if (!cleaned.ok && (cleaned.code === "too_long" || !withPhoto)) return err(cleaned.code);
  const body = cleaned.ok ? cleaned.text : null;
  let held = false;
  if (body !== null) {
    const screened = screenText(body);
    if (screened === "reject") return err("not_allowed");
    held = screened === "hold";
  }
  let photoId: number | null = null;
  if (withPhoto) {
    const photo = await usablePostPhoto(db, authorId, input.photoId);
    if (!photo || photo.clubId !== clubId) return err("photo_not_found");
    if (photo.status !== "approved") held = true;
    photoId = photo.id;
  }

  try {
    return await withPlayerLock(db, authorId, "social.posts", async (tx) => {
      const today = await tx.query(`SELECT count(*)::int AS n FROM social_posts WHERE author_id = $1 AND kind IN ('text', 'photo') AND created_at > now() - interval '24 hours'`, [authorId]);
      if (Number(today.rows[0]?.n ?? 0) >= POSTS_PER_DAY) return err("rate_limited");
      const kind = photoId === null ? "text" : "photo";
      const { rows } = await tx.query(
        `INSERT INTO social_posts (author_id, club_id, kind, body, photo_id, state) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
        [authorId, clubId, kind, body, photoId, held ? "held" : "visible"],
      );
      return ok({ id: Number(rows[0].id), kind, state: held ? "held" : "visible", createdAt: new Date(rows[0].created_at as string | Date).toISOString() } as CreatedPost);
    });
  } catch (e) {
    // Another post took the photo between the look and the insert.
    if ((e as { code?: string }).code === "23505" && (e as { constraint?: string }).constraint === "social_posts_photo_id_key") return err("photo_not_found");
    throw e;
  }
}

/**
 * The author deletes their own post: it becomes `removed`, which nobody sees
 * again, and lets go of its photo, which is then deleted with its file.
 * `not_found` for a post that isn't theirs, that they can't see, or that
 * doesn't exist. If the photo store can't remove the file the photo is still
 * taken out of every read (marked deleted); deleting the account asks the
 * store again.
 */
export async function deletePost(db: Db, authorId: number, postId: unknown, { env = process.env, deleteFiles }: { env?: Env; deleteFiles?: DeleteOptions["deleteFiles"] } = {}): Promise<Result<null, "not_found">> {
  const post = await loadVisiblePost(db, authorId, postId, { env });
  if (!post || !post.mine) return err("not_found");
  const { rows } = await db.query(
    `WITH old AS (SELECT id, photo_id FROM social_posts WHERE id = $1 AND author_id = $2 AND state <> 'removed' FOR UPDATE)
     UPDATE social_posts p SET state = 'removed', photo_id = NULL FROM old WHERE p.id = old.id RETURNING old.photo_id`,
    [post.id, authorId],
  );
  if (!rows[0]) return err("not_found");
  const photoId = rows[0].photo_id === null ? null : Number(rows[0].photo_id);
  if (photoId !== null) {
    try {
      await deleteSocialPhotos(db, authorId, deleteFiles ? { only: photoId, deleteFiles } : { only: photoId });
    } catch (e) {
      // The file is still in the store. The row stays, marked deleted, so nothing shows it and no post can take it.
      await db.query(`UPDATE player_photos SET deleted_at = now() WHERE id = $1 AND player_id = $2 AND purpose = 'social' AND deleted_at IS NULL`, [photoId, authorId]);
      console.error("[social] a deleted post's photo file could not be removed:", (e as Error)?.name ?? "error");
    }
  }
  return ok(null);
}

// Reporting a post: through the same gate as reading it. The evidence copy is
// its words and its photo's address as they are now.
registerReportTarget("post", async (db, reporterId, id) => {
  const post = await loadVisiblePost(db, reporterId, id);
  if (!post) return null;
  const photo = post.photoId === null ? null : (await db.query(`SELECT display_url FROM player_photos WHERE id = $1`, [post.photoId])).rows[0];
  return { targetId: post.id, authorId: post.authorId, clubId: post.clubId, content: { body: post.body, photoUrl: photo ? String(photo.display_url) : null } };
});
