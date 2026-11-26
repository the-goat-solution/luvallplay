// Me (the home tab).
// Dates are the club's calendar days (YYYY-MM-DD, in the club's time zone);
// times are ISO instants. Money is integer minor units of the club's
// currency (clubs.config gives the currency and its exponent).
import { z } from "zod";

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
