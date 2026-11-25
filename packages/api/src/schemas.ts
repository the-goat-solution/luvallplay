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

// ── The Arena (the website's /api/arena snapshot and actions) ─────────────
const seat = z.enum(["alpha", "silver"]);
export const playerChipSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  initials: z.string(),
  rank: z.number().int(),
  seat: seat.nullable(),
  tarnishing: z.boolean(),
});
export const pairViewSchema = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  players: z.tuple([playerChipSchema, playerChipSchema]),
  avgRank: z.number(),
});
export const CHALLENGE_STATUSES = ["open", "accepted", "live", "awaiting", "completed", "disputed", "void", "expired", "cancelled", "lapsed"] as const;
const side = z.enum(["posting", "accepting"]);
export const challengeViewSchema = z.object({
  id: z.number().int(),
  status: z.enum(CHALLENGE_STATUSES),
  posting: pairViewSchema,
  accepting: pairViewSchema.nullable(),
  note: z.string().nullable(),
  availableUntil: z.string(),
  postedAt: z.string(),
  acceptedAt: z.string().nullable(),
  checkedInAt: z.string().nullable(),
  scorePosting: z.number().int().nullable(),
  scoreAccepting: z.number().int().nullable(),
  retiredBy: side.nullable(),
  enteredByMySide: z.boolean().nullable(),
  mySide: side.nullable(),
  /** Why this viewer can't accept (a code), or null. */
  blocker: z.string().nullable(),
  h2h: z.object({ won: z.number().int(), lost: z.number().int() }).nullable(),
  offer: z.object({ giantKiller: z.boolean(), newRival: z.boolean(), crown: z.boolean() }).nullable(),
  crownMatch: z.boolean(),
  hasStats: z.boolean(),
  tracking: z.object({ rallies: z.number(), hits: z.number(), quality: z.number() }).nullable(),
});
export const feedItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("result"), id: z.number().int(), at: z.string(), winners: pairViewSchema, losers: pairViewSchema,
    scoreW: z.number().int().nullable(), scoreL: z.number().int().nullable(), retired: z.boolean(), stickers: z.array(z.string()), hasStats: z.boolean(),
  }),
  z.object({ kind: z.literal("rankup"), at: z.string(), player: playerChipSchema, rank: z.number().int() }),
]);
export const playerRankSchema = z.object({
  wpTotal: z.number(), wpPlayDays: z.number(), wpRoundRobin: z.number(), wpChallenges: z.number(), wpBonuses: z.number(),
  wp90: z.number(), wp60: z.number(), earned: z.number(), shown: z.number(),
  tarnishing: z.boolean(), daysToSlip: z.number().nullable(), progress: z.number(), seat: seat.nullable(),
});
export const afterGameSchema = z.object({
  challengeId: z.number().int(), won: z.boolean(), total: z.number(), base: z.number(),
  giantKiller: z.number(), newRival: z.number(), hotStreak: z.number(), crownBounty: z.number(),
  scoreFor: z.number().int().nullable(), scoreAgainst: z.number().int().nullable(), retired: z.boolean(),
  opponents: pairViewSchema, partner: playerChipSchema,
});
export const arenaMeSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  initials: z.string(),
  rank: playerRankSchema,
  rankUp: z.object({ from: z.number().int(), to: z.number().int() }).nullable(),
  pair: pairViewSchema.extend({ record: z.object({ won: z.number().int(), lost: z.number().int(), streak: z.number().int() }) }).nullable(),
  incomingRequest: playerChipSchema.nullable(),
  outgoingRequest: playerChipSchema.nullable(),
  /** Achievement key → when it was earned. */
  achievements: z.record(z.string()),
  after: z.array(afterGameSchema),
});
export const arenaStateSchema = z.object({
  now: z.string(),
  signedIn: z.boolean(),
  sandbox: z.boolean(),
  minGameMinutes: z.number(),
  me: arenaMeSchema.nullable(),
  counts: z.object({ up: z.number().int(), live: z.number().int(), week: z.number().int() }),
  crown: z.object({ pair: pairViewSchema, since: z.string(), defences: z.number().int() }).nullable(),
  packLeader: z.object({ player: playerChipSchema, games: z.number().int() }).nullable(),
  champion: z.object({ player: playerChipSchema, wp: z.number(), key: z.string() }).nullable(),
  hot: z.object({ player: playerChipSchema, streak: z.number().int() }).nullable(),
  live: z.array(challengeViewSchema),
  open: z.array(challengeViewSchema),
  mine: z.array(challengeViewSchema),
  feed: z.array(feedItemSchema),
});
const challengeId = z.number().int().positive().max(2147483647);
/** One Arena action, as the website's POST /api/arena. */
export const arenaActionRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pair_code") }),
  z.object({ action: z.literal("pair_enter"), code: z.string().max(12) }),
  z.object({ action: z.literal("pair_invite") }),
  z.object({ action: z.literal("pair_join"), code: z.string().max(20) }),
  z.object({ action: z.literal("checkin_now"), id: challengeId }),
  z.object({ action: z.literal("pair_respond"), accept: z.boolean() }),
  z.object({ action: z.literal("pair_cancel") }),
  z.object({ action: z.literal("pair_leave") }),
  z.object({ action: z.literal("pair_rename"), name: z.string().max(60) }),
  z.object({ action: z.literal("post"), days: z.number().int().min(0).max(7), note: z.string().max(200).default("") }),
  z.object({ action: z.literal("cancel"), id: challengeId }),
  z.object({ action: z.literal("accept"), id: challengeId }),
  z.object({ action: z.literal("call_off"), id: challengeId }),
  z.object({ action: z.literal("score"), id: challengeId, posting: z.number().int().min(0).max(30), accepting: z.number().int().min(0).max(30) }),
  z.object({ action: z.literal("retired"), id: challengeId, retiredBy: side }),
  z.object({ action: z.literal("confirm"), id: challengeId }),
  z.object({ action: z.literal("dispute"), id: challengeId, note: z.string().max(400).default("") }),
  z.object({ action: z.literal("after"), id: challengeId, keep: z.boolean(), again: z.boolean() }),
  z.object({ action: z.literal("rank_seen") }),
]);
export const arenaActionResponse = z.object({
  ok: z.literal(true),
  /** A pair code or invite to show, when the action made one. */
  code: z.object({ code: z.string(), expiresAt: z.string() }).nullable(),
  state: arenaStateSchema,
});

// ── The Leaderboard (the website's points board and player cards) ──────────
export const BOARD_SOURCES = ["all", "challenges", "play", "rr"] as const;
export const BOARD_PERIODS = ["month", "quarter", "year", "lifetime"] as const;
export const boardQuery = z.object({
  source: z.enum(BOARD_SOURCES).optional(),
  period: z.enum(BOARD_PERIODS).optional(),
  /** A past period ("2026-10", "2026-Q3", "2025"); the current one when left out. */
  key: z.string().max(20).optional(),
});
export const boardRowSchema = z.object({
  rank: z.number().int(),
  playerId: z.number().int(),
  name: z.string(),
  initials: z.string(),
  avatarUrl: z.string().nullable(),
  /** Points from the chosen source(s) in the period. */
  value: z.number(),
  play: z.number(),
  rr: z.number(),
  challenges: z.number(),
  /** Ladder position (from all-time points). */
  index: z.number().int(),
  seat: z.enum(["alpha", "silver"]).nullable(),
  tarnishing: z.boolean(),
});
export const boardResponse = z.object({
  source: z.enum(BOARD_SOURCES),
  period: z.enum(BOARD_PERIODS),
  range: z.object({ period: z.enum(BOARD_PERIODS), key: z.string(), start: z.string().nullable(), end: z.string().nullable() }),
  prevKey: z.string().nullable(),
  nextKey: z.string().nullable(),
  isCurrent: z.boolean(),
  /** Up to 200 rows; people who hide from the leaderboard are left out. */
  rows: z.array(boardRowSchema),
  me: z.object({
    id: z.number().int(),
    visible: z.boolean(),
    /** Your own rank when you hide from the board (only you see it). */
    hiddenRank: z.number().int().nullable(),
    ladder: z.object({ index: z.number().int(), wpTotal: z.number() }).nullable(),
  }),
});
export const playerParams = clubParams.extend({ id: z.coerce.number().int().positive().max(2147483647) });
export const playerCardResponse = z.object({
  card: z.object({
    id: z.number().int(),
    name: z.string(),
    initials: z.string(),
    avatarUrl: z.string().nullable(),
    rankIndex: z.number().int(),
    seat: z.enum(["alpha", "silver"]).nullable(),
    tarnishing: z.boolean(),
    wpTotal: z.number(),
    wp90: z.number(),
    /** Last five challenge results, newest first. */
    form: z.array(z.enum(["W", "L"])),
    isMe: z.boolean(),
    /** Their pair's open challenge: "Challenge" accepts it. */
    openChallengeId: z.number().int().nullable(),
    partner: z.boolean(),
  }),
});

// ── Player: your play stats (the website's Player tab) ─────────────────────
const byPeriod = <T extends z.ZodTypeAny>(v: T) => z.object({ month: v, quarter: v, year: v, lifetime: v });
export const playerStatsResponse = z.object({
  attended: byPeriod(z.number().int()),
  /** Your place on the play-days and round-robin boards per period (null: not ranked, or hidden). */
  ranks: byPeriod(z.object({ attendance: z.number().int().nullable(), rr: z.number().int().nullable() })),
  /** Weeks in a row with a play day. */
  streak: z.object({ current: z.number().int(), best: z.number().int() }),
  rr: z.object({ days: z.number().int(), points: z.number(), wins: z.number().int(), losses: z.number().int(), bestPlacing: z.number().int().nullable() }),
  /** Play days attended, newest first. */
  attendedDates: z.array(z.string()),
  /** Play days the club ran in the last 26 weeks. */
  clubDates: z.array(z.string()),
  rrHistory: z.array(z.object({
    date: z.string(), points: z.number(), wins: z.number().int(), losses: z.number().int(),
    placing: z.number().int(), teams: z.number().int(), diff: z.number(),
  })),
});

// ── The club shop (the website's Me → Club shop) ───────────────────────────
export const variantSchema = z.object({
  id: z.number().int(),
  fit: z.enum(["men", "women", "unisex"]),
  size: z.string(),
  /** How many can still be bought (stock less reserved and sold). */
  available: z.number().int(),
});
export const productSchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  kind: z.string(),
  nameEn: z.string(),
  nameVi: z.string(),
  descEn: z.string(),
  descVi: z.string(),
  /** Minor units of the club's currency. */
  priceCents: z.number().int(),
  images: z.array(z.string()),
  hasFit: z.boolean(),
  hasSizes: z.boolean(),
  sizeChartMen: z.string().nullable(),
  sizeChartWomen: z.string().nullable(),
  variants: z.array(variantSchema),
  available: z.number().int(),
});
export const ORDER_STATUSES = ["pending_payment", "reserved_cash", "paid", "collected", "cancelled", "expired", "refunded"] as const;
export const orderSchema = z.object({
  id: z.number().int(),
  status: z.enum(ORDER_STATUSES),
  method: z.enum(["card", "cash"]),
  totalCents: z.number().int(),
  /** A cash reservation is kept until then. */
  holdExpiresAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  collectedAt: z.string().nullable(),
  createdAt: z.string(),
  items: z.array(z.object({ label: z.string(), qty: z.number().int(), unitPriceCents: z.number().int() })),
});
export const shopResponse = z.object({
  products: z.array(productSchema),
  /** Reserved, paid and collected orders. */
  orders: z.array(orderSchema),
  /** Whether "reserve and pay cash" is offered (the club checks cash payments). */
  cash: z.boolean(),
});
export const shopOrderRequest = z.object({ variantId: z.number().int().positive().max(2147483647), method: z.enum(["card", "cash"]) });
export const shopOrderResponse = z.object({
  order: orderSchema,
  /** Card: confirm this payment in the browser with the card provider, then call confirm. */
  clientSecret: z.string().nullable(),
  /** Cash: the play day to bring it to. */
  playDay: z.string().nullable(),
});
export const orderParams = clubParams.extend({ id: z.coerce.number().int().positive().max(2147483647) });
export const orderResponse = z.object({ order: orderSchema });

// ── Membership self-service and casual booking (the website's Me) ─────────
const tier = z.enum(["monthly", "quarterly"]);
/** The weekdays a membership can be for (as the club's payments are set up). */
const membershipDay = z.enum(["friday", "wednesday"]);
export const membershipStateResponse = z.object({
  membership: z.object({
    plan: tier,
    day: membershipDay,
    status: z.enum(["active", "ending", "upcoming", "past_due"]),
    periodStart: z.string().nullable(),
    periodEnd: z.string().nullable(),
    /** Renews by itself (a subscription), until turned off. */
    recurring: z.boolean(),
    cancelAtPeriodEnd: z.boolean(),
    /** How it was paid: "card", "cash", "bank_transfer". */
    method: z.string(),
    /** Plan and day changes and turning it off are possible (a card subscription). */
    manageable: z.boolean(),
    continuation: z.object({ plan: tier, periodStart: z.string().nullable(), periodEnd: z.string().nullable(), recurring: z.boolean() }).nullable(),
    daysLeft: z.number().int(),
  }).nullable(),
  /** Minor units of the club's currency. */
  prices: z.object({ monthly: z.number().int(), quarterly: z.number().int() }),
  days: z.array(membershipDay),
  /** Days the club has paused (no new memberships or changes to them). */
  pausedDays: z.array(z.string()),
  streak: z.number().int(),
  monthRank: z.number().int().nullable(),
});
export const billingResponse = z.object({
  card: z.object({ brand: z.string(), last4: z.string(), expMonth: z.number().int(), expYear: z.number().int() }).nullable(),
  nextCharge: z.object({ date: z.string(), amountCents: z.number().int() }).nullable(),
  pendingChange: z.object({ plan: tier, day: membershipDay, from: z.string() }).nullable(),
  receipts: z.array(z.object({ date: z.string(), amountCents: z.number().int(), description: z.string(), url: z.string().nullable(), refunded: z.boolean() })),
});
const reason = z.string().min(1).max(60);
/** One membership change, as the website's /api/profile/membership/action. */
export const membershipActionRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change"), plan: tier, day: membershipDay, reason: reason.optional(), comment: z.string().max(1000).optional() }),
  z.object({ action: z.literal("cancel_change") }),
  z.object({ action: z.literal("cancel"), reason, comment: z.string().max(1000).optional() }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("renew"), plan: tier }),
  z.object({ action: z.literal("autorenew_setup") }),
  z.object({ action: z.literal("autorenew_confirm"), plan: tier, setupIntentId: z.string().min(5).max(100) }),
]);
export const membershipActionResponse = z.object({
  ok: z.literal(true),
  /** change: when the new plan or day starts. */
  from: z.string().optional(),
  cleared: z.boolean().optional(),
  /** cancel: the last day. */
  endsOn: z.string().nullable().optional(),
  /** renew (a payment) and autorenew_setup (saving a card): confirm in the browser. */
  clientSecret: z.string().optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  /** renew: the price in major units, as the website shows it. */
  priceNzd: z.number().optional(),
});
export const portalResponse = z.object({ url: z.string().url() });
export const joinRequest = z.object({ plan: tier, day: membershipDay, recurring: z.boolean() });
export const paymentStartResponse = z.object({ clientSecret: z.string(), periodStart: z.string().nullable() });
export const bookRequest = z.object({ date: dateKeySchema });

// ── Vision (the club's match tracker) ──────────────────────────────────────
const visionKind = z.enum(["live", "upload"]);
const visionPass = z.object({ id: z.number().int(), kind: visionKind, status: z.enum(["pending", "paid", "used"]), test: z.boolean(), usedAt: z.string().nullable() });
export const visionStatusQuery = z.object({ kind: visionKind.optional() });
export const visionStatusResponse = z.object({
  /** Free for everyone until trialEnds. */
  trial: z.boolean(),
  trialEnds: z.string(),
  /** A pass ready to use for this kind (after the trial). */
  pass: visionPass.nullable(),
  /** Minor units: what a live match and a video cost after the trial. */
  prices: z.object({ live: z.number().int(), upload: z.number().int() }),
  testMode: z.boolean(),
});
const matchPlayer = z.object({ id: z.number().int(), name: z.string(), avatarUrl: z.string().nullable().optional() });
const team = z.object({ name: z.string(), players: z.tuple([matchPlayer, matchPlayer]) });
const statsPlayer = z.object({ playerId: z.number().int(), hits: z.number(), distance: z.number(), topSpeed: z.number() });
const savedStats = z.object({
  mode: visionKind,
  duration: z.number(),
  rallies: z.number().int(),
  longestRally: z.number().int(),
  avgRallyShots: z.number(),
  fastestShotKmh: z.number().nullable(),
  players: z.array(statsPlayer),
  recordedBy: z.object({ id: z.number().int(), name: z.string() }),
  recordedAt: z.string(),
}).passthrough();
export const visionChallengeResponse = z.object({
  setup: z.object({
    challengeId: z.number().int(),
    status: z.string(),
    teams: z.tuple([team, team]),
    score: z.object({ posting: z.number().int().nullable(), accepting: z.number().int().nullable() }).nullable(),
  }),
  /** Stats already saved for this game, if any. */
  stats: savedStats.nullable(),
});
export const visionChallengeParams = clubParams.extend({ id: z.coerce.number().int().positive().max(2147483647) });
export const visionPlayersResponse = z.object({
  players: z.array(z.object({ id: z.number().int(), name: z.string(), avatarUrl: z.string().nullable(), me: z.boolean() })),
});
/** Hits marked by hand on a match video (time and who hit, as the camera sees them: 0 near-left … 3 far-right). */
export const visionLabelsRequest = z.object({
  videoName: z.string().min(1).max(200),
  duration: z.number().min(0).max(4 * 3600),
  hits: z.array(z.object({ t: z.number().min(0), player: z.number().int().min(0).max(3), rally: z.number().int().min(0) })).max(10000),
});
export const visionLabelsResponse = z.object({ ok: z.literal(true), id: z.number().int() });

// The tracker's own calls, as the website's /api/wolf-vision/* and
// /api/arena/match-stats (same bodies, answers and error codes).
export const visionPassQuery = z.object({ kind: visionKind, session_id: z.string().max(300).optional() });
export const visionPassResponse = z.object({
  trial: z.boolean().optional(),
  pass: visionPass.nullable(),
  priceCents: z.number().int().nullable(),
  testMode: z.boolean(),
});
export const visionBuyRequest = z.object({
  kind: visionKind,
  challengeId: z.number().int().positive().nullable().optional(),
  /** Where the checkout comes back to in the app (a path under /vision). */
  returnTo: z.string().max(300).optional(),
});
/** Checkout to pay at (`url`), or a free test pass outside production. */
export const visionBuyResponse = z.object({ url: z.string().url().optional(), pass: visionPass.optional(), testMode: z.boolean().optional() });
export const visionUseRequest = z.object({ passId: z.number().int().positive() });
export const visionUseResponse = z.object({ trial: z.boolean().optional(), pass: visionPass.nullable() });

const trackedPlayer = z.object({
  playerId: z.number().int().positive(),
  hits: z.number().int().min(0).max(5000),
  distance: z.number().min(0).max(50_000),
  topSpeed: z.number().min(0).max(15),
});
export const visionStatsRequest = z.object({
  challengeId: z.number().int().positive(),
  mode: visionKind,
  duration: z.number().min(0).max(4 * 3600),
  rallies: z.number().int().min(0).max(2000),
  longestRally: z.number().int().min(0).max(1000),
  avgRallyShots: z.number().min(0).max(1000),
  fastestShotKmh: z.number().min(0).max(500).nullable(),
  players: z.array(trackedPlayer).length(4),
  auto: z
    .object({
      quality: z.number().min(0).max(1),
      accepted: z.number().int().min(0).max(5000),
      inferred: z.number().int().min(0).max(5000),
      predicted: z.number().int().min(0).max(5000),
      estimated: z.number().int().min(0).max(10000),
      plusMinus: z.number().int().min(0).max(10000),
    })
    .optional(),
});
export const visionStatsResponse = z.object({ ok: z.literal(true), stats: savedStats });
/** A tracking phone's heartbeat: the board shows the game as tracked live. */
export const visionBeatRequest = z.object({
  challengeId: z.number().int().positive(),
  kind: z.enum(["start", "beat", "end"]),
  rallies: z.number().int().min(0).max(5000),
  hits: z.number().int().min(0).max(20000),
  quality: z.number().min(0).max(1),
});

const checkerWeights = z.object({
  v: z.literal(1),
  w1: z.array(z.number().finite()),
  b1: z.array(z.number().finite()).length(16),
  w2: z.array(z.number().finite()).length(16),
  b2: z.number().finite(),
  n: z.number().int().min(0),
});
/** The shared hit checker everyone's sessions improve (null: use the bundled one). */
export const visionModelResponse = z.object({
  model: z.object({ weights: checkerWeights, sessions: z.number().int(), createdAt: z.string() }).nullable(),
});
/** A session's fine-tuned checker weights: numbers only, never video. */
export const visionTrainRequest = z.object({
  kind: z.literal("checker"),
  weights: checkerWeights,
  trained: z.number().int().min(0).max(1_000_000),
  meta: z.object({ mode: visionKind, quality: z.number().min(0).max(1), pos: z.number().int().min(0), neg: z.number().int().min(0) }),
});
export const visionTrainResponse = z.object({ ok: z.literal(true), stored: z.boolean(), merged: z.boolean() });

const sharedName = z.string().trim().min(1).max(60);
/** A session that isn't a challenge: its stats, emailed to the players added by email (at most 3). */
export const visionShareRequest = z.object({
  teams: z.tuple([sharedName, sharedName]),
  duration: z.number().min(0).max(4 * 3600),
  rallies: z.number().int().min(0).max(2000),
  longestRally: z.number().int().min(0).max(1000),
  avgRallyShots: z.number().min(0).max(1000),
  fastestShotKmh: z.number().min(0).max(500).nullable(),
  players: z
    .array(
      z.object({
        name: sharedName,
        team: z.union([z.literal(0), z.literal(1)]),
        hits: z.number().int().min(0).max(5000),
        distance: z.number().min(0).max(50_000),
        topSpeed: z.number().min(0).max(15),
        email: z.string().trim().toLowerCase().email().max(200).optional(),
      }),
    )
    .length(4),
});
export const visionShareResponse = z.object({ ok: z.boolean(), sent: z.array(z.string()), failed: z.array(z.string()) });
