// Money for the app (Phase 3 step 7): the helpers of @luvallplay/core/money,
// plus short forms that use the club's currency.
//
// Until reads are tenant-aware (step 11) a deployment holds one club, and
// its currency is the built-in CLUB_CURRENCY (also the built-in value of the
// `currency` setting; a test keeps the two equal). Code that already has the
// club's settings passes `config.currency` to the core helpers instead.
//
// Nothing outside packages/core/src/money.ts multiplies or divides by 100:
// tests/money-scan.test.ts fails on a new one.
import { formatMoney, fromMinor, roundToMinor, type FormatOptions } from "@luvallplay/core/money";
import { CLUB_CURRENCY } from "./constants.ts";

export * from "@luvallplay/core/money";

/** Minor units → "$10" / "$10.50" in the club's currency (whole amounts without decimals). */
export function clubMoney(minor: number, options: FormatOptions = {}): string {
  return formatMoney(minor, CLUB_CURRENCY, { trimZeros: true, ...options });
}

/** Minor units → the amount in major units, as a number (form defaults, exports, charts). */
export function clubMajor(minor: number): number {
  return fromMinor(minor, CLUB_CURRENCY);
}

/** An amount in major units → minor units, rounded to the nearest one. */
export function clubMinor(major: number): number {
  return roundToMinor(major, CLUB_CURRENCY);
}

/** The club's currency as payment providers write it ("nzd"). */
export function clubCurrencyLower(): string {
  return CLUB_CURRENCY.toLowerCase();
}
