// Who may use Social, and in which clubs (Social plan, Task 3).
//
// One question, asked before anything else Social does: socialAccess. A
// person has access when all of these hold:
// - they are a live account (not deleted; a junior profile is not an account
//   at all: it has no sign-in and lives in junior_profiles, so it can never
//   be asked about here or hold a social profile);
// - at least one of their clubs has Social on. A club has Social on when its
//   own switch says so (the tenant_modules row, read through the database's
//   social_clubs_of, which sees every club) AND this deployment lets that
//   club have it (lib/juniors/switch-rule.ts: the club is in
//   SOCIAL_PILOT_TENANTS; outside production SOCIAL_AVAILABILITY also opens
//   it). Nothing else opens it: there is no preview for an admin or for
//   Luvallplay staff;
// - no suspension from Social (or from everything) reaches them, by account
//   id, by their email, or by their verified phone. So someone suspended who
//   deleted their account and signed up again is still suspended.
//
// With no club the answer is `module_off`, whoever asks, and that is checked
// first: a suspended person in a club without Social learns nothing new.
// Their rows stay as they are; they are out of sight until a club has it on
// again (Review Focus 2).
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { COMMUNITY_RULES_VERSION, type SocialVisibility } from "@luvallplay/core/social";
import { activeSuspension } from "../moderation/suspensions.ts";
import { pilotModuleOn, type Env } from "../juniors/switch-rule.ts";
import { loadVisibleProfile, type VisibleProfile } from "./visible.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/**
 * A person's own social profile, as it is sent to them. No account id, no
 * real name: the public id is how the app names a profile. The picture is
 * initials only for now (players.avatar_url hasn't been through the image
 * check), so `avatarUrl` is always null.
 */
export type SocialProfile = {
  publicId: string;
  displayName: string;
  bio: string | null;
  visibility: SocialVisibility;
  avatarUrl: string | null;
  joinedAt: string;
};

export type SocialAccess =
  | {
      ok: true;
      /** The clubs where this person has Social, lowest id first. Never empty. */
      clubIds: number[];
      /** Null until they opt in. */
      profile: SocialProfile | null;
      /** Whether the rules they accepted are the current ones. False sends them back through the rules. */
      rulesCurrent: boolean;
    }
  | { ok: false; code: "module_off" | "suspended" };

/** A social_profiles row as the person's own profile. */
export function ownProfile(r: Record<string, unknown>): SocialProfile {
  return {
    publicId: String(r.public_id),
    displayName: String(r.display_name),
    bio: r.bio === null || r.bio === undefined ? null : String(r.bio),
    visibility: r.visibility === "everyone" ? "everyone" : "club",
    avatarUrl: null,
    joinedAt: new Date(r.created_at as string | Date).toISOString(),
  };
}

const allowed = (clubs: unknown, env: Env): number[] =>
  (Array.isArray(clubs) ? clubs : [])
    .map(Number)
    .filter((id) => pilotModuleOn("social", id, env))
    .sort((a, b) => a - b);

/** May this person use Social right now? See the top of the file for the rules. */
export async function socialAccess(db: Db, playerId: number, env: Env = process.env): Promise<SocialAccess> {
  if (!Number.isInteger(playerId)) return { ok: false, code: "module_off" };
  const { rows } = await db.query(
    `SELECT p.email, CASE WHEN p.phone_verified_at IS NOT NULL THEN p.phone_e164 END AS phone,
            ARRAY(SELECT c::int FROM social_clubs_of(p.id) AS c) AS clubs,
            sp.public_id, sp.display_name, sp.bio, sp.visibility, sp.created_at, sp.rules_version
     FROM players p LEFT JOIN social_profiles sp ON sp.player_id = p.id
     WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [playerId],
  );
  const r = rows[0];
  if (!r) return { ok: false, code: "module_off" };
  const clubIds = allowed(r.clubs, env);
  if (clubIds.length === 0) return { ok: false, code: "module_off" };
  const suspension = await activeSuspension(db, { playerId, email: r.email as string | null, phone: r.phone as string | null }, "social", env);
  if (suspension) return { ok: false, code: "suspended" };
  const profile = r.public_id ? ownProfile(r) : null;
  return { ok: true, clubIds, profile, rulesCurrent: profile !== null && r.rules_version === COMMUNITY_RULES_VERSION };
}

/**
 * The profile with this public id, if `viewerId` may see it, with the clubs
 * the two share. loadVisibleProfile decides by the clubs' own switches; this
 * also applies the deployment's switch, so a club that isn't in the pilot
 * list doesn't count for either person. Null for every reason alike.
 */
export async function loadProfileFor(
  db: Db,
  viewerId: number,
  publicId: unknown,
  env: Env = process.env,
): Promise<(VisibleProfile & { mine: boolean; sharedClubIds: number[] }) | null> {
  const profile = await loadVisibleProfile(db, viewerId, publicId);
  if (!profile) return null;
  const { rows } = await db.query(
    `SELECT ARRAY(SELECT c::int FROM social_clubs_of($1) AS c) AS viewer, ARRAY(SELECT c::int FROM social_clubs_of($2) AS c) AS theirs`,
    [viewerId, profile.playerId],
  );
  const viewer = allowed(rows[0]?.viewer, env);
  const theirs = allowed(rows[0]?.theirs, env);
  if (viewer.length === 0 || theirs.length === 0) return null;
  const mine = profile.playerId === viewerId;
  const sharedClubIds = theirs.filter((id) => viewer.includes(id));
  if (!mine && profile.visibility === "club" && sharedClubIds.length === 0) return null;
  return { ...profile, mine, sharedClubIds };
}
