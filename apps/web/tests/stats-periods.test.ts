import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStreaks, periodFromKey, periodRange, rankRows, weekKey } from "../lib/stats-periods.ts";

test("periodRange: month, quarter, year and stepping across a year boundary", () => {
  assert.deepEqual(periodRange("month", "2026-11-16"), { period: "month", key: "2026-11", start: "2026-11-01", end: "2026-11-30" });
  assert.deepEqual(periodRange("month", "2026-01-10", -1), { period: "month", key: "2025-12", start: "2025-12-01", end: "2025-12-31" });
  assert.deepEqual(periodRange("month", "2028-02-03"), { period: "month", key: "2028-02", start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(periodRange("quarter", "2026-11-16"), { period: "quarter", key: "2026-Q4", start: "2026-10-01", end: "2026-12-31" });
  assert.equal(periodRange("quarter", "2026-11-16", 1).key, "2027-Q1");
  assert.equal(periodRange("quarter", "2026-02-01", -1).key, "2025-Q4");
  assert.deepEqual(periodRange("year", "2026-11-16", -1), { period: "year", key: "2025", start: "2025-01-01", end: "2025-12-31" });
  assert.deepEqual(periodRange("lifetime", "2026-11-16"), { period: "lifetime", key: "all", start: null, end: null });
});

test("periodFromKey round-trips and rejects junk", () => {
  for (const [p, k] of [["month", "2026-03"], ["quarter", "2026-Q2"], ["year", "2024"]] as const) {
    assert.equal(periodFromKey(p, k)?.key, k);
  }
  assert.equal(periodFromKey("month", "2026-3"), null);
  assert.equal(periodFromKey("quarter", "2026-Q5"), null);
  assert.equal(periodFromKey("year", "nope"), null);
});

test("weekKey is the Monday of the week", () => {
  assert.equal(weekKey("2026-11-20"), "2026-11-16"); // Friday
  assert.equal(weekKey("2026-11-16"), "2026-11-16"); // Monday
  assert.equal(weekKey("2026-11-22"), "2026-11-16"); // Sunday
});

test("computeStreaks: consecutive club weeks, excused weeks keep it, current week can't break it", () => {
  const fridays = ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13", "2026-11-20"];
  // Played every Friday except 16 Oct; today is Mon 16 Nov (this week's Friday hasn't happened).
  const played = fridays.filter((d) => d !== "2026-10-16" && d < "2026-11-16");
  assert.deepEqual(computeStreaks(played, fridays, [], "2026-11-16"), { current: 4, best: 4 });
  // Saying "can't make it" on 16 Oct keeps the streak going.
  assert.deepEqual(computeStreaks(played, fridays, ["2026-10-16"], "2026-11-16"), { current: 6, best: 6 });
  // A week with no club play day doesn't break a streak.
  const withGap = fridays.filter((d) => d !== "2026-10-23");
  assert.equal(computeStreaks(withGap.filter((d) => d < "2026-11-16"), withGap, [], "2026-11-16").current, 6);
});

test("rankRows: standard competition ranking", () => {
  const ranked = rankRows([
    { value: 10, tie: "5" },
    { value: 8, tie: "1" },
    { value: 8, tie: "1" },
    { value: 8, tie: "0" },
    { value: 3, tie: "" },
  ]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 2, 4, 5]);
});
