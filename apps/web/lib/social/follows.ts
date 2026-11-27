// Following (Social plan, Task 3). One person follows another to see their
// posts; an `everyone` author's posts reach followers in other clubs.
//
// - People are named by their PUBLIC id. Someone the follower can't see
//   answers `not_found`, exactly as an id nobody has.
// - Nobody follows across a block. A follow and a block of the same two
//   people take the same lock (lib/moderation/blocks.ts, withPairLock), so
//   one waits for the other to commit: a follow written first is removed by
//   the block, and a follow that comes second sees the block and refuses.
// - The follower must be allowed to use Social themselves (socialAccess);
//   otherwise the answer is `not_found`, as for anyone they can't see.
// - A person a club has banned can't follow a member through that club: when
//   they are banned in every club the two share, the answer is `not_found`.
//   With no club in common (an `everyone` profile seen from another club)
//   there is no ban to apply.
// - Unfollowing always answers the same, whether or not there was a follow.
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { withPairLock, type PairDb } from "../moderation/blocks.ts";
import { err, ok, type Result } from "../moderation/result.ts";
import { notSuspendedSql } from "../moderation/suspensions.ts";
import type { Env } from "../juniors/switch-rule.ts";
import { socialAccess } from "./access.ts";
import { isPublicId } from "./public-id.ts";
import { loadVisibleProfile, socialClubsParam } from "./visible.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const BLOCKED = `EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = $1 AND ub.blocked_id = $2) OR (ub.blocker_id = $2 AND ub.blocked_id = $1))`;

/**
 * `followerId` follows the person with this public id. Doing it again
 * changes nothing and answers the same. `self` for their own id;
 * `not_joined` when the follower has no social profile; `not_found` for
 * everyone they can't see, a block either way, a ban in every shared club,
 * and a follower who may not use Social. `db` must be able to give a
 * connection (`connect()`): the write runs in a short transaction behind the
 * pair's lock. Not to be called inside withPlayerLock (locks don't nest).
 */
export async function follow(db: PairDb, followerId: number, publicId: unknown, { env = process.env }: { env?: Env } = {}): Promise<Result<null, "not_found" | "self" | "not_joined">> {
  if (!(await socialAccess(db, followerId, env)).ok) return err("not_found");
  const target = await loadVisibleProfile(db, followerId, publicId, env);
  if (!target) return err("not_found");
  if (target.mine) return err("self");
  if (target.sharedClubIds.length > 0) {
    const { rows } = await db.query(`SELECT club_id FROM social_club_bans WHERE player_id = $1 AND club_id = ANY($2::int[])`, [followerId, target.sharedClubIds]);
    if (rows.length >= target.sharedClubIds.length) return err("not_found");
  }
  // Behind the pair's lock, so a block of the same two has either committed (and is seen here) or waits for this.
  const row = await withPairLock(db, followerId, target.playerId, async (tx) => {
    const { rows } = await tx.query(
      `WITH me AS (SELECT 1 FROM social_profiles WHERE player_id = $1),
            added AS (
              INSERT INTO social_follows (follower_id, followee_id)
              SELECT $1::int, $2::int WHERE EXISTS (SELECT 1 FROM me) AND NOT ${BLOCKED}
              ON CONFLICT (follower_id, followee_id) DO NOTHING
            )
       SELECT EXISTS (SELECT 1 FROM me) AS joined, ${BLOCKED} AS blocked`,
      [followerId, target.playerId],
    );
    return rows[0];
  });
  if (row?.blocked === true) return err("not_found");
  if (row?.joined !== true) return err("not_joined");
  return ok(null);
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
 * How many people follow this account and how many it follows. Counted are
 * the people a list would show: still with a profile and a live account, not
 * suspended, with a club that has Social, and not blocked either way by the
 * account the count is about.
 */
export async function followCounts(db: Db, playerId: number, { env = process.env }: { env?: Env } = {}): Promise<{ followers: number; following: number }> {
  const counted = (other: "follower_id" | "followee_id") =>
    `EXISTS (SELECT 1 FROM social_profiles sp JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL WHERE sp.player_id = f.${other})
     AND ${notSuspendedSql(`f.${other}`, "social")}
     AND EXISTS (SELECT 1 FROM social_clubs_of(f.${other}) AS oc(c) WHERE ($2::int[] IS NULL OR oc.c = ANY($2::int[])))
     AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = f.follower_id AND ub.blocked_id = f.followee_id) OR (ub.blocker_id = f.followee_id AND ub.blocked_id = f.follower_id))`;
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM social_follows f WHERE f.followee_id = $1 AND ${counted("follower_id")}) AS followers,
            (SELECT count(*)::int FROM social_follows f WHERE f.follower_id = $1 AND ${counted("followee_id")}) AS following`,
    [playerId, socialClubsParam(env)],
  );
  return { followers: Number(rows[0]?.followers ?? 0), following: Number(rows[0]?.following ?? 0) };
}
