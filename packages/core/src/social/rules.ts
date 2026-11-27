// Limits and the shapes Social's tables use. Pure: no I/O.

/** The most characters each piece of text may have. */
export const SOCIAL_LIMITS = { displayName: 40, bio: 160, post: 500, comment: 300, reportDetails: 1000 } as const;

/** The community rules a person accepted. A new version asks everyone again. */
export const COMMUNITY_RULES_VERSION = "2026-12";

/** `held` waits for a moderator; `hidden` was taken down by one; `removed` is gone for good. */
export const POST_STATES = ["visible", "held", "hidden", "removed"] as const;
export type PostState = (typeof POST_STATES)[number];

export const POST_KINDS = ["match", "rank_up", "photo", "text"] as const;
export type PostKind = (typeof POST_KINDS)[number];

/** Who an author lets see their posts: their clubs only, or their followers too. */
export const SOCIAL_VISIBILITIES = ["club", "everyone"] as const;
export type SocialVisibility = (typeof SOCIAL_VISIBILITIES)[number];

export type CleanText = { ok: true; text: string } | { ok: false; code: "required" | "too_long" };

/** Control characters, and the overrides that make text read in the other direction. */
const UNSAFE = /[\p{Cc}‪-‮⁦-⁩]/gu;
/** White space and zero-width characters at either end. */
const EDGES = /^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu;
/** Left when nothing a reader can see is: white space, zero-width characters, marks, fillers that draw as blank. */
const UNSEEN = /[\s\p{Cf}\p{M}ᅟᅠ⠀ㅤﾠ]/gu;

/**
 * Text as it is saved: trimmed, runs of white space (new lines too) made one
 * space, letters composed (NFC). Control characters (a NUL would be refused
 * by the database) and direction overrides are dropped; so are zero-width
 * characters at either end. `max` counts characters, not bytes or UTF-16
 * units, so 40 Vietnamese letters fit a 40 limit however they were typed.
 * It counts code points: an emoji joined from several counts each part.
 * Nothing typed, nothing a reader could see, or something that isn't text
 * is `required`.
 */
export function cleanText(raw: unknown, max: number): CleanText {
  if (typeof raw !== "string") return { ok: false, code: "required" };
  const text = raw
    .normalize("NFC")
    .replace(/[\s\u0085]+/g, " ")
    .replace(UNSAFE, "")
    .replace(/ {2,}/g, " ")
    .replace(EDGES, "");
  if (text.replace(UNSEEN, "") === "") return { ok: false, code: "required" };
  if ([...text].length > max) return { ok: false, code: "too_long" };
  return { ok: true, text };
}
