// Clubs.
import { z } from "zod";

export const clubRoleSchema = z.enum(["owner", "admin", "coach", "member", "guest"]);

/** A club the signed-in person belongs to. */
export const clubSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  role: clubRoleSchema,
  /** The club's own switch for this person: a disabled member sees the club but can't use it. */
  status: z.enum(["active", "disabled"]),
  region: z.string(),
  /** Where this club's API lives (its region's base URL, ending in /api/v1/app). */
  apiBase: z.string(),
  /** The web admin can be opened by this person (the "Club admin" button). */
  canOpenAdmin: z.boolean(),
});
export const clubsResponse = z.object({ clubs: z.array(clubSummarySchema) });

/** The semantic tokens of packages/ui, by name. Values are CSS colours or font stacks. */
export const themeTokensSchema = z.object({
  primary: z.string(),
  "on-primary": z.string(),
  accent: z.string(),
  "on-accent": z.string(),
  surface: z.string(),
  "surface-raised": z.string(),
  ink: z.string(),
  "ink-muted": z.string(),
  line: z.string(),
  "control-border": z.string(),
  focus: z.string(),
  danger: z.string(),
  "font-display": z.string(),
  "font-text": z.string(),
  /** Optional: when missing, the app derives them from the tokens above. */
  "primary-strong": z.string().optional(),
  "on-primary-strong": z.string().optional(),
  "surface-sunken": z.string().optional(),
  success: z.string().optional(),
});
export type ThemeTokens = z.infer<typeof themeTokensSchema>;

export const clubThemeSchema = z.object({
  /** A ready-made colour scheme id, or null for an imported brand. */
  scheme: z.string().nullable(),
  /** Rank art and other club artwork: "luvallplay" (the default set) or the club's own set id. */
  artSet: z.string(),
  logoUrl: z.string().nullable(),
  light: themeTokensSchema,
  dark: themeTokensSchema,
  /** Files for the club's own font families, on its website (absolute addresses). */
  fonts: z.array(z.object({ family: z.string(), src: z.string(), weight: z.number().int(), style: z.enum(["normal", "italic"]) })).optional(),
});

const termsSchema = z.object({
  pointsName: z.string(),
  visionName: z.string(),
  alphaName: z.string(),
  silverName: z.string(),
  /** Optional: what the club calls a player, players and a pair. */
  playerName: z.string().optional(),
  playersName: z.string().optional(),
  pairName: z.string().optional(),
});

/**
 * Everything the app needs to dress itself as a club and to know what the
 * club has switched on. Public: an invite link applies the club's look
 * before anyone signs in, so nothing here is private.
 */
export const clubConfigResponse = z.object({
  club: z.object({
    slug: z.string(),
    name: z.string(),
    country: z.string(),
    region: z.string(),
    timezone: z.string(),
    /** ISO 4217. Amounts are integer minor units. */
    currency: z.string(),
    /** Decimal places of the currency (NZD 2, VND 0). */
    currencyExponent: z.number().int(),
    languages: z.array(z.string()),
    paymentMode: z.enum(["free", "offline", "online"]),
    sports: z.array(z.string()),
    /** The club's website, for what the app doesn't do yet (opened in the browser). Null when it has none. */
    webUrl: z.string().nullable().optional(),
    /** The card provider's public key for this club's payments (Stripe publishable key), when it takes cards. */
    stripeKey: z.string().nullable().optional(),
  }),
  apiBase: z.string(),
  /** Ids of the modules that are on. Screens of a module that isn't listed disappear. */
  modules: z.array(z.string()),
  theme: clubThemeSchema,
  /** The club's own words, with a language's own wording where it differs. */
  terms: termsSchema.extend({ localized: z.record(termsSchema.partial()) }),
  settings: z.object({
    playDays: z.object({
      bookingWindowDays: z.number().int(),
      bookingCutoffHour: z.number().int(),
    }),
    memberships: z.object({
      days: z.array(z.string()),
    }),
    donations: z.object({ minAmount: z.number().int(), maxAmount: z.number().int() }),
  }),
});
export type ClubConfigResponse = z.infer<typeof clubConfigResponse>;

export const clubParams = z.object({
  club: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(63),
});
