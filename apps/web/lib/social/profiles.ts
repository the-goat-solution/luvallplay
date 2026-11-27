// Social profiles: opting in, changing your own, and reading someone's
// (Social plan, Task 3).
//
// - Opting in needs the person to say they are 18 or over (stored with the
//   time) and to accept the current community rules. Neither can be skipped.
// - A display name and a bio are cleaned (cleanText) and screened
//   (screenText). A profile has no "held" state for a moderator to release,
//   so text the screen would hold is refused like text it rejects:
//   `not_allowed`, and the person picks other words.
// - Other people see a display name, a bio and a public id. Never the first
//   or last name, the email, or the account's id.
// - Any profile the viewer can't see answers `not_found`, the same as an id
//   nobody has (lib/social/visible.ts lists the reasons).
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { COMMUNITY_RULES_VERSION, SOCIAL_LIMITS, SOCIAL_VISIBILITIES, cleanText, screenText, type SocialVisibility } from "@luvallplay/core/social";
import { err, ok, type Result } from "../moderation/result.ts";
import type { Env } from "../juniors/switch-rule.ts";
import { ownProfile, socialAccess, type SocialProfile } from "./access.ts";
import { followCounts } from "./follows.ts";
import { newPublicId } from "./public-id.ts";
import { loadVisibleProfile } from "./visible.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** A profile as another person sees it. `visibility` is told only to its owner. */
export type PublicProfile = {
  publicId: string;
  displayName: string;
  /** One or two letters from the display name, for the picture. */
  initials: string;
  bio: string | null;
  avatarUrl: string | null;
  joinedAt: string;
  followers: number;
  following: number;
  /** This is the viewer's own profile. */
  mine: boolean;
  /** The viewer follows this person. */
  followedByMe: boolean;
  visibility: SocialVisibility | null;
};

export type ProfileTextError = "name_required" | "name_too_long" | "bio_too_long" | "not_allowed" | "visibility_invalid";
export type JoinError = "module_off" | "suspended" | "adult_required" | "rules_outdated" | ProfileTextError;
export type UpdateError = "module_off" | "suspended" | "not_joined" | ProfileTextError;

type Options = { env?: Env; newId?: () => string };

function checkName(raw: unknown): Result<string, ProfileTextError> {
  const name = cleanText(raw, SOCIAL_LIMITS.displayName);
  if (!name.ok) return err(name.code === "too_long" ? "name_too_long" : "name_required");
  return screenText(name.text) === "ok" ? ok(name.text) : err("not_allowed");
}

/** A bio is optional: nothing typed (or only spaces) is no bio. */
function checkBio(raw: unknown): Result<string | null, ProfileTextError> {
  if (raw === undefined || raw === null) return ok(null);
  const bio = cleanText(raw, SOCIAL_LIMITS.bio);
  if (!bio.ok) return bio.code === "too_long" ? err("bio_too_long") : ok(null);
  return screenText(bio.text) === "ok" ? ok(bio.text) : err("not_allowed");
}

const isVisibility = (v: unknown): v is SocialVisibility => (SOCIAL_VISIBILITIES as readonly unknown[]).includes(v);

/** One or two capital letters from a display name ("Mia G" → "MG"). */
export function initialsOf(displayName: string): string {
  const words = displayName.split(" ").filter(Boolean);
  const first = [...(words[0] ?? "")][0] ?? "?";
  const second = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

/**
 * A display name to offer on the join screen: the first name and the last
 * name's first letter ("Mia G"). Empty when there is nothing usable, so the
 * person types their own. Only ever shown to the person themselves.
 */
export function suggestDisplayName(firstName: unknown, lastName: unknown): string {
  const first = cleanText(firstName, 200);
  if (!first.ok) return "";
  const last = cleanText(lastName, 200);
  const initial = last.ok ? [...last.text][0].toUpperCase() : "";
  const name = checkName(`${[...first.text].slice(0, SOCIAL_LIMITS.displayName - 2).join("")}${initial ? ` ${initial}` : ""}`);
  return name.ok ? name.value : "";
}

/**
 * Opts a person in to Social. Checked in this order: access (`module_off`,
 * `suspended`), the 18-or-over confirmation (`adult_required` unless it is
 * exactly `true`), the rules version (`rules_outdated` unless it is the
 * current one), then the text.
 *
 * Someone who already has a profile keeps it as it is: joining again only
 * records that they accepted the current rules, and answers with their
 * profile. So a repeated request is safe, and it is also how a person
 * accepts a new version of the rules.
 */
export async function joinSocial(
  db: Db,
  playerId: number,
  input: { displayName: unknown; bio?: unknown; visibility: unknown; adultConfirmed: unknown; rulesVersion: unknown },
  { env = process.env, newId = newPublicId }: Options = {},
): Promise<Result<SocialProfile, JoinError>> {
  const access = await socialAccess(db, playerId, env);
  if (!access.ok) return err(access.code);
  if (input?.adultConfirmed !== true) return err("adult_required");
  if (input.rulesVersion !== COMMUNITY_RULES_VERSION) return err("rules_outdated");
  const name = checkName(input.displayName);
  if (!name.ok) return name;
  const bio = checkBio(input.bio);
  if (!bio.ok) return bio;
  if (!isVisibility(input.visibility)) return err("visibility_invalid");
  // A public id is random; if it is somebody's already, draw again.
  for (let attempt = 0; ; attempt++) {
    try {
      const { rows } = await db.query(
        `INSERT INTO social_profiles (player_id, public_id, display_name, bio, visibility, adult_confirmed_at, rules_version)
         VALUES ($1, $2, $3, $4, $5, now(), $6)
         ON CONFLICT (player_id) DO UPDATE SET rules_version = EXCLUDED.rules_version, updated_at = now()
         RETURNING public_id, display_name, bio, visibility, created_at`,
        [playerId, newId(), name.value, bio.value, input.visibility, COMMUNITY_RULES_VERSION],
      );
      return ok(ownProfile(rows[0]));
    } catch (e) {
      const clash = (e as { code?: string; constraint?: string }).code === "23505" && (e as { constraint?: string }).constraint === "social_profiles_public_id_key";
      if (!clash || attempt >= 4) throw e;
    }
  }
}

/**
 * Changes the person's own profile. Only the fields given change; `bio:
 * null` (or blank) removes the bio. `not_joined` when they have no profile.
 */
export async function updateProfile(
  db: Db,
  playerId: number,
  patch: { displayName?: unknown; bio?: unknown; visibility?: unknown },
  { env = process.env }: Options = {},
): Promise<Result<SocialProfile, UpdateError>> {
  const access = await socialAccess(db, playerId, env);
  if (!access.ok) return err(access.code);
  if (!access.profile) return err("not_joined");
  const name = patch?.displayName === undefined ? null : checkName(patch.displayName);
  if (name && !name.ok) return name;
  const bio = patch?.bio === undefined ? null : checkBio(patch.bio);
  if (bio && !bio.ok) return bio;
  if (patch?.visibility !== undefined && !isVisibility(patch.visibility)) return err("visibility_invalid");
  const { rows } = await db.query(
    `UPDATE social_profiles SET
       display_name = COALESCE($2, display_name),
       bio = CASE WHEN $3 THEN $4 ELSE bio END,
       visibility = COALESCE($5, visibility),
       updated_at = now()
     WHERE player_id = $1
     RETURNING public_id, display_name, bio, visibility, created_at`,
    [playerId, name ? name.value : null, bio !== null, bio ? bio.value : null, patch?.visibility ?? null],
  );
  return rows[0] ? ok(ownProfile(rows[0])) : err("not_joined");
}

/**
 * The profile with this public id, as `viewerId` may see it. `not_found`
 * for an id nobody has and for every profile out of the viewer's sight:
 * blocked either way, suspended, deleted, a `club` profile with no shared
 * club, a person with no social club left. A viewer who may not use Social
 * themselves (no club with it, suspended, not an account) sees nobody, their
 * own profile included: socialAccess is what tells them why.
 */
export async function getProfile(db: Db, viewerId: number, publicId: unknown, { env = process.env }: Options = {}): Promise<Result<PublicProfile, "not_found">> {
  if (!(await socialAccess(db, viewerId, env)).ok) return err("not_found");
  const profile = await loadVisibleProfile(db, viewerId, publicId, env);
  if (!profile) return err("not_found");
  const [counts, mine] = await Promise.all([
    followCounts(db, profile.playerId, { env }),
    db.query(`SELECT 1 FROM social_follows WHERE follower_id = $1 AND followee_id = $2`, [viewerId, profile.playerId]),
  ]);
  return ok({
    publicId: profile.publicId,
    displayName: profile.displayName,
    initials: initialsOf(profile.displayName),
    bio: profile.bio,
    avatarUrl: null,
    joinedAt: profile.joinedAt,
    followers: counts.followers,
    following: counts.following,
    mine: profile.mine,
    followedByMe: mine.rows.length > 0,
    visibility: profile.mine ? profile.visibility : null,
  });
}
