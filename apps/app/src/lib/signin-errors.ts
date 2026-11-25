// What to say when a sign-in step is refused (sign-in, and confirming it's
// you before opening the club's admin).
import { ApiError } from "@luvallplay/api/client";
import type { AppKey } from "@luvallplay/i18n/app";

export function signInErrorKey(err: unknown, fallback: AppKey): AppKey {
  if (!(err instanceof ApiError)) return "error_generic";
  if (err.offline) return "offline";
  if (err.code === "invalid_email") return "signin_err_invalid_email";
  if (err.status === 429) return "signin_err_too_many";
  if (err.code === "captcha") return "signin_err_captcha";
  if (err.code === "send_failed") return "signin_err_send";
  return err.status === 400 ? fallback : "error_generic";
}
