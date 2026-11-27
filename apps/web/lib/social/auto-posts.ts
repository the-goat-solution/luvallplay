// Posts that write themselves (Social plan, Task 4): a confirmed Arena match
// and a rank-up.
//
// Both are called by the Arena AFTER its own response (lib/arena-db.ts), and
// neither ever throws into it: whatever goes wrong is caught and logged
// without anything about a person. Nothing is posted unless the person has a
// social profile, has accepted the current rules, may use Social, and has
// Social in the club the match or the rank belongs to (and isn't banned
// there). For everyone else these do nothing, which is every club today.
//
// A match:
// - the challenge is read again here, and only a `completed` one posts (a
//   dispute that raced the confirmation makes no post);
// - one post per SIDE (the Arena is doubles), written by the side's first
//   player who qualifies, with ref_key "challenge:<id>:<side>". The same
//   confirmation arriving twice makes one post per side (Review Focus 3):
//   the key is unique per author, and a side that already has a post, by
//   either player, gets no second one;
// - the post stores no score and no names. The feed reads the match from the
//   Arena's own row each time, and shows the post only while the match is
//   still `completed`: a match an admin voids later takes its posts with it.
//
// A rank-up: once per rank, ever (ref_key "rank:<ladder index>"), and only
// when the Arena says the rank improved.
//
// At most AUTO_POSTS_PER_DAY automatic posts per person in 24 hours, counted
// and written behind the person's lock; past that the post is simply not
// made.
//
// The Arena's preview copies ("pv_" tables) are not read: a preview's test
// games post nothing.
import { LADDER } from "@luvallplay/core/ranks";
import type { Env } from "../juniors/switch-rule.ts";
import { withPlayerLock } from "../player-lock.ts";
import { socialAccess } from "./access.ts";
import { bannedInClub, type LockDb } from "./posts.ts";

/** Automatic posts (matches and rank-ups together) one person may get in 24 hours. */
export const AUTO_POSTS_PER_DAY = 5;

const MAX_INT4 = 2_147_483_647;
const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= MAX_INT4;

/** Logs that an automatic post failed: which kind and the error's class and code, nothing about anyone. */
function failed(what: string, e: unknown): void {
  const code = (e as { code?: unknown } | null)?.code;
  console.error(`[social] ${what} post failed:`, e instanceof Error ? e.name : "error", typeof code === "string" ? code : "");
}

/** Whether this person gets automatic posts in this club right now. */
async function postsFor(db: LockDb, playerId: number, clubId: number, env: Env): Promise<boolean> {
  const access = await socialAccess(db, playerId, env);
  if (!access.ok || !access.profile || !access.rulesCurrent || !access.clubIds.includes(clubId)) return false;
  return !(await bannedInClub(db, playerId, clubId));
}

/** Writes one automatic post, inside the day's cap. Nothing happens when it is there already. */
async function write(db: LockDb, authorId: number, clubId: number, kind: "match" | "rank_up", refKey: string): Promise<void> {
  await withPlayerLock(db, authorId, "social.autoposts", async (tx) => {
    const today = await tx.query(`SELECT count(*)::int AS n FROM social_posts WHERE author_id = $1 AND kind IN ('match', 'rank_up') AND created_at > now() - interval '24 hours'`, [authorId]);
    if (Number(today.rows[0]?.n ?? 0) >= AUTO_POSTS_PER_DAY) return;
    // A match's key names the side: no second post for it, whoever wrote the first.
    await tx.query(
      `INSERT INTO social_posts (author_id, club_id, kind, ref_key)
       SELECT $1, $2, $3, $4 WHERE $3 <> 'match' OR NOT EXISTS (SELECT 1 FROM social_posts WHERE kind = 'match' AND ref_key = $4)
       ON CONFLICT (author_id, kind, ref_key) DO NOTHING`,
      [authorId, clubId, kind, refKey],
    );
  });
}

/**
 * A match was confirmed: each side gets its post. Safe to call any number of
 * times for the same challenge. Never throws.
 */
export async function postConfirmedMatch(db: LockDb, challengeId: number, { env = process.env }: { env?: Env } = {}): Promise<void> {
  try {
    if (!isId(challengeId)) return;
    const c = (await db.query(`SELECT tenant_id, p1, p2, a1, a2 FROM arena_challenges WHERE id = $1 AND status = 'completed'`, [challengeId])).rows[0];
    if (!c) return;
    const clubId = Number(c.tenant_id);
    for (const [side, players] of [["posting", [c.p1, c.p2]], ["accepting", [c.a1, c.a2]]] as const) {
      try {
        for (const p of players) {
          const playerId = Number(p);
          if (p === null || !isId(playerId) || !(await postsFor(db, playerId, clubId, env))) continue;
          await write(db, playerId, clubId, "match", `challenge:${challengeId}:${side}`);
          break;
        }
      } catch (e) {
        failed("match", e);
      }
    }
  } catch (e) {
    failed("match", e);
  }
}

/**
 * A player reached a new rank. `rank` is the rank's place on the ladder, as
 * text ("7"). The club is the one this connection's Arena rows belong to
 * unless given. Once per rank, ever. Never throws.
 */
export async function postRankUp(db: LockDb, playerId: number, rank: string, { env = process.env, clubId }: { env?: Env; clubId?: number } = {}): Promise<void> {
  try {
    if (!isId(playerId) || typeof rank !== "string" || !/^(0|[1-9][0-9]{0,2})$/.test(rank) || Number(rank) >= LADDER.length) return;
    // The same club the Arena's rows get by default (migration 0010).
    const club = clubId ?? Number((await db.query(`SELECT COALESCE(app_tenant_id(), 1) AS id`)).rows[0]?.id);
    if (!isId(club) || !(await postsFor(db, playerId, club, env))) return;
    await write(db, playerId, club, "rank_up", `rank:${rank}`);
  } catch (e) {
    failed("rank-up", e);
  }
}
