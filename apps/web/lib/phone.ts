// Phone number formatting, free of imports so it can be unit-tested.

/**
 * NZ-first E.164: "021 123 4567" → "+64211234567". Numbers already in
 * international form keep their country code. Returns null for anything that
 * can't be a real mobile number.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = `64${digits.slice(1)}`;
  } else if (!digits.startsWith("64") && digits.length <= 10) {
    digits = `64${digits}`;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

// ---------------------------------------------------------------------------
// Text-message sign-in: which numbers we text
// ---------------------------------------------------------------------------

/** Countries we send sign-in texts to (Firebase's SMS region policy must allow them too). */
export const SMS_COUNTRIES = [{ code: "NZ", dial: "64", flag: "🇳🇿", name: "New Zealand", example: "21 123 4567" }] as const;
export type SmsCountry = (typeof SMS_COUNTRIES)[number];

/** NZ mobiles: 02x… → +642x… with 7–9 digits after the 2 (e.g. +64211234567). */
const NZ_MOBILE = /^\+642\d{7,9}$/;

/** True if we text this E.164 number (NZ mobiles only for now). */
export function isSmsNumberAllowed(e164: string | null | undefined): boolean {
  return Boolean(e164 && NZ_MOBILE.test(e164));
}

/**
 * The number typed after the fixed "+64" prefix → E.164, or null if it isn't
 * an NZ mobile. Accepts "21 123 4567", "021 123 4567", "+64 21…" or "64 21…".
 */
export function smsNumberFromLocal(local: string, country: SmsCountry = SMS_COUNTRIES[0]): string | null {
  let digits = local.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith(country.dial) && digits.length > 10) digits = digits.slice(country.dial.length);
  digits = digits.replace(/^0+/, "");
  const e164 = `+${country.dial}${digits}`;
  return isSmsNumberAllowed(e164) ? e164 : null;
}

/** "+64211234567" → "+64 21 123 4567" for display. */
export function formatSmsNumber(e164: string): string {
  const m = /^\+64(2\d)(\d{3})(\d{3,5})$/.exec(e164);
  return m ? `+64 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
