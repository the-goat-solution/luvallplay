// Following (Social plan, Task 3). One person follows another to see their
// posts; an `everyone` author's posts reach followers in other clubs.
//
// - People are named by their PUBLIC id. Someone the follower can't see
//   answers `not_found`, exactly as an id nobody has.
// - Nobody follows across a block. The follow is written by a statement that
//   refuses when either has blocked the other, and checked once more after
//   it is written, so a block made at the same moment wins. (Every read also
//   leaves blocked people out, whatever the follows table says.)
// - A person a club has banned can't follow a member through that club: when
//   they are banned in every club the two share, the answer is `not_found`.
//   With no club in common (an `everyone` profile seen from another club)
//   there is no ban to apply.
// - Unfollowing always answers the same, whether or not there was a follow.
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { err, ok, type Result } from "../moderation/result.ts";
import { notSuspendedSql } from "../moderation/suspensions.ts";
import type { Env } from "../juniors/switch-rule.ts";
import { loadProfileFor } from "./access.ts";
import { isPublicId } from "./public-id.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const BLOCKED = `EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = $1 AND ub.blocked_id = $2) OR (ub.blocker_id = $2 AND ub.blocked_id = $1))`;

/**
 * `followerId` follows the person with this public id. Doing it again
 * changes nothing and answers the same. `self` for their own id;
 * `not_joined` when the follower has no social profile; `not_found` for
 * everyone they can't see, a block either way, and a ban in every shared club.
 */
export async function follow(db: Db, followerId: number, publicId: unknown, { env = process.env }: { env?: Env } = {}): Promise<Result<null, "not_found" | "self" | "not_joined">> {
  const target = await loadProfileFor(db, followerId, publicId, env);
  if (!target) return err("not_found");
  if (target.mine) return err("self");
  if (target.sharedClubIds.length > 0) {
    const { rows } = await db.query(`SELECT club_id FROM social_club_bans WHERE player_id = $1 AND club_id = ANY($2::int[])`, [followerId, target.sharedClubIds]);
    if (rows.length >= target.sharedClubIds.length) return err("not_found");
  }
  const { rows } = await db.query(
    `WITH me AS (SELECT 1 FROM social_profiles WHERE player_id = $1),
          added AS (
            INSERT INTO social_follows (follower_id, followee_id)
            SELECT $1::int, $2::int WHERE EXISTS (SELECT 1 FROM me) AND NOT ${BLOCKED}
            ON CONFLICT (follower_id, followee_id) DO NOTHING
          )
     SELECT EXISTS (SELECT 1 FROM me) AS joined, ${BLOCKED} AS blocked`,
    [followerId, target.playerId],
  );
  if (rows[0]?.blocked === true) return err("not_found");
  if (rows[0]?.joined !== true) return err("not_joined");
  // A block written while that statement ran didn't see the new follow, and the statement didn't see the block: look again.
  const undone = await db.query(`DELETE FROM social_follows WHERE follower_id = $1 AND followee_id = $2 AND ${BLOCKED} RETURNING 1`, [followerId, target.playerId]);
  return undone.rows.length > 0 ? err("not_found") : ok(null);
}

/** Stops following the person with this public id. Always the same answer: it says nothing about who exists. */
export async function unfollow(db: Db, followerId: number, publicId: unknown): Promise<Result<null, never>> {
  if (Number.isInteger(followerId) && isPublicId(publicId)) {
    await db.query(
      `DELETE FROM social_follows f USING social_profiles sp WHERE f.follower_id = $1 AND f.followee_id = sp.player_id AND sp.public_id = $2`,
      [followerId, publicId],
    );
  }
  return ok(null);
}

/**
 * How many people follow this account and how many it follows. Only people
 * who still have a profile, a live account and no suspension are counted, so
 * the numbers match what a list would show.
 */
export async function followCounts(db: Db, playerId: number): Promise<{ followers: number; following: number }> {
  const counted = (side: "follower_id" | "followee_id") =>
    `EXISTS (SELECT 1 FROM social_profiles sp JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL WHERE sp.player_id = f.${side}) AND ${notSuspendedSql(`f.${side}`, "social")}`;
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM social_follows f WHERE f.followee_id = $1 AND ${counted("follower_id")}) AS followers,
            (SELECT count(*)::int FROM social_follows f WHERE f.follower_id = $1 AND ${counted("followee_id")}) AS following`,
    [playerId],
  );
  return { followers: Number(rows[0]?.followers ?? 0), following: Number(rows[0]?.following ?? 0) };
}
