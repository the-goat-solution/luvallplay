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
// Default courts for any membership day (Friday or Wednesday) — the club's
// main sessions.
export const DEFAULT_COURTS = 2;
// Default courts for a play day with no membership access — casual-only,
// lighter expected turnout. See defaultCourtsForDate in lib/dates.ts.
export const CASUAL_ONLY_DEFAULT_COURTS = 1;

export function maxPlayersForCourts(courts: number): number {
  return COURTS_TO_MAX_PLAYERS[courts] ?? SESSION_CAPACITY;
}
export const CASUAL_PRICE_CENTS = 1000;
export const MONTHLY_PRICE_CENTS = 3300;
export const QUARTERLY_PRICE_CENTS = 8500;
export const BOOKING_WINDOW_DAYS = 30;
export const BOOKING_CUTOFF_HOUR = 17;

// Membership cycle length in days — 4 weeks / 12 weeks, matching the Stripe
// billing interval (interval:month, count:1 or interval:month, count:3 — see
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
