// The account: details, language, photo, privacy, data.
// The same for every club. The phone number isn't changed here (changing it
// drops its confirmation, which signing in by text relies on).
import { z } from "zod";
import { langSchema } from "./common.ts";

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

// Push notifications (the store app). It is opt-in: every kind starts off.
/** The kinds a person chooses between: a challenge, a result to confirm, a message from the club, a play-day reminder, the roster, a payment problem. */
export const pushKindSchema = z.enum(["challenge", "result", "message", "reminder", "roster", "payment"]);
const pushKinds = z.object({
  challenge: z.boolean(),
  result: z.boolean(),
  message: z.boolean(),
  reminder: z.boolean(),
  roster: z.boolean(),
  payment: z.boolean(),
});
/** A device's push address as the phone gives it. It is stored sealed and never sent back. */
const pushAddress = z.string().regex(/^[A-Za-z0-9_:.\-]{32,4096}$/);

export const pushResponse = z.object({
  /** False where notifications can't be sent from (no key set): the app hides the switches. */
  available: z.boolean(),
  /** How many of the person's devices receive notifications. */
  devices: z.number().int().nonnegative(),
  kinds: pushKinds,
});
export const pushDeviceRequest = z.object({ token: pushAddress, platform: z.enum(["android", "ios"]) });
export const pushRemoveDeviceRequest = z.object({ token: pushAddress });
/** Only the kinds named change. */
export const pushKindsRequest = pushKinds.partial().strict().refine((v) => Object.keys(v).length > 0);
export const pushKindsResponse = z.object({ ok: z.literal(true), kinds: pushKinds });
