// Phase 3 step 7: money is whole minor units plus a currency, and each
// currency has its own exponent (build plan §6.5; test plan gate: "minor-unit
// money audit with VND tests").

import { test } from "node:test";
import assert from "node:assert/strict";
import { currencyExponent, formatMoney, fromMinor, inputStep, isCurrency, minorPerMajor, minorToDecimal, roundToMinor, toMinor } from "@luvallplay/core/money";
import { clubCurrencyLower, clubMajor, clubMinor, clubMoney } from "../lib/money.ts";
import { CLUB_CURRENCY } from "../lib/constants.ts";
import { DEFAULT_CLUB_CONFIG } from "../lib/club-config.ts";
import { centsToInputValue, formatCents, parseAmountToCents } from "../lib/finance.ts";

test("each currency has its own exponent, and an unknown one is refused", () => {
  assert.equal(currencyExponent("NZD"), 2);
  assert.equal(currencyExponent("AUD"), 2);
  assert.equal(currencyExponent("VND"), 0);
  assert.equal(currencyExponent("vnd"), 0);
  assert.equal(minorPerMajor("NZD"), 100);
  assert.equal(minorPerMajor("VND"), 1);
  assert.equal(inputStep("NZD"), 0.01);
  assert.equal(inputStep("VND"), 1);
  assert.equal(isCurrency("VND"), true);
  assert.equal(isCurrency("XXX"), false);
  assert.equal(isCurrency("toString"), false);
  assert.throws(() => currencyExponent("XXX"), /Unknown currency/);
  assert.throws(() => formatMoney(100, "BTC"), /Unknown currency/);
});

test("VND: amounts are whole dong, never divided by 100", () => {
  // A 50,000 dong casual fee.
  assert.equal(toMinor("50000", "VND"), 50000);
  assert.equal(toMinor(50000, "VND"), 50000);
  assert.equal(fromMinor(50000, "VND"), 50000);
  assert.equal(minorToDecimal(50000, "VND"), "50000");
  assert.equal(formatMoney(50000, "VND"), "50000 ₫");
  assert.equal(formatMoney(50000, "VND", { group: true }), "50.000 ₫");
  assert.equal(formatMoney(1250000, "VND", { group: true, code: true }), "1.250.000 ₫ VND");
  assert.equal(formatMoney(-50000, "VND", { group: true }), "-50.000 ₫");
  assert.equal(formatMoney(50000, "VND", { bare: true }), "50000");
  // Half a dong doesn't exist.
  assert.equal(toMinor("50000.5", "VND"), null);
  assert.equal(toMinor(0.5, "VND"), null);
  assert.equal(toMinor("50000.00", "VND"), 50000, "trailing zeros are not a fraction");
  assert.equal(roundToMinor(49999.6, "VND"), 50000);
  // The same number means very different money in the two currencies.
  assert.equal(formatMoney(50000, "NZD"), "$500.00");
});

test("NZD: exact conversion both ways, with no floating point surprises", () => {
  assert.equal(toMinor("19.99", "NZD"), 1999);
  assert.equal(toMinor(19.99, "NZD"), 1999);
  assert.equal(toMinor(0.1 + 0.2, "NZD"), null, "0.30000000000000004 has too many decimals: not silently rounded");
  assert.equal(roundToMinor(0.1 + 0.2, "NZD"), 30);
  assert.equal(roundToMinor(1.005, "NZD"), 101, "half a cent rounds up (1.005 * 100 would give 100)");
  assert.equal(roundToMinor(-45.5, "NZD"), -4550);
  assert.equal(toMinor("12", "NZD"), 1200);
  assert.equal(toMinor("12.5", "NZD"), 1250);
  assert.equal(toMinor("-3.20", "NZD"), -320);
  assert.equal(toMinor("0", "NZD"), 0);
  for (const bad of ["", "abc", "1,234.50", "$5", "1.234", "1e3", "+5", ".5", "5.", " "]) assert.equal(toMinor(bad, "NZD"), null, JSON.stringify(bad));
  assert.equal(toMinor(Number.NaN, "NZD"), null);
  assert.equal(toMinor(Infinity, "NZD"), null);
  assert.equal(toMinor("99999999999999999999", "NZD"), null);
  assert.equal(fromMinor(1050, "NZD"), 10.5);
  assert.equal(minorToDecimal(1050, "NZD"), "10.50");
  assert.equal(minorToDecimal(5, "NZD"), "0.05");
  assert.equal(minorToDecimal(-5, "NZD"), "-0.05");
  assert.throws(() => minorToDecimal(10.5, "NZD"));
});

test("formatting matches what the app printed before, for the club's currency", () => {
  // The old code: `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`.
  for (const c of [0, 5, 50, 100, 1000, 1050, 3300, 8500, 123456, 100000]) {
    assert.equal(clubMoney(c), `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`, String(c));
    assert.equal(clubMoney(c, { trimZeros: false }), `$${(c / 100).toFixed(2)}`, String(c));
    assert.equal(clubMajor(c), c / 100);
    assert.equal(clubMinor(c / 100), c);
  }
  assert.equal(clubMoney(-1050), "-$10.50");
  assert.equal(formatMoney(1050, "NZD", { signed: true }), "+$10.50");
  assert.equal(formatMoney(123456, "NZD", { group: true }), "$1,234.56");
  assert.equal(formatMoney(200, "NZD", { trimZeros: true, code: true }), "$2 NZD");
  assert.equal(clubCurrencyLower(), "nzd");
});

test("the built-in currency is the built-in value of the currency setting", () => {
  assert.equal(DEFAULT_CLUB_CONFIG.currency, CLUB_CURRENCY);
});

test("the ledger's own parsing and formatting are unchanged", () => {
  const cases: [string, number | null][] = [
    ["12", 1200], ["12.5", 1250], ["12.50", 1250], ["$1,234.56", 123456], ["12.", 1200], ["19.99", 1999],
    ["0", null], ["-5", null], ["12.345", null], ["abc", null], ["", null], ["1000000.01", null], ["1000000", 100000000],
  ];
  for (const [input, want] of cases) assert.equal(parseAmountToCents(input), want, JSON.stringify(input));
  assert.equal(formatCents(123456), "$1,234.56");
  assert.equal(formatCents(-500), "−$5.00");
  assert.equal(formatCents(500, { signed: true }), "+$5.00");
  assert.equal(centsToInputValue(1250), "12.50");
  assert.equal(centsToInputValue(5), "0.05");
});
