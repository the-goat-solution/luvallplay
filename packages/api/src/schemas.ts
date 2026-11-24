// The shapes the players' app API sends and accepts (build plan §4.1,
// test plan §3.7). One source for the server (validation at the edge), the
// client (types) and the contract snapshot (backward compatibility).
//
// Rules for changing these while the version stays the same:
// - adding an optional request field or a response field is fine;
// - removing or renaming a field, changing its type, or making a request
//   field required is a breaking change: it needs a new API version.
// The snapshot test (apps/web/tests/api-contract.test.ts) enforces this.
import { z } from "zod";

export const langSchema = z.enum(["en", "vi"]);

/** Every error answer: a stable code the app switches on, and sometimes a sentence for logs. */
export const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof errorSchema>;

// ── Sign-in ────────────────────────────────────────────────────────────────
// Optional fields are .nullish(): clients send null for empty state (see
// apps/web/lib/auth-schemas.ts for the bug that taught us this).

export const emailStartRequest = z.object({
  email: z.string().trim().email().max(200),
  lang: langSchema.nullish(),
  turnstileToken: z.string().max(4000).nullish(),
});
export const okResponse = z.object({ ok: z.literal(true) });

export const emailVerifyRequest = z.object({
  email: z.string().trim().email().max(200),
  code: z.string().trim().min(6).max(12),
  phoneProof: z.string().max(400).nullish(),
});

/** A new session. `token` is shown once: the app keeps it and sends it as `Authorization: Bearer`. */
export const sessionCreatedResponse = z.object({
  ok: z.literal(true),
  token: z.string(),
  /** ISO time the session ends if it is never used again (it slides while in use). */
  expiresAt: z.string(),
  /** The account has no name yet: ask for one before anything else. */
  needsDetails: z.boolean(),
  /** The phone number from a text-message sign-in already belongs to another account. */
  phoneTaken: z.boolean(),
});

export const smsStartRequest = z.object({
  phone: z.string().trim().min(6).max(30),
  recaptchaToken: z.string().min(10).max(4000),
  purpose: z.enum(["login", "phone_confirm"]).nullish(),
});
export const smsStartResponse = z.object({
  ok: z.literal(true),
  sessionInfo: z.string(),
  phone: z.string(),
});

export const smsVerifyRequest = z.object({
  sessionInfo: z.string().min(10).max(4000),
  code: z.string().trim().min(6).max(12),
  purpose: z.enum(["login", "phone_confirm"]).nullish(),
});
/**
 * One of three outcomes:
 * - signed in: `token`, `expiresAt`, `needsDetails`;
 * - a number with no account yet: `needsEmail` and a `phoneProof` to send with the email code;
 * - `purpose: "phone_confirm"`: just `ok`.
 */
export const smsVerifyResponse = z.object({
  ok: z.literal(true),
  token: z.string().optional(),
  expiresAt: z.string().optional(),
  needsDetails: z.boolean().optional(),
  needsEmail: z.boolean().optional(),
  phoneProof: z.string().optional(),
});

export const logoutRequest = z.object({
  /** Sign out every device, not only this one. */
  all: z.boolean().nullish(),
});

export const playerSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string(),
  lang: langSchema,
  avatarUrl: z.string().nullable(),
  phoneVerified: z.boolean(),
});
export const sessionResponse = z.object({
  player: playerSchema,
  /** ISO time this session signed in (admin step-up counts from here). */
  signedInAt: z.string(),
});

// ── Clubs ──────────────────────────────────────────────────────────────────

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
});

const termsSchema = z.object({
  pointsName: z.string(),
  visionName: z.string(),
  alphaName: z.string(),
  silverName: z.string(),
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
