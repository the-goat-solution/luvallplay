// One person blocks another (shared by Social and the Marketplace).
//
// A block works both ways: neither sees the other's profile, posts or
// comments, and neither can follow the other. Blocking removes any follow
// between the two, in the same statement as the block.
//
// People are named here by their PUBLIC id (social_profiles.public_id), never
// by account id, and a list of blocked people shows display names. A block
// can only be put on someone the blocker can see, or who has interacted with
// them (follows them, or commented on or gave kudos to one of their posts).
// Anyone else answers `not_found`, exactly as an id nobody has: blocking
// can't be used to find out whether a hidden profile exists.
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { err, ok, type Result } from "./result.ts";
import { isPublicId } from "../social/public-id.ts";
import { profileVisibleSql } from "../social/visible.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export type BlockedPerson = { publicId: string; displayName: string; blockedAt: string };

/**
 * A feed query's condition that the row's author and the viewer haven't
 * blocked each other. `viewerParam` is a query parameter ("$1") and
 * `authorColumn` a column ("p.author_id"); anything else throws, so text
 * from a request can never reach the SQL through here.
 */
export function notBlockedSql(viewerParam: string, authorColumn: string): string {
  if (!/^\$[1-9][0-9]*$/.test(viewerParam)) throw new Error(`notBlockedSql: "${viewerParam}" is not a parameter like $1.`);
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(authorColumn)) throw new Error(`notBlockedSql: "${authorColumn}" is not a column.`);
  return `NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = ${viewerParam} AND ub.blocked_id = ${authorColumn}) OR (ub.blocker_id = ${authorColumn} AND ub.blocked_id = ${viewerParam}))`;
}

/** Whether either of the two has blocked the other. The same answer whichever way round they are given. */
export async function blockedEitherWay(db: Db, a: number, b: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`,
    [a, b],
  );
  return rows.length > 0;
}

/**
 * The account behind a public id that `blockerId` may block: someone they
 * already blocked (so a repeat is the same answer), someone whose profile
 * they can see, or someone who interacted with them. Never themselves, never
 * a deleted account. Null for everyone else. One statement, so two blocks of
 * the same person at once both see the same state.
 */
async function blockable(db: Db, blockerId: number, publicId: string): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT sp.player_id
     FROM social_profiles sp
     JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
     WHERE sp.public_id = $2 AND sp.player_id <> $1
       AND (EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = sp.player_id)
         OR EXISTS (SELECT 1 FROM social_follows f WHERE f.follower_id = sp.player_id AND f.followee_id = $1)
         OR EXISTS (SELECT 1 FROM social_comments c JOIN social_posts po ON po.id = c.post_id WHERE c.author_id = sp.player_id AND po.author_id = $1)
         OR EXISTS (SELECT 1 FROM social_kudos k JOIN social_posts po ON po.id = k.post_id WHERE k.player_id = sp.player_id AND po.author_id = $1)
         OR ${profileVisibleSql("$1")})`,
    [blockerId, publicId],
  );
  return rows[0] ? Number(rows[0].player_id) : null;
}

/**
 * Blocks the person with this public id and removes any follow between the
 * two. Doing it again changes nothing and answers the same. `not_found` for
 * an id nobody has, a person the blocker can't see and who never interacted
 * with them, the blocker themselves, and a blocker that isn't an account.
 */
export async function block(db: Db, blockerId: number, publicId: unknown): Promise<Result<null, "not_found">> {
  if (!Number.isInteger(blockerId) || !isPublicId(publicId)) return err("not_found");
  const blockedId = await blockable(db, blockerId, publicId);
  if (blockedId === null) return err("not_found");
  try {
    // One statement, so the block and the two follows going are one change.
    await db.query(
      `WITH blocked AS (
         INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT (blocker_id, blocked_id) DO NOTHING
       )
       DELETE FROM social_follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)`,
      [blockerId, blockedId],
    );
  } catch (e) {
    // An account that isn't there (or went between the two statements): the same answer as any other missing person.
    if ((e as { code?: string }).code === "23503") return err("not_found");
    throw e;
  }
  return ok(null);
}

/**
 * Lifts the blocker's own block of the person with this public id. Always
 * the same answer, whether or not there was one: it says nothing about who
 * exists. The other person's block of the blocker, if any, stays. It only
 * needs the person's profile row, not that the blocker can still see it: a
 * suspended or out-of-sight person can be unblocked.
 */
export async function unblock(db: Db, blockerId: number, publicId: unknown): Promise<Result<null, never>> {
  if (Number.isInteger(blockerId) && isPublicId(publicId)) {
    await db.query(
      `DELETE FROM user_blocks b USING social_profiles sp WHERE b.blocker_id = $1 AND b.blocked_id = sp.player_id AND sp.public_id = $2`,
      [blockerId, publicId],
    );
  }
  return ok(null);
}

/**
 * The people this person has blocked, newest first, by display name and
 * public id (so each can be unblocked). A suspended or out-of-sight person is
 * still listed; a deleted account is not. (Deleting an account removes its
 * profile and its blocks both ways: lib/social/data-rights.ts, Task 6.)
 */
export async function listBlocked(db: Db, playerId: number): Promise<BlockedPerson[]> {
  const { rows } = await db.query(
    `SELECT sp.public_id, sp.display_name, b.created_at
     FROM user_blocks b
     JOIN social_profiles sp ON sp.player_id = b.blocked_id
     JOIN players p ON p.id = b.blocked_id AND p.deleted_at IS NULL
     WHERE b.blocker_id = $1 ORDER BY b.created_at DESC, sp.public_id LIMIT 500`,
    [playerId],
  );
  return rows.map((r) => ({ publicId: String(r.public_id), displayName: String(r.display_name), blockedAt: new Date(r.created_at as string | Date).toISOString() }));
}
