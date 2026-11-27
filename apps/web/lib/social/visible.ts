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
// Not decided here: whether the VIEWER may use Social (lib/social/access.ts
// checks that first), and a club's ban of the viewer (the feed, posting and
// following check it).
//
// The cross-club questions go through the database's two functions
// (migration 0022), so this works under TENANT_SCOPE=enforce.
import type { SocialVisibility } from "@luvallplay/core/social";
import { notBlockedSql } from "../moderation/blocks.ts";
import { notSuspendedSql } from "../moderation/suspensions.ts";
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
};

/**
 * The condition, on a `social_profiles sp` row joined to its live account,
 * that the viewer in `viewerParam` ("$1") may see it. One piece of SQL, so a
 * caller that needs the answer inside its own statement (blocking) asks the
 * same question as loadVisibleProfile.
 */
export function profileVisibleSql(viewerParam: string): string {
  return `(EXISTS (SELECT 1 FROM social_clubs_of(sp.player_id))
       AND (sp.player_id = ${viewerParam} OR (
             ${notBlockedSql(viewerParam, "sp.player_id")}
         AND ${notSuspendedSql("sp.player_id", "social")}
         AND (sp.visibility = 'everyone' OR shares_social_club(${viewerParam}, sp.player_id)))))`;
}

/** The profile with this public id, if `viewerId` may see it; otherwise null, whatever the reason. */
export async function loadVisibleProfile(db: Db, viewerId: number, publicId: unknown): Promise<VisibleProfile | null> {
  if (!Number.isInteger(viewerId) || !isPublicId(publicId)) return null;
  const { rows } = await db.query(
    `SELECT sp.player_id, sp.public_id, sp.display_name, sp.bio, sp.visibility, sp.created_at
     FROM social_profiles sp
     JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
     WHERE sp.public_id = $2 AND ${profileVisibleSql("$1")}`,
    [viewerId, publicId],
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
  };
}
