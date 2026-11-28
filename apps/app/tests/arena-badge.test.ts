// The Arena tab's red count: what the website's countArenaActions counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arenaActionCount, badgeText } from "../src/lib/arena-badge.ts";

const game = (status: string, enteredByMySide: boolean | null) => ({ status, enteredByMySide });

test("a score the other pair entered counts; one this side entered, or any other game, doesn't", () => {
  const board = { me: { incomingRequest: null }, mine: [game("awaiting", false), game("awaiting", true), game("live", null), game("disputed", false)] };
  assert.equal(arenaActionCount(board), 1);
});

test("a team-up request to answer counts one more", () => {
  assert.equal(arenaActionCount({ me: { incomingRequest: { id: 7 } }, mine: [game("awaiting", false)] }), 2);
  assert.equal(arenaActionCount({ me: { incomingRequest: { id: 7 } }, mine: [] }), 1);
});

test("no board yet, or not in the Arena: nothing", () => {
  assert.equal(arenaActionCount(undefined), 0);
  assert.equal(arenaActionCount({ me: null, mine: [game("awaiting", false)] }), 0);
});

test("shown as the bell's count is", () => {
  assert.equal(badgeText(3), "3");
  assert.equal(badgeText(12), "9+");
});
