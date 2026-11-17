import { z } from "zod";

// Request bodies for the sign-in routes, shared so tests can check them.
//
// Optional fields are .nullish(), not .optional(): browsers send `null` for
// empty React state (e.g. phoneProof before any text-message sign-in), and
// .optional() rejects null. That once made every typed email code fail as
// "That code isn't right" (tests/auth-schemas.test.ts).

export const emailStartSchema = z.object({
  email: z.string().trim().email().max(200),
  next: z.string().max(300).nullish(),
  lang: z.enum(["en", "vi"]).nullish().transform((v) => v ?? "en"),
  turnstileToken: z.string().nullish(),
});

export const emailVerifySchema = z.object({
  email: z.string().trim().email().max(200),
  code: z.string().trim().min(6).max(12),
  next: z.string().max(300).nullish(),
  phoneProof: z.string().max(400).nullish(),
});

export const smsVerifySchema = z.object({
  sessionInfo: z.string().min(10).max(4000),
  code: z.string().trim().min(6).max(12),
  purpose: z.enum(["login", "phone_confirm"]).nullish().transform((v) => v ?? "login"),
  next: z.string().max(300).nullish(),
});
