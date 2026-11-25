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
    /** The club's website, for what the app doesn't do yet (opened in the browser). Null when it has none. */
    webUrl: z.string().nullable().optional(),
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

// ── Me (the home tab) ──────────────────────────────────────────────────────
// Dates are the club's calendar days (YYYY-MM-DD, in the club's time zone);
// times are ISO instants. Money is integer minor units of the club's
// currency (clubs.config gives the currency and its exponent).

/** A play day as this person sees it. */
export const playDaySchema = z.object({
  date: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  location: z.string().nullable(),
  /** Casual spots left. */
  spots: z.number().int(),
  /** The club closed bookings for the day. */
  closed: z.boolean(),
  /** The club paused this weekday. */
  paused: z.boolean(),
  /** Inside the booking window and before the day's cut-off. */
  bookable: z.boolean(),
  /** Covered by the person's membership. */
  included: z.boolean(),
  /** The person said they can't make it (membership days). */
  absent: z.boolean(),
  /** The person booked a casual spot. */
  booked: z.boolean(),
});
export type PlayDay = z.infer<typeof playDaySchema>;

export const membershipSchema = z.object({
  plan: z.enum(["monthly", "quarterly"]),
  /** The weekday it gives access to ("friday"). */
  day: z.string(),
  status: z.enum(["active", "ending", "upcoming", "past_due"]),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  autoRenews: z.boolean(),
  /** How it was paid: "card", "cash", "bank_transfer". */
  method: z.string(),
  /** Play days left in this cycle. */
  daysLeft: z.number().int(),
  /** A paid follow-on membership that starts after this one. */
  next: z.object({ plan: z.enum(["monthly", "quarterly"]), periodStart: z.string().nullable(), periodEnd: z.string().nullable() }).nullable(),
});

export const threadSummarySchema = z.object({
  id: z.number().int(),
  subject: z.string(),
  preview: z.string(),
  unread: z.boolean(),
  lastMessageAt: z.string(),
});

export const meResponse = z.object({
  player: z.object({
    firstName: z.string(),
    lastName: z.string(),
    displayName: z.string(),
    initials: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  /** Null when the person has no membership, or the club has Memberships off. */
  membership: membershipSchema.nullable(),
  /** The prices to join, when the club sells memberships and the person has none. */
  join: z.object({ monthly: z.number().int(), quarterly: z.number().int(), days: z.array(z.string()) }).nullable(),
  /** One casual spot. */
  casualPrice: z.number().int(),
  stats: z.object({
    /** Play days in a row, not counting days they said they couldn't make. */
    streak: z.number().int(),
    /** Their place on this month's attendance board, or null. */
    monthRank: z.number().int().nullable(),
  }),
  /** The next five weeks of play days. */
  calendar: z.array(playDaySchema),
  inbox: z.object({
    unread: z.number().int(),
    /** The three latest conversations. */
    latest: z.array(threadSummarySchema),
  }),
  /** Show the welcome card (a new account that hasn't dismissed it). */
  welcome: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponse>;

/** A real calendar day as YYYY-MM-DD (not just the shape: 2026-02-30 is refused). */
export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "not a calendar date");

export const absenceRequest = z.object({
  date: dateKeySchema,
  absent: z.boolean(),
});
export const emptyRequest = z.object({});

// ── Messages (the inbox: conversations with the club's admins) ────────────

export const threadParams = clubParams.extend({
  id: z.coerce.number().int().positive().max(2_147_483_647),
});

export const threadListItemSchema = threadSummarySchema.extend({
  status: z.enum(["open", "closed"]),
  /** Who wrote last: "player" (them) or "admin" (the club). */
  lastSender: z.enum(["player", "admin"]),
});
export const threadsResponse = z.object({ threads: z.array(threadListItemSchema) });

export const messageSchema = z.object({
  id: z.number().int(),
  sender: z.enum(["player", "admin"]),
  body: z.string(),
  createdAt: z.string(),
});
/** Reading a conversation marks it read. */
export const threadResponse = z.object({
  thread: z.object({
    id: z.number().int(),
    subject: z.string(),
    status: z.enum(["open", "closed"]),
    messages: z.array(messageSchema),
  }),
});

export const newThreadRequest = z.object({
  subject: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
});
export const newThreadResponse = z.object({ ok: z.literal(true), id: z.number().int() });

export const replyRequest = z.object({ body: z.string().trim().min(1).max(4000) });
export const replyResponse = z.object({ ok: z.literal(true), message: messageSchema });

// ── The account: details, language, photo, privacy, data ──────────────────
// The same for every club. The phone number isn't changed here (changing it
// drops its confirmation, which signing in by text relies on).

export const profileResponse = z.object({
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  /** What others see (leaderboard, photo credits). */
  displayName: z.string(),
  /** The person chose their own display name (else it follows their name). */
  customDisplayName: z.boolean(),
  /** The display name they get when they leave theirs empty. */
  defaultDisplayName: z.string(),
  lang: langSchema,
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  avatarUrl: z.string().nullable(),
  leaderboardVisible: z.boolean(),
});

export const detailsRequest = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60),
  /** Empty or null: follow their name. */
  displayName: z.string().trim().max(40).nullish(),
});

export const languageRequest = z.object({ lang: langSchema });

export const privacyRequest = z.object({ leaderboardVisible: z.boolean() });

/** A square picture the app has already cut and shrunk (512 px), as a data URL. At most 2 MB of image. */
export const photoRequest = z.object({
  image: z.string().max(2_900_000).regex(/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+=*$/),
});
export const photoResponse = z.object({ ok: z.literal(true), url: z.string().nullable() });

/** Everything the club holds under this account (NZ Privacy Act 2020), as the website's "Download my data". */
export const exportResponse = z.record(z.unknown());

/** "Club admin": a single-use link (about a minute) that opens the club's admin already signed in. */
export const adminHandoffResponse = z.object({
  url: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
});

/** Deleting the account: the person types DELETE, as on the website. */
export const deleteAccountRequest = z.object({ confirm: z.literal("DELETE") });

// ── Connected apps: personal access keys and webhooks (the website's) ─────
/** What an access key may do. Kept equal to apps/web/lib/webhooks.ts SCOPES (a test checks). */
export const API_SCOPES = ["read:stats", "read:attendance", "read:calendar", "write:activity"] as const;
/** What a webhook sends. Kept equal to apps/web/lib/webhooks.ts EVENTS (a test checks). */
export const WEBHOOK_EVENTS = ["attendance.recorded", "round_robin.result", "membership.changed", "photo.approved"] as const;
const apiScope = z.enum(API_SCOPES);
const webhookEvent = z.enum(WEBHOOK_EVENTS);
const isoTime = z.string();

export const apiTokenSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  scopes: z.array(apiScope),
  /** The first characters, to tell keys apart; the key itself is shown once. */
  prefix: z.string(),
  createdAt: isoTime,
  lastUsedAt: isoTime.nullable(),
});
export const webhookSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  events: z.array(webhookEvent),
  active: z.boolean(),
  createdAt: isoTime,
  lastStatus: z.string().nullable(),
});
export const integrationsResponse = z.object({
  tokens: z.array(apiTokenSchema),
  webhooks: z.array(webhookSchema),
});
export const newTokenRequest = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(apiScope).min(1),
});
export const newTokenResponse = z.object({ token: z.string(), record: apiTokenSchema });
export const newWebhookRequest = z.object({
  url: z.string().trim().url().max(500),
  events: z.array(webhookEvent).min(1).optional(),
});
export const newWebhookResponse = z.object({ secret: z.string(), endpoint: webhookSchema });
export const integrationParams = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
