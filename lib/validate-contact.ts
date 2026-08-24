export type ContactFields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  turnstileToken?: string;
};

import type { I18nKey } from "@/lib/i18n";

export type ContactErrors = Partial<
  Record<keyof ContactFields | "session", I18nKey>
>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function turnstileRequired(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

export function validateContact(
  fields: ContactFields,
  options?: { requireTurnstile?: boolean },
): { ok: boolean; errors: ContactErrors } {
  const errors: ContactErrors = {};
  const fn = fields.firstName.trim();
  const ln = fields.lastName.trim();
  const email = fields.email.trim();
  const phone = fields.phone.trim();

  if (!fn) errors.firstName = "form_required";
  if (!ln) errors.lastName = "form_required";
  if (!email) errors.email = "form_required";
  else if (!EMAIL_RE.test(email)) errors.email = "form_email_invalid";
  if (!phone) errors.phone = "form_required";
  else if (phone.length < 6) errors.phone = "form_phone_invalid";

  const needTurnstile = options?.requireTurnstile ?? turnstileRequired();
  if (needTurnstile && !fields.turnstileToken?.trim()) {
    errors.turnstileToken = "form_captcha_required";
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateWaitlist(name: string, email: string): {
  ok: boolean;
  errors: { name?: I18nKey; email?: I18nKey };
} {
  const errors: { name?: I18nKey; email?: I18nKey } = {};
  const n = name.trim();
  const e = email.trim();
  if (!n) errors.name = "form_required";
  if (!e) errors.email = "form_required";
  else if (!EMAIL_RE.test(e)) errors.email = "form_email_invalid";
  return { ok: Object.keys(errors).length === 0, errors };
}
