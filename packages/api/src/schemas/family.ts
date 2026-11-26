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
  /** Set while a request to delete this child's information waits for the club. */
  deletionRequestedAt: z.string().nullable().optional(),
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
  /** What a place costs when `payment` is "card": minor units of `currency`. */
  priceMinor: z.number().int().nullable().optional(),
  currency: z.string().nullable().optional(),
});
export const familyBookRequest = z.object({ date: dateKeySchema });
export const familyBookingResponse = z.object({ booking: familyBooking });
/** A card payment for the app to confirm; the place is booked when the payment succeeds. */
export const familyPayResponse = z.object({ clientSecret: z.string(), amountMinor: z.number().int(), currency: z.string() });
export type FamilyPayResponse = z.infer<typeof familyPayResponse>;
export const familyBookingParams = clubParams.extend({ id: z.coerce.number().int().positive().max(2147483647) });
// A child's "Safety details": who to call, and the medical note (stored encrypted).
export const familyContact = z.object({ name: z.string(), phone: z.string(), relationship: z.string().nullable() });
export const familyCareResponse = z.object({
  contacts: z.array(familyContact),
  medicalNotes: z.string(),
  /** False when this deployment can't encrypt a note: the note can't be saved or shown. */
  medicalNotesAvailable: z.boolean(),
  limits: z.object({ contacts: z.number().int(), nameMax: z.number().int(), relationshipMax: z.number().int(), notesMax: z.number().int() }),
});
export const familyContactsRequest = z.object({ contacts: z.array(z.object({ name: z.string().max(200), phone: z.string().max(60), relationship: z.string().max(200).nullable().optional() })).max(10) });
export const familyNotesRequest = z.object({ notes: z.string().max(10000) });
export type FamilyCareResponse = z.infer<typeof familyCareResponse>;
// The club's forms and waivers for one child, as their guardian sees them.
export const familyForm = z.object({
  id: z.number().int(),
  slug: z.string(),
  version: z.number().int(),
  kind: z.enum(["waiver", "consent"]),
  title: z.string(),
  body: z.string(),
  /** When THIS guardian signed THIS version for the child; null when they haven't. */
  signedAt: z.string().nullable(),
  signedName: z.string().nullable(),
});
export const familyFormsResponse = z.object({ forms: z.array(familyForm), limits: z.object({ nameMax: z.number().int() }) });
export const familyFormParams = familyChildParams.extend({ formId: z.coerce.number().int().positive().max(2147483647) });
export const familySignRequest = z.object({ name: z.string().max(400) });
export const familyFormResponse = z.object({ form: familyForm });
export type FamilyFormsResponse = z.infer<typeof familyFormsResponse>;
export type FamilyFormResponse = z.infer<typeof familyFormResponse>;
// Everything the club holds about a child, for their guardian (step 7).
export const familyExportResponse = z.object({
  exportedAt: z.string(),
  child: z.object({ name: z.string(), birthYear: z.number().int().nullable(), addedAt: z.string() }),
  consent: z.object({ leaderboard: z.boolean(), photos: z.boolean(), vision: z.boolean(), confirmedAt: z.string().nullable(), version: z.string().nullable() }),
  guardians: z.number().int(),
  bookings: z.array(z.object({ date: z.string(), status: z.string(), amountMinor: z.number().int().nullable(), currency: z.string().nullable(), bookedAt: z.string() })),
  attendance: z.array(z.object({ date: z.string(), recordedAt: z.string() })),
  emergencyContacts: z.array(z.object({ position: z.number().int(), name: z.string(), phone: z.string(), relationship: z.string().nullable() })),
  /** null: no note. `unavailable`: a note exists but can't be decrypted right now. */
  medicalNotes: z.union([z.object({ notes: z.string() }), z.object({ unavailable: z.literal(true) })]).nullable(),
  forms: z.array(z.object({ title: z.string(), kind: z.string(), version: z.number().int(), signedName: z.string(), signedAt: z.string() })),
});
/** `confirm` must be true: deleting can't be undone. */
export const familyDeleteRequest = z.object({ confirm: z.boolean() });
export const familyDeleteResponse = z.object({
  deleted: z.literal(true),
  removed: z.object({ medicalNotes: z.number().int(), emergencyContacts: z.number().int(), signatures: z.number().int() }),
  kept: z.object({ bookings: z.number().int(), attendance: z.number().int() }),
});
/** Whether a request to delete the child's information is waiting for the club. */
export const familyDeleteRequestResponse = z.object({ requested: z.boolean(), requestedAt: z.string().nullable() });
export type FamilyDeleteRequestResponse = z.infer<typeof familyDeleteRequestResponse>;
export type FamilyExportResponse = z.infer<typeof familyExportResponse>;
export type FamilyDeleteResponse = z.infer<typeof familyDeleteResponse>;
export type FamilyBookingsResponse = z.infer<typeof familyBookingsResponse>;
export type FamilyBookingResponse = z.infer<typeof familyBookingResponse>;
export type FamilyChild = z.infer<typeof familyChild>;
export type FamilyResponse = z.infer<typeof familyResponse>;
export type FamilyChildResponse = z.infer<typeof familyChildResponse>;
