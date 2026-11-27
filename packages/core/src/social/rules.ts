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

/**
 * Text as it is saved: trimmed, runs of white space (new lines too) made one
 * space, letters composed (NFC). `max` counts characters as a person counts
 * them, not bytes or UTF-16 units, so 40 Vietnamese letters fit a 40 limit
 * however they were typed. Nothing typed, only invisible characters, or
 * something that isn't text is `required`.
 */
export function cleanText(raw: unknown, max: number): CleanText {
  if (typeof raw !== "string") return { ok: false, code: "required" };
  const text = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  // Zero-width characters alone would save a post nobody can see.
  if (!/[^\s\p{Cf}]/u.test(text)) return { ok: false, code: "required" };
  if ([...text].length > max) return { ok: false, code: "too_long" };
  return { ok: true, text };
}
