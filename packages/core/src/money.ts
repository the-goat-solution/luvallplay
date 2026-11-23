// Money (build plan §6.5: "Money is stored as integer minor units plus a
// currency, and each currency has its own exponent"; Phase 3 step 7).
//
// Pure: no I/O. An amount is a whole number of the currency's smallest unit
// ("minor units"): cents for NZD and AUD, whole dong for VND, which has no
// smaller unit. Nothing outside this file multiplies or divides by 100;
// apps/web/tests/money-scan.test.ts fails on a new one.

/** Decimal places per currency (ISO 4217). A currency not listed here is refused, never guessed. */
export const CURRENCY_EXPONENT = {
  NZD: 2,
  AUD: 2,
  USD: 2,
  SGD: 2,
  VND: 0,
} as const satisfies Record<string, 0 | 2 | 3>;

export type Currency = keyof typeof CURRENCY_EXPONENT;

export function isCurrency(v: unknown): v is Currency {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENT, v);
}

/** The currency's decimal places. Throws on a currency this code doesn't know. */
export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (!isCurrency(code)) throw new Error(`Unknown currency "${currency}"`);
  return CURRENCY_EXPONENT[code];
}

/** How many minor units make one major unit: 100 for NZD, 1 for VND. */
export function minorPerMajor(currency: string): number {
  return 10 ** currencyExponent(currency);
}

/** Minor units → the amount in major units, as a number (for charts, exports and form defaults; not for arithmetic). */
export function fromMinor(minor: number, currency: string): number {
  return minor / minorPerMajor(currency);
}

/**
 * Minor units → a plain decimal string with every decimal place: 1050 NZD →
 * "10.50", 50000 VND → "50000". No symbol, no grouping. For spreadsheets and
 * provider APIs.
 */
export function minorToDecimal(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor)) throw new Error("Amount must be a whole number of minor units");
  const exp = currencyExponent(currency);
  const sign = minor < 0 ? "-" : "";
  const digits = String(Math.abs(minor)).padStart(exp + 1, "0");
  return exp === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
}

/**
 * An amount typed or sent in major units → minor units, exactly (no binary
 * floating point: "19.99" is 1999, not 1998.9999…). Accepts a number or a
 * plain decimal string with "." as the decimal mark. Returns null when it
 * isn't an amount or has more decimal places than the currency allows
 * ("10.5" VND is not an amount of dong).
 */
export function toMinor(major: number | string, currency: string): number | null {
  const exp = currencyExponent(currency);
  let text: string;
  if (typeof major === "number") {
    if (!Number.isFinite(major)) return null;
    // The shortest decimal that reads back as this number: 19.99 → "19.99".
    text = String(major);
    if (/e/i.test(text)) text = major.toFixed(exp + 2).replace(/\.?0+$/, "");
  } else {
    text = major.trim();
  }
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const fraction = (m[3] ?? "").replace(/0+$/, "");
  if (fraction.length > exp) return null;
  const value = Number(m[2]) * 10 ** exp + Number(fraction.padEnd(exp, "0") || "0");
  if (!Number.isSafeInteger(value)) return null;
  return m[1] && value !== 0 ? -value : value;
}

/** Like toMinor, for a number that may carry float noise (e.g. a sum from a provider): rounds to the nearest minor unit. */
export function roundToMinor(major: number, currency: string): number {
  const exp = currencyExponent(currency);
  return Math.round(Number(`${major}e${exp}`));
}

const SYMBOL: Record<Currency, { text: string; after: boolean }> = {
  NZD: { text: "$", after: false },
  AUD: { text: "$", after: false },
  USD: { text: "$", after: false },
  SGD: { text: "$", after: false },
  VND: { text: "₫", after: true },
};

export type FormatOptions = {
  /** Drop the decimals of a whole amount: "$10" not "$10.00". Default false. */
  trimZeros?: boolean;
  /** Thousands separators. Default false: "$1234.50". */
  group?: boolean;
  /** Show "+" on a positive amount. */
  signed?: boolean;
  /** Add the currency code where the symbol alone is ambiguous: "$10 NZD". Default false. */
  code?: boolean;
  /** No symbol: "10.50". Default false. */
  bare?: boolean;
};

/**
 * Minor units → text for people: 1050 NZD → "$10.50"; 1000 NZD with
 * trimZeros → "$10"; 50000 VND → "50000 ₫", or "50.000 ₫" with group.
 */
export function formatMoney(minor: number, currency: string, options: FormatOptions = {}): string {
  const code = currency.toUpperCase() as Currency;
  const exp = currencyExponent(code);
  const per = 10 ** exp;
  const abs = Math.abs(Math.round(minor));
  let whole = String(Math.floor(abs / per));
  // Vietnamese groups thousands with "."; the others here use ",".
  if (options.group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, code === "VND" ? "." : ",");
  const cents = abs % per;
  const decimals = exp === 0 || (options.trimZeros && cents === 0) ? "" : `.${String(cents).padStart(exp, "0")}`;
  const sign = minor < 0 ? "-" : options.signed && minor > 0 ? "+" : "";
  const number = `${whole}${decimals}`;
  const s = SYMBOL[code];
  const body = options.bare ? number : s.after ? `${number} ${s.text}` : `${s.text}${number}`;
  return `${sign}${body}${options.code ? ` ${code}` : ""}`;
}

/** The step and smallest value for a number input in this currency: 0.01 for NZD, 1 for VND. */
export function inputStep(currency: string): number {
  return 1 / minorPerMajor(currency);
}
