// A guardian's family (module juniors; build plan §6.8, Phase 3b step 3).
// A child is a name and a birth year: never an email, a phone or a sign-in.
import { z } from "zod";
import { clubParams } from "./clubs.ts";
import { dateKeySchema } from "./me.ts";

/** What a guardian can allow for a child, each on its own; all off until switched on. */
export const familyConsent = z.object({
  /** The club's board, as first name and initial only. */
  leaderboard: z.boolean(),
  photos: z.boolean(),
  /** Match video (Vision). */
  vision: z.boolean(),
});
export const familyChild = z.object({
  id: z.number().int(),
  name: z.string(),
  birthYear: z.number().int(),
  /** This guardian's own answers. With two guardians, both must allow an item. */
  consent: familyConsent,
  /** When this guardian confirmed they are the child's parent or guardian. */
  consentAt: z.string(),
  consentVersion: z.string(),
  addedAt: z.string(),
  /** How many guardians manage this child. */
  guardians: z.number().int(),
});
export const familyResponse = z.object({
  children: z.array(familyChild),
  /** What the add form may offer. */
  limits: z.object({ maxChildren: z.number().int(), birthYearMin: z.number().int(), birthYearMax: z.number().int(), nameMax: z.number().int() }),
  /** The version of the wording the guardian agrees to when adding a child. */
  consentVersion: z.string(),
});
export const familyChildResponse = z.object({ child: familyChild });
export const familyChildParams = clubParams.extend({ id: z.coerce.number().int().positive().max(2147483647) });
export const familyAddRequest = z.object({
  name: z.string().min(1).max(200),
  birthYear: z.number().int().min(1900).max(2200),
  /** "I am this child's parent or legal guardian, I'm 18 or over, and I agree to the club holding this information." */
  guardianConfirmed: z.boolean(),
  consent: familyConsent.partial().optional(),
});
export const familyUpdateRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  birthYear: z.number().int().min(1900).max(2200).optional(),
});
export const familyConsentRequest = familyConsent.partial();
// ── Booking a place for a child (step 5) ────────────────────────────────────
/** A play day a child could be booked on. */
export const familyDay = z.object({
  date: z.string(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  location: z.string().nullable(),
  /** Places left that day, shared with adults' casual bookings. */
  spotsLeft: z.number().int(),
});
export const familyBooking = z.object({
  id: z.number().int(),
  childId: z.number().int(),
  date: z.string(),
  status: z.enum(["pending", "confirmed", "cancelled", "refunded"]),
  /** Minor units of `currency`; null when nothing was charged. */
  amountMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
});
export const familyBookingsResponse = z.object({
  days: z.array(familyDay),
  /** The guardian's own children's upcoming bookings. */
  bookings: z.array(familyBooking),
  /** "none": a place is booked at once. "card": the club charges for a junior's place. */
  payment: z.enum(["none", "card"]),
});
export const familyBookRequest = z.object({ date: dateKeySchema });
export const familyBookingResponse = z.object({ booking: familyBooking });
export const familyBookingParams = clubParams.extend({ id: z.coerce.number().int().positive().max(2147483647) });
export type FamilyBookingsResponse = z.infer<typeof familyBookingsResponse>;
export type FamilyBookingResponse = z.infer<typeof familyBookingResponse>;
export type FamilyChild = z.infer<typeof familyChild>;
export type FamilyResponse = z.infer<typeof familyResponse>;
export type FamilyChildResponse = z.infer<typeof familyChildResponse>;
