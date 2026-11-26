// Sign-in.
// Optional fields are .nullish(): clients send null for empty state (see
// apps/web/lib/auth-schemas.ts for the bug that taught us this).
import { z } from "zod";
import { langSchema } from "./common.ts";

export const emailStartRequest = z.object({
  email: z.string().trim().email().max(200),
  lang: langSchema.nullish(),
  turnstileToken: z.string().max(4000).nullish(),
});

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
  /** The store app: this device's push address, so it stops receiving notifications too. */
  pushToken: z.string().max(4096).nullish(),
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
