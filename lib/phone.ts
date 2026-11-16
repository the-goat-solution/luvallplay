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
