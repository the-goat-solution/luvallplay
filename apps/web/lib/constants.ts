// The club's IANA time zone: its days, cut-offs and printed times are counted
// in it. The one place the literal lives (a test fails on any other); it is
// the built-in value of the club's `timezone` setting (lib/club-config.ts).
export const CLUB_TIME_ZONE = "Pacific/Auckland";

// The club's currency: the built-in value of the `currency` setting, and the
// only place the code is written (lib/money.ts; tests/club-literals.test.ts).
export const CLUB_CURRENCY = "NZD";

// The club's names and the locale its dates and numbers are written in: the
// built-in values of the club's `name`, short name and locale, and the only
// place they are typed (lib/club-brand.ts reads them; tests/club-literals
// fails on another copy in admin code).
export const CLUB_NAME = "Three Wolves Badminton Club";
export const CLUB_SHORT_NAME = "Three Wolves";
export const CLUB_SLUG = "three-wolves";
export const CLUB_LOCALE = "en-NZ";
// Where the club is, as its emails' footers say it, and the inbox people can write to.
export const CLUB_PLACE = "Christchurch, NZ";
export const CLUB_CONTACT_EMAIL = "threewolvesbadminton@gmail.com";
// The club's logo files under /uploads, as emails link to them (the admin
// shell and letterheads take the logo from the club's theme in step A3).
export const CLUB_EMAIL_LOGO_PATH = "/uploads/Three%20wolves%20logo.png";
export const CLUB_EMAIL_LOGO_DARK_PATH = "/uploads/three-wolves-logo-white-mini.png";

// The club's own names for points and for the match tracker: the built-in
// values of the `terms` setting (lib/club-terms.ts).
export const CLUB_TERMS = {
  pointsName: "Wolf Points",
  visionName: "Wolf Vision",
  alphaName: "Alpha Wolf",
  silverName: "Silver Wolf",
  // The tracker's words for a player, players and a pair ("Wolf 1", "Pack A").
  playerName: "Wolf",
  playersName: "Wolves",
  pairName: "Pack",
  localized: { vi: { pointsName: "Điểm Sói", alphaName: "Sói Đầu Đàn", silverName: "Sói Bạc", playerName: "Sói", playersName: "Sói", pairName: "Bầy" } },
} as const;

// Days of the week that grant recurring-membership access. Every other day
// is casual-bookings-only. See lib/dates.ts's getMembershipDayForDate for the
// date -> MembershipDay mapping used everywhere capacity/roster logic needs
// to know which membership pool (if any) a given play day belongs to.
export type MembershipDay = "friday" | "wednesday";
export const MEMBERSHIP_ACCESS_DAYS: MembershipDay[] = ["friday", "wednesday"];
// JS Date#getDay() values (0=Sunday) for each membership day.
export const MEMBERSHIP_DAY_TO_DOW: Record<MembershipDay, number> = {
  wednesday: 3,
  friday: 5,
};

// Total players allowed on court per session. Casual spots remaining are this
// minus current active members whose membership day matches this date, minus
// casual bookings already made for that date.
//
// Fallback used only where a play day has no DB row yet (e.g. no-DB local
// dev). Once a session row exists, its `courts` value (admin-configurable
// per play day) drives capacity instead — see maxPlayersForCourts below.
export const SESSION_CAPACITY = 12;

// Max players allowed for a play day, by number of courts booked. Keep in
// sync with the CASE expression in lib/db.ts's reserveBookingSlot query.
export const COURTS_TO_MAX_PLAYERS: Record<number, number> = {
  1: 6,
  2: 12,
  3: 18,
  4: 22,
};
// Default courts for a new membership-day session row, by day — Wednesday
// runs lighter than Friday. Only applies to newly created rows; see
// defaultCourtsForDate in lib/dates.ts and setCourtsForDate in lib/db.ts.
export const MEMBERSHIP_DAY_DEFAULT_COURTS: Record<MembershipDay, number> = {
  friday: 2,
  wednesday: 1,
};
// Default courts for a play day with no membership access — casual-only,
// lighter expected turnout. See defaultCourtsForDate in lib/dates.ts.
export const CASUAL_ONLY_DEFAULT_COURTS = 1;

export function maxPlayersForCourts(courts: number): number {
  return COURTS_TO_MAX_PLAYERS[courts] ?? SESSION_CAPACITY;
}

// A mini game day (admin toggle on the play-days page) runs the round
// robin for a fixed field of players, whatever the courts: capacity is
// exactly this many, and registration stays locked so the admin picks who
// plays. Keep in sync with the mini_game branch of the capacity CASE in
// lib/db.ts's reserveBookingSlot.
export const MINI_GAME_MAX_PLAYERS = 16;

// Capacity of one play day: the court-derived max, or the mini game field.
export function sessionMaxPlayers(courts: number, miniGame = false): number {
  return miniGame ? MINI_GAME_MAX_PLAYERS : maxPlayersForCourts(courts);
}
export const CASUAL_PRICE_CENTS = 1000;
export const MONTHLY_PRICE_CENTS = 3300;
export const QUARTERLY_PRICE_CENTS = 8500;
export const BOOKING_WINDOW_DAYS = 30;
export const BOOKING_CUTOFF_HOUR = 17;

// Membership cycle length in days — 4 weeks / 12 weeks, matching the Stripe
// billing interval (interval:week, count:4 or count:12 — see
// scripts/stripe-setup.mjs for the actual recurring price configuration).
export const MEMBERSHIP_CYCLE_DAYS: Record<MembershipTier, number> = {
  monthly: 28,
  quarterly: 84,
};

// End-inclusive day span for a membership window counted from the assigned
// access-start date (day 0) — one less than the cycle length.
export const MEMBERSHIP_DAYS: Record<MembershipTier, number> = {
  monthly: MEMBERSHIP_CYCLE_DAYS.monthly - 1,
  quarterly: MEMBERSHIP_CYCLE_DAYS.quarterly - 1,
};

// How far ahead to search for the next play day with room when assigning a
// new membership's access-start date — matches the Google Calendar sync
// horizon (see app/api/cron/sync-calendar/route.ts), so we never search past
// dates that could plausibly be synced yet.
export const MEMBERSHIP_START_SEARCH_DAYS = 90;

// A 'pending' membership row (Stripe subscription/PaymentIntent created, but
// payment not yet confirmed) still provisionally occupies a spot for this
// long, so two concurrent signups can't both claim the same last-open play
// day. Abandoned checkouts stop blocking a spot after this window without
// needing a cleanup job.
export const PENDING_MEMBERSHIP_HOLD_MINUTES = 30;
export const DONATION_MIN_CENTS = 200;
export const DONATION_MAX_CENTS = 500000;

export type DonationFrequency = "once" | "monthly";

export const GALLERY_IMAGES = [
  {
    src: "/uploads/705237516_122111863220852785_3866235625892853843_n.jpg",
    alt: "Three Wolves — group photo",
  },
  {
    src: "/uploads/678602054_122107704008852785_8338718090885557850_n.jpg",
    alt: "Player in action",
  },
  {
    src: "/uploads/656703917_122095036622852785_1698823098359580880_n.jpg",
    alt: "Three Wolves members on court",
  },
] as const;

// Public-facing plan identity: casual is day-agnostic, and each membership
// tier (monthly/quarterly) is offered on both membership days at the same
// price. See lib/pricing-plans.ts's splitPlanId for converting one of these
// into the { tier, day } pair the DB/Stripe layer works with.
export const PRICES = {
  casual: 10,
  fridayMonthly: 33,
  fridayQuarterly: 85,
  wednesdayMonthly: 33,
  wednesdayQuarterly: 85,
} as const;

export type PlanId = keyof typeof PRICES;
export type MembershipTier = "monthly" | "quarterly";

// Every day of the week, Monday first — used for "request a play day"
// sign-ups and for pausing public sign-ups on a given weekday.
export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";
export const WEEKDAYS: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
// JS Date#getDay() order (0=Sunday).
export const DOW_TO_WEEKDAY: Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
export const WEEKDAY_LABEL: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

// Weekdays whose public sign-ups (memberships and casual bookings) start out
// paused. The live setting is admin-controlled from /admin/play-days/schedule and
// stored in the day_signup_settings table (see lib/day-requests.ts); this
// list only seeds that table and covers local dev without a database.
export const DEFAULT_PAUSED_DAYS: Weekday[] = ["wednesday"];
