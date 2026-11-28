// The Leaderboard's chosen board in the address.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOARD_PERIODS, BOARD_SOURCES } from "@luvallplay/api/schemas";
import { boardSearch, PERIODS, queryOf, SOURCES } from "../src/lib/board-search.ts";

test("the app's lists are the API's", () => {
  assert.deepEqual([...SOURCES], [...BOARD_SOURCES]);
  assert.deepEqual([...PERIODS], [...BOARD_PERIODS]);
});

test("known values are kept; the defaults stay out of the address", () => {
  assert.deepEqual(boardSearch({ source: "challenges", period: "year", key: "2025" }), { source: "challenges", period: "year", key: "2025" });
  assert.deepEqual(boardSearch({ period: "quarter", key: "2026-Q3" }), { period: "quarter", key: "2026-Q3" });
  assert.deepEqual(boardSearch({ period: "month", key: "2026-10" }), { period: "month", key: "2026-10" });
  assert.deepEqual(boardSearch({ period: "year", key: 2025 }), { period: "year", key: "2025" }, "the router reads 2025 as a number");
  assert.deepEqual(boardSearch({ source: "all", period: "lifetime" }), {});
});

test("anything else is dropped: an unknown source or period, a malformed key, a key with no period", () => {
  assert.deepEqual(boardSearch({ source: "secret", period: "decade", key: "x" }), {});
  assert.deepEqual(boardSearch({ period: "month", key: "2026-13" }), { period: "month" });
  assert.deepEqual(boardSearch({ period: "year", key: "2025<script>" }), { period: "year" });
  assert.deepEqual(boardSearch({ key: "2025" }), {});
});

test("the board's query fills in the defaults", () => {
  assert.deepEqual(queryOf({}), { source: "all", period: "lifetime" });
  assert.deepEqual(queryOf({ period: "year", key: "2025" }), { source: "all", period: "year", key: "2025" });
});
