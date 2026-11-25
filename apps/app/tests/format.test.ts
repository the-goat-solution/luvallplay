// Dates, times and money for people (src/lib/format.ts), and the Me tab's
// small rules that must match the website's.
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "@luvallplay/i18n/app";
import { byMonth, dayLabel, deviceCountry, dayTile, localeOf, money, monthLabel, nextUp, timeRange } from "../src/lib/format.ts";

test("locale: Vietnamese as in Vietnam; English as in the club's country", () => {
  assert.equal(localeOf("vi", "NZ"), "vi-VN");
  assert.equal(localeOf("en", "NZ"), "en-NZ");
  assert.equal(localeOf("en", "au"), "en-AU");
});

test("a club day is shown as that day, whatever the device's time zone", () => {
  // ICU versions differ on the comma ("Fri, 11 Dec"); the day itself must not move.
  assert.match(dayLabel("2026-12-11", "en-NZ"), /^Fri,? 11 Dec$/);
  assert.match(dayLabel("2026-12-11", "en-NZ", true), /^Fri,? 11 Dec,? 2026$/);
  assert.equal(dayLabel(null, "en-NZ"), "");
  assert.deepEqual(dayTile("2026-12-11", "en-NZ"), { weekday: "Fri", day: 11 });
  assert.equal(monthLabel("2026-12", "en-NZ"), "December 2026");
});

test("times are the club's local times", () => {
  // 7pm in Auckland on 11 Dec 2026 (NZDT, UTC+13) is 06:00 UTC.
  assert.match(timeRange("2026-12-11T06:00:00Z", "2026-12-11T08:00:00Z", "en-NZ", "Pacific/Auckland"), /^7:00\s?pm – 9:00\s?pm$/i);
  assert.equal(timeRange(null, null, "en-NZ", "Pacific/Auckland"), "");
});

test("money: minor units of the club's currency", () => {
  assert.equal(money(3300, "NZD"), "$33");
  assert.equal(money(1050, "NZD"), "$10.50");
  assert.equal(money(50000, "VND"), "50.000 ₫");
});

test("play days group by month, in order", () => {
  const days = [{ date: "2026-11-27" }, { date: "2026-12-04" }, { date: "2026-12-11" }];
  assert.deepEqual(byMonth(days).map(([m, list]) => [m, list.length]), [["2026-11", 1], ["2026-12", 2]]);
});

test("next up is the first day they're in that isn't paused (as on the website)", () => {
  const base = { paused: false, booked: false, included: false };
  const days = [{ ...base, date: "a" }, { ...base, date: "b", included: true, paused: true }, { ...base, date: "c", booked: true }, { ...base, date: "d", included: true }];
  assert.equal(nextUp(days)?.date, "c");
  assert.equal(nextUp([{ ...base, date: "a" }]), null);
});

test("every Me word has a Vietnamese wording, and no club name or currency is typed in", () => {
  const keys = Object.keys(app.en).filter((k) => /^(me_|mem_|cal_|days_|welcome_)/.test(k));
  assert.ok(keys.length > 50);
  for (const k of keys) {
    const vi = (app.vi as Record<string, string>)[k];
    assert.ok(vi && vi.trim(), `vi.${k}`);
    for (const text of [(app.en as Record<string, string>)[k], vi]) assert.doesNotMatch(text, /Three Wolves|Wolf|\$\d|NZD/, k);
  }
});

test("before a club's own country and money are known, nothing of another club's is assumed", () => {
  assert.equal(deviceCountry("en-AU"), "AU");
  assert.equal(deviceCountry("vi-VN"), "VN");
  assert.equal(deviceCountry("en"), "");
  assert.equal(deviceCountry(""), "");
  assert.equal(localeOf("en", ""), "en");
  assert.equal(money(500, ""), "", "no amount without a currency");
});

test("no screen falls back to New Zealand or its dollar", () => {
  const dir = new URL("../src/", import.meta.url);
  for (const f of (readdirSync(dir, { recursive: true }) as string[]).filter((x) => /\.tsx?$/.test(x))) {
    assert.doesNotMatch(readFileSync(new URL(f, dir), "utf8"), /\?\? "NZD?"|localeOf\([^)]*"NZ"\)/, f);
  }
});
