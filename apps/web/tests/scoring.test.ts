// Per-sport scoring rules (build plan §6.7). The badminton pack must agree
// with the Arena's own check on every score, so switching the Arena to the
// packs changes nothing for Three Wolves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidGameScore } from "@luvallplay/core/ranks";
import { SCORED_SPORTS, SCORING, checkMatch, gameWinner, isValidGame, isValidScoreFor, scoringFor } from "@luvallplay/core/scoring";

test("badminton: the pack agrees with the Arena's check on every score, valid or not", () => {
  const values = [-1, 0.5, NaN, Infinity, ...Array.from({ length: 41 }, (_, i) => i)];
  let valid = 0;
  for (const a of values) {
    for (const b of values) {
      assert.equal(isValidScoreFor("badminton", a, b), isValidGameScore(a, b), `${a}-${b}`);
      if (isValidGameScore(a, b)) valid++;
    }
  }
  // 21-0…21-19 (20), 22-20…29-27 (8), 30-28 and 30-29 (2), each way round.
  assert.equal(valid, 60);
});

test("every sport's pack is well formed", () => {
  assert.deepEqual(SCORED_SPORTS, ["badminton", "pickleball", "table-tennis", "squash", "volleyball", "tennis", "futsal", "football", "basketball"]);
  for (const sport of SCORED_SPORTS) {
    const rules = SCORING[sport];
    assert.equal(rules.sport, sport);
    assert.ok(rules.bestOf.length > 0 && rules.bestOf.every((n) => n % 2 === 1), `${sport} best-of`);
    assert.equal(new Set(rules.bestOf).size, rules.bestOf.length);
    for (const g of [rules.game, ...("decider" in rules ? [rules.decider] : [])]) {
      if (g.kind === "rally") {
        assert.ok(g.target > 0 && g.winBy >= 1 && g.winBy <= g.target);
        assert.ok(g.cap === null || g.cap > g.target);
      } else {
        assert.ok(g.max > 0);
        assert.deepEqual(rules.bestOf, [1], `${sport}: a goals sport is one match`);
      }
    }
  }
  assert.equal(scoringFor("badminton"), SCORING.badminton);
  assert.equal(scoringFor("curling"), null);
  assert.equal(scoringFor("toString"), null);
  assert.equal(scoringFor("__proto__"), null);
});

const scores = (sport: string, list: [number, number][]) => list.map(([a, b]) => isValidScoreFor(sport, a, b));

test("pickleball, table tennis and squash: to 11, win by 2, no cap", () => {
  for (const sport of ["pickleball", "table-tennis", "squash"]) {
    assert.deepEqual(scores(sport, [[11, 0], [11, 9], [9, 11], [12, 10], [15, 13], [40, 38]]), [true, true, true, true, true, true], sport);
    assert.deepEqual(scores(sport, [[11, 10], [10, 8], [12, 9], [13, 10], [11, 11], [21, 15], [-11, 2], [11.5, 9]]), [false, false, false, false, false, false, false, false], sport);
  }
});

test("volleyball: sets to 25, the deciding set to 15", () => {
  assert.deepEqual(scores("volleyball", [[25, 23], [26, 24], [31, 29], [25, 0]]), [true, true, true, true]);
  assert.deepEqual(scores("volleyball", [[25, 24], [15, 13], [27, 24]]), [false, false, false]);
  const v = SCORING.volleyball;
  assert.deepEqual(checkMatch(v, [[25, 20], [20, 25], [25, 22], [23, 25], [15, 12]], 5), { ok: true, winner: "a", gamesA: 3, gamesB: 2 });
  assert.deepEqual(checkMatch(v, [[25, 20], [20, 25], [25, 22], [23, 25], [25, 22]], 5), { ok: false, reason: "bad_game", game: 4 });
  // The decider rule applies only to the last possible set.
  assert.deepEqual(checkMatch(v, [[25, 20], [15, 13], [25, 22]], 5), { ok: false, reason: "bad_game", game: 1 });
});

test("tennis: a tie-break set", () => {
  assert.deepEqual(scores("tennis", [[6, 0], [6, 4], [7, 5], [7, 6], [4, 6], [6, 7]]), [true, true, true, true, true, true]);
  assert.deepEqual(scores("tennis", [[6, 5], [7, 4], [8, 6], [6, 6], [5, 3]]), [false, false, false, false, false]);
});

test("goal sports: any score; a draw only where the sport has one", () => {
  assert.deepEqual(scores("futsal", [[0, 0], [3, 3], [7, 2], [0, 12]]), [true, true, true, true]);
  assert.deepEqual(scores("futsal", [[100, 2], [-1, 0], [2.5, 1]]), [false, false, false]);
  assert.deepEqual(scores("basketball", [[88, 86], [102, 99]]), [true, true]);
  assert.deepEqual(scores("basketball", [[80, 80], [301, 2]]), [false, false]);
  assert.deepEqual(checkMatch(SCORING.futsal, [[2, 2]]), { ok: true, winner: "draw", gamesA: 0, gamesB: 0 });
  assert.deepEqual(checkMatch(SCORING.football, [[1, 3]]), { ok: true, winner: "b", gamesA: 0, gamesB: 1 });
  assert.deepEqual(checkMatch(SCORING.futsal, [[2, 1], [0, 1], [1, 0]], 3), { ok: false, reason: "bad_format" });
});

test("a sport without a pack accepts no score", () => {
  assert.equal(isValidScoreFor("curling", 21, 10), false);
  assert.equal(isValidScoreFor("", 21, 10), false);
});

test("matches: the winner takes the majority and play stops when the match is won", () => {
  const b = SCORING.badminton;
  assert.deepEqual(checkMatch(b, [[21, 15], [21, 18]]), { ok: true, winner: "a", gamesA: 2, gamesB: 0 });
  assert.deepEqual(checkMatch(b, [[21, 15], [18, 21], [28, 30]]), { ok: true, winner: "b", gamesA: 1, gamesB: 2 });
  assert.deepEqual(checkMatch(b, [[21, 15]], 1), { ok: true, winner: "a", gamesA: 1, gamesB: 0 });
  assert.deepEqual(checkMatch(b, [[21, 15]]), { ok: false, reason: "too_few_games" });
  assert.deepEqual(checkMatch(b, [[21, 15], [15, 21]]), { ok: false, reason: "too_few_games" });
  assert.deepEqual(checkMatch(b, []), { ok: false, reason: "too_few_games" });
  // A third game after 2–0 was never played.
  assert.deepEqual(checkMatch(b, [[21, 15], [21, 18], [21, 9]]), { ok: false, reason: "too_many_games" });
  assert.deepEqual(checkMatch(b, [[21, 15], [21, 18], [9, 21], [21, 3]]), { ok: false, reason: "too_many_games" });
  assert.deepEqual(checkMatch(b, [[21, 15], [21, 20]]), { ok: false, reason: "bad_game", game: 1 });
  // Badminton isn't played as best of 5 or of 2.
  assert.deepEqual(checkMatch(b, [[21, 15], [21, 18], [21, 9]], 5), { ok: false, reason: "bad_format" });
  assert.deepEqual(checkMatch(b, [[21, 15], [21, 18]], 2), { ok: false, reason: "bad_format" });
  assert.deepEqual(checkMatch(SCORING["table-tennis"], [[11, 9], [9, 11], [11, 7], [12, 14], [11, 5]]), { ok: true, winner: "a", gamesA: 3, gamesB: 2 });
});

test("gameWinner and isValidGame", () => {
  assert.equal(gameWinner(21, 19), "a");
  assert.equal(gameWinner(19, 21), "b");
  assert.equal(gameWinner(2, 2), "draw");
  assert.equal(isValidGame({ kind: "rally", target: 15, winBy: 1, cap: null }, 15, 14), true);
  assert.equal(isValidGame({ kind: "rally", target: 15, winBy: 1, cap: null }, 16, 15), true);
  assert.equal(isValidGame({ kind: "rally", target: 15, winBy: 2, cap: 17 }, 17, 16), true);
  assert.equal(isValidGame({ kind: "rally", target: 15, winBy: 2, cap: 17 }, 17, 14), false);
  assert.equal(isValidGame({ kind: "rally", target: 15, winBy: 2, cap: 17 }, 18, 16), false);
});
