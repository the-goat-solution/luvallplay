// Who sees a post. Pure: the caller looks the facts up, this decides.
// The feed's SQL (Task 4) must agree with it; by-id reads call it directly.
import type { PostState, SocialVisibility } from "./rules.ts";

export type CanSeePostInput = {
  viewerId: number;
  authorId: number;
  authorSuspended: boolean;
  /** The author's account is deleted (or being deleted). */
  authorDeleted: boolean;
  /** The author's setting now, not when they posted. */
  authorVisibility: SocialVisibility;
  postState: PostState;
  blockedEitherWay: boolean;
  /** The viewer follows the author. */
  follows: boolean;
  /** The viewer is in the club the post was made in, and Social is on there. */
  sharesPostClub: boolean;
  /** The viewer is banned from Social in the club the post was made in. */
  bannedInPostClub: boolean;
};

/**
 * The rules, first match wins:
 * 1. A removed post, or a post of a deleted account, is seen by nobody.
 * 2. The author sees their own post in any other state (`held`, `hidden`),
 *    whatever else is true of them. A suspended author has no access to
 *    Social at all; that is checked before this, not here.
 * 3. Everyone else sees only `visible` posts, never across a block, never
 *    from a suspended author.
 * 4. A viewer banned in the post's club sees none of that club's posts, not
 *    even through a follow: the ban closes the club's space to them.
 * 5. A `club` author is seen only by people in the post's club. An
 *    `everyone` author is also seen by their followers. Anything that isn't
 *    `everyone` is read as `club`.
 */
export function canSeePost(input: CanSeePostInput): boolean {
  if (input.authorDeleted || input.postState === "removed") return false;
  if (input.viewerId === input.authorId) return true;
  if (input.postState !== "visible") return false;
  if (input.blockedEitherWay || input.authorSuspended) return false;
  if (input.bannedInPostClub) return false;
  if (input.sharesPostClub) return true;
  return input.authorVisibility === "everyone" && input.follows;
}
