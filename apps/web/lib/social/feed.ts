// The feed (Social plan, Task 4): posts by people the viewer follows, posts
// in the viewer's clubs with Social on, and the viewer's own.
//
// - Who sees what is postVisibleSql (lib/social/posts.ts), the same rule as
//   every by-id read; nothing here decides visibility again.
// - Pages are keyset pages on (created_at, id), newest first. The cursor
//   carries the last row's time to the microsecond, as text, so a post that
//   arrives between two pages, or several posts written at the same instant,
//   never make a page repeat or skip a row.
// - A post's photo is joined again on every read (postPhotoJoinSql): one an
//   admin has since hidden or deleted drops out, and the post stays.
// - Counts are over what this viewer could read (lib/social/comments.ts).
// - A person is shown by display name and public id, never by account id.
// - A match post reads its match from the Arena's own row each time (nothing
//   is copied into the post). Its partner and opponents are named only when
//   the VIEWER could see that person's profile (the profile gate,
//   lib/social/visible.ts, asked once for the whole page); anyone else is
//   null, and the card says "a pair from {club}".
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import type { PostKind } from "@luvallplay/core/social";
import { err, ok, type Result } from "../moderation/result.ts";
import type { Env } from "../juniors/switch-rule.ts";
import { socialAccess } from "./access.ts";
import { commentVisibleSql, kudosCountedSql } from "./comments.ts";
import { postPhotoJoinSql } from "./photos.ts";
import { MATCH_REF, postVisibleSql, type Db } from "./posts.ts";
import { loadVisibleProfile, profileVisibleSql, socialClubsParam } from "./visible.ts";

/** Where the next page starts: the last row's time (to the microsecond, UTC) and id. */
export type FeedCursor = { before: string; beforeId: number };

export type FeedMatch = {
  /** The author's partner, by display name. Null: not someone this viewer can see. */
  partner: string | null;
  /** The other pair, each by display name or null. */
  opponents: (string | null)[];
  /** The author's side first ("21-17"). Null when the game was decided without a score (a pair retired). */
  score: string | null;
  /** The author's side won. */
  won: boolean;
};

export type FeedPost = {
  id: number;
  kind: PostKind;
  /** `held` and `hidden` only ever on the viewer's own. */
  state: "visible" | "held" | "hidden";
  author: { publicId: string; displayName: string; avatarUrl: string | null };
  club: { slug: string; name: string };
  body: string | null;
  match?: FeedMatch;
  /** A rank-up post: the rank's place on the ladder (LADDER in @luvallplay/core/ranks). */
  rankIndex?: number;
  photoUrl?: string;
  photoWidth?: number | null;
  photoHeight?: number | null;
  kudos: number;
  kudosByMe: boolean;
  comments: number;
  createdAt: string;
  mine: boolean;
};

export type FeedPage = { posts: FeedPost[]; next: FeedCursor | null };

export const FEED_PAGE = 20;
export const FEED_PAGE_MAX = 50;

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const EMPTY: FeedPage = { posts: [], next: null };

function validCursor(c: unknown): c is FeedCursor {
  const v = c as Partial<FeedCursor> | null;
  return !!v && typeof v.before === "string" && STAMP.test(v.before) && !Number.isNaN(Date.parse(v.before)) && typeof v.beforeId === "number" && Number.isSafeInteger(v.beforeId) && v.beforeId >= 1;
}

const pageSize = (limit: unknown) => (typeof limit === "number" && Number.isInteger(limit) && limit >= 1 ? Math.min(limit, FEED_PAGE_MAX) : FEED_PAGE);

/** The names, among these accounts, that the viewer may see (the profile gate, asked once). */
async function visibleNames(db: Db, viewerId: number, playerIds: number[], env: Env): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (playerIds.length === 0) return names;
  const { rows } = await db.query(
    `SELECT sp.player_id, sp.display_name
     FROM social_profiles sp
     JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
     WHERE sp.player_id = ANY($2::int[]) AND ${profileVisibleSql("$1", "$3")}`,
    [viewerId, playerIds, socialClubsParam(env)],
  );
  for (const r of rows) names.set(Number(r.player_id), String(r.display_name));
  return names;
}

type Side = "posting" | "accepting";
type MatchRow = { id: number; posting: number[]; accepting: number[]; scorePosting: number | null; scoreAccepting: number | null; retiredBy: Side | null };

/** The matches behind a page's match posts, by challenge id. */
async function matches(db: Db, ids: number[]): Promise<Map<number, MatchRow>> {
  const out = new Map<number, MatchRow>();
  if (ids.length === 0) return out;
  const { rows } = await db.query(
    `SELECT id, p1, p2, a1, a2, score_posting, score_accepting, retired_by FROM arena_challenges WHERE id = ANY($1::int[]) AND status = 'completed'`,
    [ids],
  );
  const people = (...v: unknown[]) => v.filter((x) => x !== null && x !== undefined).map(Number);
  for (const r of rows) {
    out.set(Number(r.id), {
      id: Number(r.id),
      posting: people(r.p1, r.p2),
      accepting: people(r.a1, r.a2),
      scorePosting: r.score_posting === null ? null : Number(r.score_posting),
      scoreAccepting: r.score_accepting === null ? null : Number(r.score_accepting),
      retiredBy: r.retired_by === "posting" || r.retired_by === "accepting" ? r.retired_by : null,
    });
  }
  return out;
}

function matchOf(m: MatchRow, side: Side, authorId: number, names: Map<number, string>): FeedMatch {
  const mine = side === "posting" ? m.posting : m.accepting;
  const theirs = side === "posting" ? m.accepting : m.posting;
  const [own, other] = side === "posting" ? [m.scorePosting, m.scoreAccepting] : [m.scoreAccepting, m.scorePosting];
  const scored = m.retiredBy === null && own !== null && other !== null;
  const partner = mine.find((id) => id !== authorId);
  return {
    partner: partner === undefined ? null : (names.get(partner) ?? null),
    opponents: theirs.map((id) => names.get(id) ?? null),
    score: scored ? `${own}-${other}` : null,
    won: m.retiredBy !== null ? m.retiredBy !== side : scored && own! > other!,
  };
}

/**
 * One page of posts. `source` is the extra condition that picks the list
 * (the feed, or one author's posts); it may use $1 (the viewer), $2 (the
 * viewer's clubs) and $6 (its own argument).
 */
async function page(db: Db, viewerId: number, clubIds: number[], env: Env, source: string, sourceArg: unknown, cursor: FeedCursor | null, limit: number): Promise<FeedPage> {
  const { rows } = await db.query(
    `SELECT p.id, p.kind, p.state, p.body, p.ref_key, p.author_id, p.created_at,
            to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stamp,
            sp.public_id, sp.display_name, t.slug, t.name,
            ph.display_url AS photo_url, ph.width AS photo_width, ph.height AS photo_height,
            (SELECT count(*)::int FROM social_kudos k WHERE k.post_id = p.id AND ${kudosCountedSql("$1")}) AS kudos,
            EXISTS (SELECT 1 FROM social_kudos k WHERE k.post_id = p.id AND k.player_id = $1) AS kudos_by_me,
            (SELECT count(*)::int FROM social_comments c WHERE c.post_id = p.id AND ${commentVisibleSql("$1")}) AS comments
     FROM social_posts p
     JOIN players a ON a.id = p.author_id AND a.deleted_at IS NULL
     JOIN social_profiles sp ON sp.player_id = p.author_id
     JOIN tenants t ON t.id = p.club_id
     ${postPhotoJoinSql("p", "ph")}
     WHERE ${source}
       AND ${cursor ? `(p.created_at, p.id) < ($4::timestamptz, $5::bigint)` : `($4::timestamptz IS NULL AND $5::bigint IS NULL)`}
       AND ${postVisibleSql("$1", "$2", "$3")}
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT ${limit + 1}`,
    [viewerId, clubIds, socialClubsParam(env), cursor?.before ?? null, cursor?.beforeId ?? null, sourceArg],
  );
  const shown = rows.slice(0, limit);

  // The matches and the names of everyone in them, each asked once for the page.
  const refs = new Map<number, { challengeId: number; side: Side }>();
  for (const r of shown) {
    const m = r.kind === "match" ? MATCH_REF.exec(String(r.ref_key)) : null;
    if (m) refs.set(Number(r.id), { challengeId: Number(m[1]), side: m[2] as Side });
  }
  const played = await matches(db, [...new Set([...refs.values()].map((x) => x.challengeId))]);
  const names = await visibleNames(db, viewerId, [...new Set([...played.values()].flatMap((m) => [...m.posting, ...m.accepting]))], env);

  const posts: FeedPost[] = [];
  for (const r of shown) {
    const id = Number(r.id);
    const authorId = Number(r.author_id);
    const post: FeedPost = {
      id,
      kind: r.kind as PostKind,
      state: r.state as FeedPost["state"],
      author: { publicId: String(r.public_id), displayName: String(r.display_name), avatarUrl: null },
      club: { slug: String(r.slug), name: String(r.name) },
      body: r.body === null ? null : String(r.body),
      kudos: Number(r.kudos),
      kudosByMe: r.kudos_by_me === true,
      comments: Number(r.comments),
      createdAt: new Date(r.created_at as string | Date).toISOString(),
      mine: authorId === viewerId,
    };
    if (r.kind === "match") {
      const ref = refs.get(id);
      const m = ref ? played.get(ref.challengeId) : undefined;
      // The match changed between the two reads: the post is not shown this time.
      if (!ref || !m) continue;
      post.match = matchOf(m, ref.side, authorId, names);
    }
    if (r.kind === "rank_up") {
      const rank = /^rank:(\d{1,3})$/.exec(String(r.ref_key));
      if (rank) post.rankIndex = Number(rank[1]);
    }
    if (r.photo_url !== null) {
      post.photoUrl = String(r.photo_url);
      post.photoWidth = r.photo_width === null ? null : Number(r.photo_width);
      post.photoHeight = r.photo_height === null ? null : Number(r.photo_height);
    }
    posts.push(post);
  }
  const last = shown[shown.length - 1];
  return { posts, next: rows.length > limit && last ? { before: String(last.stamp), beforeId: Number(last.id) } : null };
}

/**
 * The viewer's feed, newest first. Pass the previous page's `next` as
 * `cursor` for the page after it; `next` is null on the last page. Someone
 * who may not use Social, and a cursor that isn't one, get an empty page.
 */
export async function feed(db: Db, viewerId: number, cursor?: FeedCursor | null, limit: number = FEED_PAGE, { env = process.env }: { env?: Env } = {}): Promise<FeedPage> {
  if (cursor !== undefined && cursor !== null && !validCursor(cursor)) return EMPTY;
  const access = await socialAccess(db, viewerId, env);
  if (!access.ok) return EMPTY;
  return page(
    db,
    viewerId,
    access.clubIds,
    env,
    `($6::int IS NULL AND (p.club_id = ANY($2::int[]) OR p.author_id = $1 OR p.author_id IN (SELECT f.followee_id FROM social_follows f WHERE f.follower_id = $1)))`,
    null,
    cursor ?? null,
    pageSize(limit),
  );
}

/**
 * One person's posts, for their profile: the same rule and the same shape as
 * the feed. `not_found` for a profile the viewer can't see, exactly as for a
 * public id nobody has.
 */
export async function profilePosts(db: Db, viewerId: number, publicId: unknown, cursor?: FeedCursor | null, limit: number = FEED_PAGE, { env = process.env }: { env?: Env } = {}): Promise<Result<FeedPage, "not_found">> {
  const access = await socialAccess(db, viewerId, env);
  if (!access.ok) return err("not_found");
  const profile = await loadVisibleProfile(db, viewerId, publicId, env);
  if (!profile) return err("not_found");
  if (cursor !== undefined && cursor !== null && !validCursor(cursor)) return ok(EMPTY);
  return ok(await page(db, viewerId, access.clubIds, env, `p.author_id = $6::int`, profile.playerId, cursor ?? null, pageSize(limit)));
}
