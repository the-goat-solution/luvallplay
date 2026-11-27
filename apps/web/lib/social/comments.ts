// Comments and kudos on a post (Social plan, Task 4).
//
// Every call here asks loadVisiblePost first (lib/social/posts.ts): a post
// the person can't see, and a comment on one, answer `not_found`, exactly as
// an id nobody has (Review Focus 6).
//
// Which comments a viewer sees on a post they can see (commentVisibleSql):
// - their own, unless removed (a held one waits for a moderator, a hidden
//   one was taken down; `state` says which);
// - anyone else's `visible` comment, unless: the commenter's account is
//   deleted or has no profile; the commenter is suspended; the viewer and the
//   commenter have blocked each other, either way; the post's author and the
//   commenter have (so a blocked person's old comments leave the blocker's
//   posts for everyone, Review Focus 1); the post's club has banned the
//   commenter.
// The comment count on a post is the count of exactly those rows, so it never
// tells a viewer about a comment they can't read. Kudos are counted the same
// way: not from a deleted, suspended or blocked (either way) person.
//
// Writing: a comment or kudos needs a `visible` post (not the author's own
// held or hidden one) and a person the post's club hasn't banned. The text is
// cleaned and screened as a post's is: `reject` refuses, `hold` saves it
// `held`. At most COMMENTS_PER_DAY in 24 hours, behind the person's lock.
// Only the person who wrote a comment can delete it here (a moderator's
// removal is the moderation pages' job).
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { SOCIAL_LIMITS, cleanText, screenText } from "@luvallplay/core/social";
import { notBlockedSql } from "../moderation/blocks.ts";
import { registerReportTarget } from "../moderation/reports.ts";
import { err, ok, type Result } from "../moderation/result.ts";
import { notSuspendedSql } from "../moderation/suspensions.ts";
import type { Env } from "../juniors/switch-rule.ts";
import { withPlayerLock } from "../player-lock.ts";
import { socialAccess } from "./access.ts";
import { bannedInClub, isRowId, loadVisiblePost, type Db, type LockDb, type VisiblePost } from "./posts.ts";

/** Comments a person may write in 24 hours. */
export const COMMENTS_PER_DAY = 100;
/** The most comments one read of a post gives, oldest first. */
export const COMMENTS_SHOWN = 200;

const PARAM = /^\$[1-9][0-9]*$/;

/**
 * The condition that the viewer in `viewerParam` may see comment `c` on post
 * `p` (which they can already see). Both tables must be in the query under
 * those names.
 */
export function commentVisibleSql(viewerParam: string): string {
  if (!PARAM.test(viewerParam)) throw new Error(`commentVisibleSql: "${viewerParam}" is not a parameter like $1.`);
  return `(c.state <> 'removed'
     AND EXISTS (SELECT 1 FROM social_profiles csp JOIN players cp ON cp.id = csp.player_id AND cp.deleted_at IS NULL WHERE csp.player_id = c.author_id)
     AND (c.author_id = ${viewerParam} OR (
           c.state = 'visible'
       AND ${notBlockedSql(viewerParam, "c.author_id")}
       AND NOT EXISTS (SELECT 1 FROM user_blocks pb WHERE (pb.blocker_id = p.author_id AND pb.blocked_id = c.author_id) OR (pb.blocker_id = c.author_id AND pb.blocked_id = p.author_id))
       AND ${notSuspendedSql("c.author_id", "social")}
       AND NOT EXISTS (SELECT 1 FROM social_club_bans ccb WHERE ccb.club_id = p.club_id AND ccb.player_id = c.author_id))))`;
}

/** The condition that kudos row `k` counts for the viewer in `viewerParam`. */
export function kudosCountedSql(viewerParam: string): string {
  if (!PARAM.test(viewerParam)) throw new Error(`kudosCountedSql: "${viewerParam}" is not a parameter like $1.`);
  return `(EXISTS (SELECT 1 FROM players kp WHERE kp.id = k.player_id AND kp.deleted_at IS NULL)
     AND (k.player_id = ${viewerParam} OR (${notBlockedSql(viewerParam, "k.player_id")} AND ${notSuspendedSql("k.player_id", "social")})))`;
}

/** A comment as it is sent to a person: its author by display name and public id only. */
export type Comment = {
  id: number;
  author: { publicId: string; displayName: string; avatarUrl: string | null };
  body: string;
  /** `held` and `hidden` only ever on the viewer's own. */
  state: "visible" | "held" | "hidden";
  createdAt: string;
  mine: boolean;
};

const COMMENT_COLUMNS = `c.id, c.body, c.state, c.created_at, c.author_id, csp.public_id, csp.display_name`;

function comment(r: Record<string, unknown>, viewerId: number): Comment {
  return {
    id: Number(r.id),
    author: { publicId: String(r.public_id), displayName: String(r.display_name), avatarUrl: null },
    body: String(r.body),
    state: r.state as Comment["state"],
    createdAt: new Date(r.created_at as string | Date).toISOString(),
    mine: Number(r.author_id) === viewerId,
  };
}

/** The comments on a post the viewer may read, oldest first (at most COMMENTS_SHOWN). */
export async function listComments(db: Db, viewerId: number, postId: unknown, { env = process.env }: { env?: Env } = {}): Promise<Result<Comment[], "not_found">> {
  const post = await loadVisiblePost(db, viewerId, postId, { env });
  if (!post) return err("not_found");
  const { rows } = await db.query(
    `SELECT ${COMMENT_COLUMNS}
     FROM social_comments c
     JOIN social_posts p ON p.id = c.post_id
     JOIN social_profiles csp ON csp.player_id = c.author_id
     WHERE c.post_id = $2 AND ${commentVisibleSql("$1")}
     ORDER BY c.created_at, c.id LIMIT ${COMMENTS_SHOWN}`,
    [viewerId, post.id],
  );
  return ok(rows.map((r) => comment(r, viewerId)));
}

/** The caller may write on this post: it is there for them, shown to others, and its club hasn't banned them. */
async function writablePost(db: Db, playerId: number, postId: unknown, env: Env): Promise<VisiblePost | null> {
  const post = await loadVisiblePost(db, playerId, postId, { env });
  if (!post || post.state !== "visible" || (await bannedInClub(db, playerId, post.clubId))) return null;
  return post;
}

/**
 * Writes a comment. The words are checked first (`required`, `too_long`,
 * `not_allowed`), which says nothing about the post; then the post
 * (`not_found`). A `held` answer means only its author sees it for now.
 * `db` must be able to give a connection (the daily cap's lock).
 */
export async function addComment(
  db: LockDb,
  authorId: number,
  postId: unknown,
  body: unknown,
  { env = process.env }: { env?: Env } = {},
): Promise<Result<Comment, "not_found" | "not_joined" | "required" | "too_long" | "not_allowed" | "rate_limited">> {
  const access = await socialAccess(db, authorId, env);
  if (!access.ok) return err("not_found");
  if (!access.profile) return err("not_joined");
  const cleaned = cleanText(body, SOCIAL_LIMITS.comment);
  if (!cleaned.ok) return err(cleaned.code);
  const screened = screenText(cleaned.text);
  if (screened === "reject") return err("not_allowed");
  const post = await writablePost(db, authorId, postId, env);
  if (!post) return err("not_found");
  const state = screened === "hold" ? "held" : "visible";
  const profile = access.profile;
  try {
    return await withPlayerLock(db, authorId, "social.comments", async (tx) => {
      const today = await tx.query(`SELECT count(*)::int AS n FROM social_comments WHERE author_id = $1 AND created_at > now() - interval '24 hours'`, [authorId]);
      if (Number(today.rows[0]?.n ?? 0) >= COMMENTS_PER_DAY) return err("rate_limited");
      const { rows } = await tx.query(`INSERT INTO social_comments (post_id, author_id, body, state) VALUES ($1, $2, $3, $4) RETURNING id, created_at`, [post.id, authorId, cleaned.text, state]);
      return ok({
        id: Number(rows[0].id),
        author: { publicId: profile.publicId, displayName: profile.displayName, avatarUrl: null },
        body: cleaned.text,
        state,
        createdAt: new Date(rows[0].created_at as string | Date).toISOString(),
        mine: true,
      } as Comment);
    });
  } catch (e) {
    // The post was deleted for good between the look and the insert.
    if ((e as { code?: string }).code === "23503") return err("not_found");
    throw e;
  }
}

/**
 * The person deletes their own comment: it becomes `removed`. `not_found`
 * for anyone else's, one on a post they can't see, and an id nobody has.
 */
export async function deleteComment(db: Db, playerId: number, commentId: unknown, { env = process.env }: { env?: Env } = {}): Promise<Result<null, "not_found">> {
  if (!isRowId(commentId)) return err("not_found");
  const own = (await db.query(`SELECT post_id FROM social_comments WHERE id = $1 AND author_id = $2 AND state <> 'removed'`, [commentId, playerId])).rows[0];
  if (!own) return err("not_found");
  const post = await loadVisiblePost(db, playerId, Number(own.post_id), { env });
  if (!post) return err("not_found");
  const { rows } = await db.query(`UPDATE social_comments SET state = 'removed' WHERE id = $1 AND author_id = $2 AND state <> 'removed' RETURNING id`, [commentId, playerId]);
  return rows[0] ? ok(null) : err("not_found");
}

/**
 * Gives (`on`) or takes back the person's kudos on a post. Doing it twice
 * changes nothing and answers the same. The answer is the post's count as
 * this person sees it.
 */
export async function setKudos(
  db: Db,
  playerId: number,
  postId: unknown,
  on: boolean,
  { env = process.env }: { env?: Env } = {},
): Promise<Result<{ kudos: number; kudosByMe: boolean }, "not_found" | "not_joined">> {
  const access = await socialAccess(db, playerId, env);
  if (!access.ok) return err("not_found");
  if (!access.profile) return err("not_joined");
  const post = await writablePost(db, playerId, postId, env);
  if (!post) return err("not_found");
  try {
    if (on === true) await db.query(`INSERT INTO social_kudos (post_id, player_id) VALUES ($1, $2) ON CONFLICT (post_id, player_id) DO NOTHING`, [post.id, playerId]);
    else await db.query(`DELETE FROM social_kudos WHERE post_id = $1 AND player_id = $2`, [post.id, playerId]);
  } catch (e) {
    if ((e as { code?: string }).code === "23503") return err("not_found");
    throw e;
  }
  const { rows } = await db.query(
    `SELECT count(*)::int AS n, coalesce(bool_or(k.player_id = $1), false) AS mine FROM social_kudos k WHERE k.post_id = $2 AND ${kudosCountedSql("$1")}`,
    [playerId, post.id],
  );
  return ok({ kudos: Number(rows[0]?.n ?? 0), kudosByMe: rows[0]?.mine === true });
}

// Reporting a comment: the reporter must be able to read it, on a post they
// can see. The report is filed in the post's club.
registerReportTarget("comment", async (db, reporterId, id) => {
  if (!isRowId(id)) return null;
  const found = (await db.query(`SELECT post_id FROM social_comments WHERE id = $1`, [id])).rows[0];
  if (!found) return null;
  const post = await loadVisiblePost(db, reporterId, Number(found.post_id));
  if (!post) return null;
  const { rows } = await db.query(
    `SELECT c.id, c.author_id, c.body FROM social_comments c JOIN social_posts p ON p.id = c.post_id WHERE c.id = $2 AND ${commentVisibleSql("$1")}`,
    [reporterId, id],
  );
  const r = rows[0];
  if (!r) return null;
  return { targetId: Number(r.id), authorId: Number(r.author_id), clubId: post.clubId, content: { body: String(r.body) } };
});
