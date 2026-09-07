// Total players allowed on court per session. Casual spots remaining are this
// minus current active members (who can show up any Friday) minus casual
// bookings already made for that date.
//
// Fallback used only where a play day has no DB row yet (e.g. no-DB local
// dev). Once a session row exists, its `courts` value (admin-configurable
// per play day) drives capacity instead — see maxPlayersForCourts below.
export const SESSION_CAPACITY = 12;

// Max players allowed for a play day, by number of courts booked. Keep in
// sync with the CASE expression in lib/db.ts's reserveBookingSlot query.
export const COURTS_TO_MAX_PLAYERS: Record<number, number> = {
  1: 7,
  2: 12,
  3: 18,
  4: 22,
};
export const DEFAULT_COURTS = 2;
// Default courts for a play day that isn't Friday — casual-only, lighter
// expected turnout. See defaultCourtsForDate in lib/dates.ts.
export const NON_FRIDAY_DEFAULT_COURTS = 1;

export function maxPlayersForCourts(courts: number): number {
  return COURTS_TO_MAX_PLAYERS[courts] ?? SESSION_CAPACITY;
}
export const CASUAL_PRICE_CENTS = 1000;
export const MONTHLY_PRICE_CENTS = 3300;
export const QUARTERLY_PRICE_CENTS = 8500;
export const BOOKING_WINDOW_DAYS = 30;
export const BOOKING_CUTOFF_HOUR = 17;

// Membership cycle length in days — 4 weeks / 12 weeks, matching the Stripe
// billing interval (interval:week, count:4 or 12).
export const MEMBERSHIP_CYCLE_DAYS: Record<"monthly" | "quarterly", number> = {
  monthly: 28,
  quarterly: 84,
};

// End-inclusive day span for a membership window counted from the assigned
// access-start date (day 0) — one less than the cycle length.
export const MEMBERSHIP_DAYS: Record<"monthly" | "quarterly", number> = {
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

export const PRICES = {
  casual: 10,
  monthly: 33,
  quarterly: 85,
} as const;

export type PlanId = keyof typeof PRICES;
