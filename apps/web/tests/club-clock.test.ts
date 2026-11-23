// Phase 3 step 4: the booking clock is the club's (time zone, booking
// window, cut-off hour), not Three Wolves' built in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLUB_CLOCK, clubDateKeyForInstant, formatEventTimeRange, getClubToday, isBookable, isWithinBookingLock, type ClubClock } from "../lib/dates.ts";
import { DEFAULT_PUBLIC_CLUB, clockOf, hourLabel, publicClub } from "../lib/club-public.ts";
import { DEFAULT_CLUB_CONFIG } from "../lib/club-config.ts";
import { projectedPeriodEndSql } from "../lib/db.ts";

const HANOI: ClubClock = { timezone: "Asia/Ho_Chi_Minh", bookingWindowDays: 14, bookingCutoffHour: 20 };
// 23 Nov 2026 10:30 UTC: 23:30 in Auckland, 17:30 in Hanoi.
const NOW = new Date("2026-11-23T10:30:00Z");
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

test("the default clock is today's built-in values", () => {
  assert.deepEqual(DEFAULT_CLUB_CLOCK, { timezone: "Pacific/Auckland", bookingWindowDays: 30, bookingCutoffHour: 17 });
  assert.deepEqual(getClubToday(NOW), getClubToday(NOW, DEFAULT_CLUB_CLOCK));
  assert.deepEqual(getClubToday(NOW), { dateKey: "2026-11-23", cutoffPassed: true });
});

test("another club's clock gives another club's answers at the same instant", () => {
  assert.deepEqual(getClubToday(NOW, HANOI), { dateKey: "2026-11-23", cutoffPassed: false });
  // Same-day booking: closed in Auckland (past 5PM), open in Hanoi (before 8PM).
  assert.equal(isBookable(day(2026, 11, 23), NOW), false);
  assert.equal(isBookable(day(2026, 11, 23), NOW, HANOI), true);
  assert.equal(isWithinBookingLock(day(2026, 11, 23), NOW, HANOI), false);
  // The window: 20 days ahead is open for a 30-day club, not for a 14-day one.
  assert.equal(isBookable(day(2026, 12, 13), NOW), true);
  assert.equal(isBookable(day(2026, 12, 13), NOW, HANOI), false);
  assert.equal(isWithinBookingLock(day(2026, 12, 13), NOW, HANOI), true);
  // The club's calendar day of an instant.
  const lateUtc = new Date("2026-11-23T18:00:00Z");
  assert.equal(clubDateKeyForInstant(lateUtc), "2026-11-24");
  assert.equal(clubDateKeyForInstant(lateUtc, HANOI.timezone), "2026-11-24");
  assert.equal(clubDateKeyForInstant(new Date("2026-11-23T12:00:00Z"), HANOI.timezone), "2026-11-23");
  assert.notEqual(formatEventTimeRange("2026-11-23T06:00:00Z", null), formatEventTimeRange("2026-11-23T06:00:00Z", null, HANOI.timezone));
});

test("the browser's copy of the settings matches the server's", () => {
  assert.deepEqual(publicClub(DEFAULT_CLUB_CONFIG), DEFAULT_PUBLIC_CLUB);
  assert.deepEqual(clockOf(DEFAULT_CLUB_CONFIG), DEFAULT_CLUB_CLOCK);
  assert.deepEqual([0, 9, 12, 17, 23].map(hourLabel), ["12AM", "9AM", "12PM", "5PM", "11PM"]);
});

test("membership cycle lengths go into SQL as whole numbers only", () => {
  assert.equal(projectedPeriodEndSql("$1"), projectedPeriodEndSql("$1", { monthly: 28, quarterly: 84 }));
  const other = projectedPeriodEndSql("$1", { monthly: 30, quarterly: 90 });
  assert.match(other, /THEN 90 ELSE 30 END/);
  assert.throws(() => projectedPeriodEndSql("$1", { monthly: 0, quarterly: 84 }));
  assert.throws(() => projectedPeriodEndSql("$1", { monthly: "28; DROP TABLE players" as unknown as number, quarterly: 84 }));
});

test("the last minute of a club day, in any time zone and across daylight saving", async () => {
  const { endOfClubDay } = await import("../lib/shop-db.ts");
  const iso = (dateKey: string, tz: string) => endOfClubDay(dateKey, tz).toISOString();
  // New Zealand: +13 in summer, +12 in winter (what the old helper hard-coded).
  assert.equal(iso("2026-11-27", "Pacific/Auckland"), "2026-11-27T10:59:00.000Z");
  assert.equal(iso("2026-06-26", "Pacific/Auckland"), "2026-06-26T11:59:00.000Z");
  // The days the clocks change.
  assert.equal(iso("2026-09-27", "Pacific/Auckland"), "2026-09-27T10:59:00.000Z");
  assert.equal(iso("2026-04-05", "Pacific/Auckland"), "2026-04-05T11:59:00.000Z");
  // Other clubs: Hanoi (+7, no daylight saving), Sydney, and one west of UTC.
  assert.equal(iso("2026-11-27", "Asia/Ho_Chi_Minh"), "2026-11-27T16:59:00.000Z");
  assert.equal(iso("2026-11-27", "Australia/Sydney"), "2026-11-27T12:59:00.000Z");
  assert.equal(iso("2026-11-27", "America/Los_Angeles"), "2026-11-28T07:59:00.000Z");
  // Whatever the zone, that instant is still that club's day, and a minute later isn't.
  for (const tz of ["Pacific/Auckland", "Asia/Ho_Chi_Minh", "Australia/Sydney", "America/Los_Angeles", "UTC"]) {
    for (const day of ["2026-04-05", "2026-09-27", "2026-12-31", "2027-01-01"]) {
      const end = endOfClubDay(day, tz);
      assert.equal(clubDateKeyForInstant(end, tz), day, `${day} ${tz}`);
      assert.notEqual(clubDateKeyForInstant(new Date(end.getTime() + 60_000), tz), day, `${day} ${tz} + 1 min`);
    }
  }
});
