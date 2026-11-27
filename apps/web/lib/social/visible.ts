// The one gate for "may this person see that profile?".
//
// Everything that takes a profile's public id from a person (viewing it,
// following, blocking, reporting) loads it through here first, so a profile
// the viewer can't see answers exactly like one that doesn't exist.
//
// A profile is out of sight when:
// - the id is malformed or nobody has it;
// - its account is deleted;
// - either person has blocked the other;
// - its person is suspended from Social (their own view of it is the only
//   exception; whether they may use Social at all is socialAccess's call);
// - its person has no club left with Social on (they left, or the club
//   switched it off): the row stays, the person disappears;
// - it is a `club` profile and the viewer shares no social club with it.
//
// - a club counts, for either person, only when its own switch is on AND
//   this deployment lets it have Social (the pilot list, lib/juniors/
//   switch-rule.ts). A viewer with no such club sees nobody, and a person
//   whose only clubs aren't pilot clubs is out of sight.
//
// This is the ONLY place that decides it: looking at a profile, following,
// blocking and reporting all ask here, so they can't disagree about who
// exists.
//
// Not decided here: whether the VIEWER is suspended (lib/social/access.ts
// checks that first), and a club's ban of the viewer (the feed, posting and
// following check it).
//
// The cross-club questions go through the database's social_clubs_of
// (migration 0022), so this works under TENANT_SCOPE=enforce.
import type { SocialVisibility } from "@luvallplay/core/social";
import { notBlockedSql } from "../moderation/blocks.ts";
import { notSuspendedSql } from "../moderation/suspensions.ts";
import { pilotScope, type Env } from "../juniors/switch-rule.ts";
import { isPublicId } from "./public-id.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/**
 * A profile as the libraries pass it around. `playerId` is for joins and
 * checks inside the server; what is sent to a person carries `publicId` and
 * `displayName` only.
 */
export type VisibleProfile = {
  playerId: number;
  publicId: string;
  displayName: string;
  bio: string | null;
  visibility: SocialVisibility;
  joinedAt: string;
  /** It is the viewer's own. */
  mine: boolean;
  /** The clubs the viewer and this person both have Social in, lowest id first. For the viewer's own: their clubs. */
  sharedClubIds: number[];
};

/**
 * The query parameter that says which clubs this deployment lets have
 * Social: null for every club, or the pilot clubs' ids (an empty list: none).
 */
export function socialClubsParam(env: Env = process.env): number[] | null {
  const scope = pilotScope("social", env);
  return scope === "all" ? null : scope;
}

const PARAM = /^\$[1-9][0-9]*$/;

/**
 * The condition, on a `social_profiles sp` row joined to its live account,
 * that the viewer in `viewerParam` ("$1") may see it. `clubsParam` ("$3") is
 * the parameter holding socialClubsParam(). One piece of SQL, so a caller
 * that needs the answer inside its own statement (blocking) asks the same
 * question as loadVisibleProfile.
 */
export function profileVisibleSql(viewerParam: string, clubsParam: string): string {
  if (!PARAM.test(viewerParam) || !PARAM.test(clubsParam)) throw new Error(`profileVisibleSql: "${viewerParam}" and "${clubsParam}" must be parameters like $1.`);
  const allowed = (column: string) => `(${clubsParam}::int[] IS NULL OR ${column} = ANY(${clubsParam}::int[]))`;
  return `(EXISTS (SELECT 1 FROM social_clubs_of(sp.player_id) AS tc(c) WHERE ${allowed("tc.c")})
       AND EXISTS (SELECT 1 FROM social_clubs_of(${viewerParam}) AS vc(c) WHERE ${allowed("vc.c")})
       AND (sp.player_id = ${viewerParam} OR (
             ${notBlockedSql(viewerParam, "sp.player_id")}
         AND ${notSuspendedSql("sp.player_id", "social")}
         AND (sp.visibility = 'everyone' OR EXISTS (
               SELECT 1 FROM social_clubs_of(${viewerParam}) AS vc(c) JOIN social_clubs_of(sp.player_id) AS tc(c) USING (c) WHERE ${allowed("c")})))))`;
}

/** The profile with this public id, if `viewerId` may see it; otherwise null, whatever the reason. */
export async function loadVisibleProfile(db: Db, viewerId: number, publicId: unknown, env: Env = process.env): Promise<VisibleProfile | null> {
  if (!Number.isInteger(viewerId) || !isPublicId(publicId)) return null;
  const { rows } = await db.query(
    `SELECT sp.player_id, sp.public_id, sp.display_name, sp.bio, sp.visibility, sp.created_at,
            ARRAY(SELECT c::int FROM social_clubs_of($1) AS vc(c) JOIN social_clubs_of(sp.player_id) AS tc(c) USING (c)
                  WHERE ($3::int[] IS NULL OR c = ANY($3::int[])) ORDER BY 1) AS shared
     FROM social_profiles sp
     JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
     WHERE sp.public_id = $2 AND ${profileVisibleSql("$1", "$3")}`,
    [viewerId, publicId, socialClubsParam(env)],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    playerId: Number(r.player_id),
    publicId: String(r.public_id),
    displayName: String(r.display_name),
    bio: r.bio === null ? null : String(r.bio),
    visibility: r.visibility === "everyone" ? "everyone" : "club",
    joinedAt: new Date(r.created_at as string | Date).toISOString(),
    mine: Number(r.player_id) === viewerId,
    sharedClubIds: (Array.isArray(r.shared) ? r.shared : []).map(Number),
  };
}
