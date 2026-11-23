// Club jersey registration — the rules, kept free of the database so they
// can be reasoned about (and tested) on their own. Storage lives in
// lib/jersey-db.ts; the public page is app/jersey.

// Registration opens at 1:30 AM NZ time on Friday 16 October 2026 (NZDT,
// UTC+13). JERSEY_OPENS_AT overrides it, for testing or a change of plan.
const DEFAULT_OPENS_AT = "2026-10-15T12:30:00Z";

export function jerseyOpensAt(): Date {
  const override = process.env.JERSEY_OPENS_AT;
  if (override) {
    const d = new Date(override);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(DEFAULT_OPENS_AT);
}

// Registration closes at 11:59:59 PM NZ time on Wednesday 21 October 2026
// (NZDT, UTC+13). JERSEY_CLOSES_AT overrides it.
const DEFAULT_CLOSES_AT = "2026-10-21T10:59:59Z";

export function jerseyClosesAt(): Date {
  const override = process.env.JERSEY_CLOSES_AT;
  if (override) {
    const d = new Date(override);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(DEFAULT_CLOSES_AT);
}

export function isJerseyClosed(now = new Date()): boolean {
  return now.getTime() > jerseyClosesAt().getTime();
}

// Accepting registrations: after the opening time, up to the closing time.
export function isJerseyOpen(now = new Date()): boolean {
  return now.getTime() >= jerseyOpensAt().getTime() && !isJerseyClosed(now);
}

export const EARLY_BIRD_LIMIT = 10;
export const EARLY_BIRD_CENTS = 1500;
export const STANDARD_CENTS = 3000;
export const PRINT_CENTS = 500;
// An early-bird price is held this long; unpaid after that, the spot goes
// back to the pool for the next person.
export const EARLY_BIRD_HOLD_HOURS = 48;

export const BANK_ACCOUNT_NAME = "THREE WOLVES BADMINTON CLUB INC";
export const BANK_ACCOUNT_NUMBER = "01-0798-0949150-00";

export const SPONSOR_NAME = "House of Barber";
export const SPONSOR_URL = "https://houseofbarber.co.nz";

// Keep in step with the supplier's size chart (public/uploads/jersey/size-chart.jpg).
export const JERSEY_SIZES = ["S", "M", "L", "XL", "XXL"] as const;
export type JerseySize = (typeof JERSEY_SIZES)[number];

export const PRINT_NAME_MAX = 12;
// A country printed instead of a number (e.g. "NZ" or "VIETNAM").
export const PRINT_COUNTRY_MAX = 12;

// Text to print on a jersey: upper case, letters (including Vietnamese
// diacritics), digits and a few separators only.
export function cleanPrintText(s: string | undefined | null): string {
  return (s ?? "").toUpperCase().replace(/[^\p{L}\p{N} .'-]/gu, "").trim();
}

export type JerseyStatus = "pending" | "paid" | "released" | "cancelled";

export function priceCents(earlyBird: boolean, withPrint: boolean): number {
  return (earlyBird ? EARLY_BIRD_CENTS : STANDARD_CENTS) + (withPrint ? PRINT_CENTS : 0);
}

export function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

// One registration per person: the same inbox written differently
// ("Jo.Smith+shirt@Gmail.com" vs "josmith@gmail.com") is the same person.
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("64")) digits = `0${digits.slice(2)}`;
  return digits;
}

export function normalizeName(first: string, last: string): string {
  return `${first} ${last}`.toLowerCase().replace(/[^a-zÀ-ɏḀ-ỿ]+/g, " ").trim();
}

// Throwaway inboxes are a common way to register twice.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "throwawaymail.com",
  "fakeinbox.com",
  "mintemail.com",
  "emailondeck.com",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}

// Every standalone 5-digit number in a bank line's text. Bank references
// come through as typed ("JERSEY 48213", "48213 J SMITH", "TW48213"), so
// digits glued to letters count too — but not digits inside a longer
// number (an account number, a date like 20261016).
export function findRefCodes(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<!\d)(\d{5})(?!\d)/g)) out.add(m[1]);
  return [...out];
}

export const FLAG_LABEL: Record<string, string> = {
  same_ip: "Same internet connection as another registration",
  same_device: "Same browser/device as another registration",
  same_phone: "Same phone number as another registration",
  same_name: "Same name as another registration",
  underpaid: "A bank payment with this code was less than the price",
};
