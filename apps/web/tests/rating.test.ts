// Global skill ratings (build plan §8 item 2): Glicko-2 against Glickman's
// published example, its mathematical properties, the verified-match rules
// (disputes and unconfirmed results never count), rating periods, doubles,
// and the leaderboard views (opt-in, juniors never, provisional players).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGE_BANDS,
  DEFAULT_MAX_CHANGE,
  DEFAULT_MAX_VOLATILITY,
  DEFAULT_MIN_RD,
  DEFAULT_RD,
  ageBand,
  expectedScore,
  isProvisional,
  leaderboard,
  newRating,
  periodOf,
  periodStart,
  placeKey,
  rateMatches,
  ratingInterval,
  updateRating,
  verifyArenaChallenge,
  verifyRoundRobinGame,
  virtualOpponent,
  winProbability,
  type ArenaChallengeFacts,
  type BoardPlayer,
  type Rating,
  type RoundRobinGameFacts,
  type VerifiedMatch,
} from "@luvallplay/core/rating";

const near = (actual: number, expected: number, tolerance: number, what = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} ± ${tolerance}, got ${actual}`);

// ── Glicko-2 ────────────────────────────────────────────────────────────────

test("Glickman's worked example: 1500/200 beats 1400, loses to 1550 and 1700", () => {
  // "Example of the Glicko-2 system", Glickman: τ = 0.5 → r′ = 1464.06, RD′ = 151.52, σ′ = 0.05999.
  const after = updateRating(
    { rating: 1500, rd: 200, volatility: 0.06 },
    [
      { opponent: { rating: 1400, rd: 30 }, score: 1 },
      { opponent: { rating: 1550, rd: 100 }, score: 0 },
      { opponent: { rating: 1700, rd: 300 }, score: 0 },
    ],
    { tau: 0.5 },
  );
  near(after.rating, 1464.06, 0.01, "rating");
  near(after.rd, 151.52, 0.01, "rd");
  near(after.volatility, 0.05999, 0.00001, "volatility");
});

test("a new player is 1500 / 350 / 0.06, shown as a range of ± 2 RD", () => {
  assert.deepEqual(newRating(), { rating: 1500, rd: 350, volatility: 0.06 });
  assert.deepEqual(ratingInterval({ rating: 1500, rd: 50 }), { low: 1400, high: 1600 });
});

test("a period without games: the rating and volatility stay, only RD grows, never past 350", () => {
  const before: Rating = { rating: 1620, rd: 80, volatility: 0.06 };
  const after = updateRating(before, []);
  assert.equal(after.rating, 1620);
  assert.equal(after.volatility, 0.06);
  near(after.rd, Math.sqrt(80 ** 2 + (0.06 * 173.7178) ** 2), 1e-9);
  let r = before;
  for (let i = 0; i < 5000; i++) r = updateRating(r, []);
  assert.equal(r.rd, DEFAULT_RD);
  assert.equal(updateRating(newRating(), []).rd, DEFAULT_RD);
});

test("a win never lowers a rating and a loss never raises it; an upset moves more than an expected result", () => {
  const me: Rating = { rating: 1500, rd: 120, volatility: 0.06 };
  for (const opp of [1100, 1300, 1500, 1700, 1900]) {
    const opponent = { rating: opp, rd: 80 };
    const win = updateRating(me, [{ opponent, score: 1 }]);
    const loss = updateRating(me, [{ opponent, score: 0 }]);
    const draw = updateRating(me, [{ opponent, score: 0.5 }]);
    assert.ok(win.rating > me.rating, `win vs ${opp}`);
    assert.ok(loss.rating < me.rating, `loss vs ${opp}`);
    assert.ok(loss.rating < draw.rating && draw.rating < win.rating, `draw between vs ${opp}`);
    // Playing makes the estimate more certain than sitting out.
    assert.ok(win.rd < updateRating(me, []).rd);
  }
  const gain = (opp: number) => updateRating(me, [{ opponent: { rating: opp, rd: 80 }, score: 1 }]).rating - me.rating;
  assert.ok(gain(1900) > gain(1500) && gain(1500) > gain(1100));
});

test("an uncertain player moves further than a settled one on the same result", () => {
  const opponent = { rating: 1500, rd: 60 };
  const fresh = updateRating({ rating: 1500, rd: 350, volatility: 0.06 }, [{ opponent, score: 1 }]);
  const settled = updateRating({ rating: 1500, rd: 50, volatility: 0.06 }, [{ opponent, score: 1 }]);
  assert.ok(fresh.rating - 1500 > 5 * (settled.rating - 1500));
});

test("a result against an uncertain opponent counts for less", () => {
  const me: Rating = { rating: 1500, rd: 100, volatility: 0.06 };
  const sure = updateRating(me, [{ opponent: { rating: 1500, rd: 30 }, score: 1 }]);
  const unsure = updateRating(me, [{ opponent: { rating: 1500, rd: 350 }, score: 1 }]);
  assert.ok(sure.rating > unsure.rating);
});

test("surprising results raise volatility, steady ones lower it", () => {
  const me: Rating = { rating: 1500, rd: 60, volatility: 0.06 };
  const shock = updateRating(me, Array.from({ length: 12 }, () => ({ opponent: { rating: 2100, rd: 40 }, score: 1 as const })));
  assert.ok(shock.volatility > 0.06);
  const steady = updateRating(me, [
    { opponent: { rating: 1500, rd: 40 }, score: 1 },
    { opponent: { rating: 1500, rd: 40 }, score: 0 },
  ]);
  assert.ok(steady.volatility < 0.06);
});

test("RD has a floor, so a settled rating can still move", () => {
  let r: Rating = { rating: 1500, rd: 40, volatility: 0.06 };
  for (let i = 0; i < 200; i++) {
    r = updateRating(r, Array.from({ length: 10 }, (_, j) => ({ opponent: { rating: 1500, rd: 30 }, score: (j % 2) as 0 | 1 })));
  }
  assert.ok(r.rd >= DEFAULT_MIN_RD);
  assert.ok(Number.isFinite(r.rating) && Number.isFinite(r.volatility));
});

test("stays finite and sane at the extremes", () => {
  for (const rating of [0, 400, 1500, 2800, 4000]) {
    for (const rd of [30, 100, 350]) {
      for (const opp of [0, 1500, 4000]) {
        for (const score of [0, 0.5, 1] as const) {
          const after = updateRating({ rating, rd, volatility: 0.06 }, Array.from({ length: 30 }, () => ({ opponent: { rating: opp, rd: 30 }, score })));
          assert.ok(Number.isFinite(after.rating) && Number.isFinite(after.rd) && Number.isFinite(after.volatility), `${rating}/${rd} vs ${opp} ${score}`);
          assert.ok(after.rd >= DEFAULT_MIN_RD && after.rd <= DEFAULT_RD);
          assert.ok(after.volatility > 0 && after.volatility <= DEFAULT_MAX_VOLATILITY);
          assert.ok(Math.abs(after.rating - rating) <= DEFAULT_MAX_CHANGE);
        }
      }
    }
  }
});

test("a run of impossible results is capped: 30 wins over players 2500 points above", () => {
  const after = updateRating({ rating: 1500, rd: 60, volatility: 0.06 }, Array.from({ length: 30 }, () => ({ opponent: { rating: 4000, rd: 30 }, score: 1 as const })));
  assert.ok(after.rating > 1500 && after.rating <= 1500 + DEFAULT_MAX_CHANGE);
  assert.equal(updateRating({ rating: 1500, rd: 350, volatility: 0.06 }, Array.from({ length: 30 }, () => ({ opponent: { rating: 4000, rd: 30 }, score: 1 as const }))).rating, 1500 + DEFAULT_MAX_CHANGE);
  assert.equal(after.volatility, DEFAULT_MAX_VOLATILITY);
  // The guards leave ordinary results alone (Glickman's example above passes with them on).
  const plain = updateRating({ rating: 1500, rd: 200, volatility: 0.06 }, [{ opponent: { rating: 1400, rd: 30 }, score: 1 }], { maxChange: 1e9, maxVolatility: 1e9 });
  assert.deepEqual(updateRating({ rating: 1500, rd: 200, volatility: 0.06 }, [{ opponent: { rating: 1400, rd: 30 }, score: 1 }]), plain);
});

test("bad input is refused, not rated", () => {
  const ok: Rating = { rating: 1500, rd: 100, volatility: 0.06 };
  assert.throws(() => updateRating({ ...ok, rd: 0 }, []));
  assert.throws(() => updateRating({ ...ok, rating: NaN }, []));
  assert.throws(() => updateRating({ ...ok, volatility: 0 }, []));
  assert.throws(() => updateRating(ok, [{ opponent: { rating: NaN, rd: 50 }, score: 1 }]));
  assert.throws(() => updateRating(ok, [{ opponent: { rating: 1500, rd: 50 }, score: 0.7 as 1 }]));
  assert.throws(() => updateRating(ok, [], { tau: 0 }));
});

test("expected score and win probability", () => {
  near(expectedScore({ rating: 1500 }, { rating: 1500, rd: 80 }), 0.5, 1e-12);
  // From Glickman's example: E against 1400/30 is 0.639, against 1700/300 is 0.303.
  near(expectedScore({ rating: 1500 }, { rating: 1400, rd: 30 }), 0.639, 0.001);
  near(expectedScore({ rating: 1500 }, { rating: 1700, rd: 300 }), 0.303, 0.001);
  const a = { rating: 1640, rd: 70 };
  const b = { rating: 1480, rd: 200 };
  near(winProbability(a, b) + winProbability(b, a), 1, 1e-12);
  assert.ok(winProbability(a, b) > 0.5);
  // The less that's known, the closer to a coin toss.
  assert.ok(winProbability(a, { ...b, rd: 350 }) < winProbability(a, { ...b, rd: 30 }));
});

// ── Which matches count ────────────────────────────────────────────────────

const challenge = (over: Partial<ArenaChallengeFacts> = {}): ArenaChallengeFacts => ({
  id: 42,
  clubId: 1,
  status: "completed",
  posting: [10, 11],
  accepting: [20, 21],
  playedOn: "2026-11-20",
  scorePosting: 21,
  scoreAccepting: 17,
  retiredBy: null,
  enteredBy: 10,
  confirmedBy: 21,
  autoConfirmed: false,
  disputedAt: null,
  resolvedByAdmin: false,
  ...over,
});

test("an Arena challenge counts when one side entered the score and the other confirmed it", () => {
  assert.deepEqual(verifyArenaChallenge(challenge(), "badminton"), {
    match: { id: "arena:1:42", source: "arena", sport: "badminton", clubId: 1, date: "2026-11-20", sideA: [10, 11], sideB: [20, 21], winner: "a" },
  });
  assert.equal(verifyArenaChallenge(challenge({ scorePosting: 19, scoreAccepting: 21, enteredBy: 20, confirmedBy: 11 }), "badminton").match?.winner, "b");
});

test("disputed, voided, unfinished, unconfirmed and timer-confirmed challenges never count", () => {
  const why = (over: Partial<ArenaChallengeFacts>) => verifyArenaChallenge(challenge(over), "badminton").excluded;
  assert.equal(why({ status: "disputed", disputedAt: "2026-11-20T09:00:00Z" }), "disputed");
  // An admin settling a dispute doesn't make it verified by both sides.
  assert.equal(why({ disputedAt: "2026-11-20T09:00:00Z", resolvedByAdmin: true }), "disputed");
  assert.equal(why({ resolvedByAdmin: true }), "disputed");
  assert.equal(why({ status: "void" }), "void");
  for (const status of ["open", "accepted", "live", "awaiting", "cancelled", "expired", "lapsed"]) assert.equal(why({ status }), "not_completed", status);
  assert.equal(why({ retiredBy: "accepting", scorePosting: null, scoreAccepting: null }), "retired");
  assert.equal(why({ autoConfirmed: true, confirmedBy: null }), "auto_confirmed");
  assert.equal(why({ confirmedBy: null }), "not_confirmed_by_opponent");
  // Confirmed by the partner of the player who entered it: the same side twice.
  assert.equal(why({ enteredBy: 10, confirmedBy: 11 }), "not_confirmed_by_opponent");
  // Entered or confirmed by someone who didn't play (an admin, say).
  assert.equal(why({ enteredBy: 99 }), "not_confirmed_by_opponent");
  assert.equal(why({ confirmedBy: 99 }), "not_confirmed_by_opponent");
  assert.equal(why({ scorePosting: null }), "no_score");
  assert.equal(why({ playedOn: null }), "no_date");
  assert.equal(why({ accepting: [20, null] }), "bad_players");
  assert.equal(why({ accepting: [] }), "bad_players");
  assert.equal(why({ accepting: [10, 21] }), "bad_players");
});

const rrGame = (over: Partial<RoundRobinGameFacts> = {}): RoundRobinGameFacts => ({
  clubId: 1,
  drawId: 7,
  matchId: "r2m1",
  date: "2026-11-21",
  teamA: [10, 11],
  teamB: [20, 21],
  scoreA: 15,
  scoreB: 21,
  lockedAt: "2026-11-21T08:00:00Z",
  ...over,
});

test("a round robin game counts once an admin locked its score and every player has an account", () => {
  assert.deepEqual(verifyRoundRobinGame(rrGame(), "badminton").match, {
    id: "rr:1:7:r2m1",
    source: "round-robin",
    sport: "badminton",
    clubId: 1,
    date: "2026-11-21",
    sideA: [10, 11],
    sideB: [20, 21],
    winner: "b",
  });
  assert.equal(verifyRoundRobinGame(rrGame({ lockedAt: null }), "badminton").excluded, "not_completed");
  assert.equal(verifyRoundRobinGame(rrGame({ scoreA: null }), "badminton").excluded, "no_score");
  assert.equal(verifyRoundRobinGame(rrGame({ teamA: [10, null] }), "badminton").excluded, "bad_players");
  assert.equal(verifyRoundRobinGame(rrGame({ date: "21/11/2026" }), "badminton").excluded, "no_date");
  assert.equal(verifyRoundRobinGame(rrGame({ scoreA: 3, scoreB: 3 }), "futsal").match?.winner, "draw");
});

// ── Rating periods ────────────────────────────────────────────────────────

test("a rating period is a Monday-to-Sunday week", () => {
  assert.equal(periodStart(periodOf("2026-11-25")), "2026-11-23"); // a Wednesday → that week's Monday
  assert.equal(periodOf("2026-11-23"), periodOf("2026-11-29"));
  assert.equal(periodOf("2026-11-30"), periodOf("2026-11-29") + 1);
  assert.equal(periodStart(0), "1970-01-05");
  assert.equal(periodOf("1970-01-04"), -1);
  assert.throws(() => periodOf("2026-02-30"));
  assert.throws(() => periodOf("tomorrow"));
});

let seq = 0;
const game = (date: string, sideA: number[], sideB: number[], winner: VerifiedMatch["winner"] = "a", over: Partial<VerifiedMatch> = {}): VerifiedMatch => ({
  id: `arena:1:${++seq}`,
  source: "arena",
  sport: "badminton",
  clubId: 1,
  date,
  sideA,
  sideB,
  winner,
  ...over,
});

test("singles: one game in a week is exactly one Glicko-2 update for each player", () => {
  const ratings = rateMatches([game("2026-11-24", [1], [2])]);
  const expected = updateRating(newRating(), [{ opponent: { rating: 1500, rd: 350 }, score: 1 }]);
  near(ratings.get(1)!.rating, expected.rating, 1e-9);
  near(ratings.get(1)!.rd, expected.rd, 1e-9);
  near(ratings.get(1)!.rating - 1500, 1500 - ratings.get(2)!.rating, 1e-9);
  assert.deepEqual(
    { games: ratings.get(1)!.games, wins: ratings.get(1)!.wins, losses: ratings.get(2)!.losses, lastPlayed: ratings.get(2)!.lastPlayed, clubs: ratings.get(1)!.clubIds },
    { games: 1, wins: 1, losses: 1, lastPlayed: "2026-11-24", clubs: [1] },
  );
});

test("the same matches give the same ratings in any order, and a repeated match counts once", () => {
  const matches = [
    game("2026-11-02", [1, 2], [3, 4]),
    game("2026-11-03", [1, 3], [2, 4], "b"),
    game("2026-11-10", [1, 4], [2, 3]),
    game("2026-11-12", [5, 6], [1, 2]),
    game("2026-11-19", [3, 5], [4, 6], "b"),
    game("2026-11-24", [1, 6], [2, 5]),
  ];
  const a = rateMatches(matches);
  const b = rateMatches([...matches].reverse());
  const c = rateMatches([...matches, matches[2], matches[0]]);
  for (const id of [1, 2, 3, 4, 5, 6]) {
    assert.deepEqual(b.get(id), a.get(id));
    assert.deepEqual(c.get(id), a.get(id));
  }
});

test("games in one week are rated against the ratings the week began with", () => {
  // Player 1 beats 2 twice in a week: both games see 2 at 1500/350.
  const week = rateMatches([game("2026-11-23", [1], [2]), game("2026-11-27", [1], [2])]);
  const opponent = { rating: 1500, rd: 350 };
  const expected = updateRating(newRating(), [
    { opponent, score: 1 },
    { opponent, score: 1 },
  ]);
  near(week.get(1)!.rating, expected.rating, 1e-9);
  // Over two weeks the second game sees the ratings after the first.
  const twoWeeks = rateMatches([game("2026-11-23", [1], [2]), game("2026-11-30", [1], [2])]);
  assert.notEqual(twoWeeks.get(1)!.rating, week.get(1)!.rating);
});

test("doubles: partners move together, winners up and losers down, by the same amount for equal players", () => {
  const r = rateMatches([game("2026-11-24", [1, 2], [3, 4])]);
  near(r.get(1)!.rating, r.get(2)!.rating, 1e-9);
  near(r.get(3)!.rating, r.get(4)!.rating, 1e-9);
  assert.ok(r.get(1)!.rating > 1500 && r.get(3)!.rating < 1500);
  near(r.get(1)!.rating - 1500, 1500 - r.get(3)!.rating, 1e-9);
  // One doubles game says less about a player than one singles game.
  const singles = rateMatches([game("2026-11-24", [1], [3])]);
  assert.ok(r.get(1)!.rd > 0 && singles.get(1)!.rating - 1500 > 0);
});

test("the virtual opponent: a player's expected score is their team's", () => {
  const strong = { rating: 1900, rd: 60 };
  const weak = { rating: 1300, rd: 90 };
  const opponents = [
    { rating: 1650, rd: 70 },
    { rating: 1550, rd: 80 },
  ];
  // Team average 1600 against 1600: an even game for both partners.
  const vStrong = virtualOpponent(strong, [weak], opponents);
  const vWeak = virtualOpponent(weak, [strong], opponents);
  assert.equal(vStrong.rating, 1900);
  assert.equal(vWeak.rating, 1300);
  near(vStrong.rd, 0.5 * Math.sqrt(70 ** 2 + 80 ** 2 + 90 ** 2), 1e-9);
  // Singles: the virtual opponent is the opponent.
  assert.deepEqual(virtualOpponent(strong, [], [opponents[0]]), opponents[0]);
  assert.throws(() => virtualOpponent(strong, [], []));
});

test("carrying a weaker partner to a win is worth the same to both; losing as favourites costs more than as underdogs", () => {
  const start = new Map(
    [
      [1, 1800],
      [2, 1400],
      [3, 1500],
      [4, 1500],
    ].map(([id, rating]) => [id, { playerId: id, rating, rd: 80, volatility: 0.06, games: 20, wins: 10, losses: 10, draws: 0, lastPlayed: "2026-11-16", lastPeriod: periodOf("2026-11-16"), clubIds: [1] }]),
  );
  const even = rateMatches([game("2026-11-24", [1, 2], [3, 4])], { start });
  near(even.get(1)!.rating - 1800, even.get(2)!.rating - 1400, 1e-6);
  const favouritesLose = rateMatches([game("2026-11-24", [1, 3], [2, 4], "b")], { start });
  const underdogsLose = rateMatches([game("2026-11-24", [2, 4], [1, 3], "b")], { start });
  assert.ok(1800 - favouritesLose.get(1)!.rating > 1400 - underdogsLose.get(2)!.rating);
});

test("weeks off widen RD from a player's first game on; `asOf` brings everyone up to today", () => {
  const first = rateMatches([game("2026-09-01", [1], [2])]);
  const later = rateMatches([game("2026-09-01", [1], [2]), game("2026-11-24", [3], [4])]);
  // Without asOf a player stands as of their own last game.
  assert.equal(later.get(1)!.rd, first.get(1)!.rd);
  const today = rateMatches([game("2026-09-01", [1], [2]), game("2026-11-24", [3], [4])], { asOf: "2026-11-25" });
  assert.ok(today.get(1)!.rd > first.get(1)!.rd);
  assert.equal(today.get(1)!.rating, first.get(1)!.rating);
  assert.equal(today.get(3)!.rd, later.get(3)!.rd);
  // Idle weeks are applied once: continuing from a saved state gives the same as one run.
  const resumed = rateMatches([game("2026-12-01", [1], [2], "b", { id: "arena:1:late" })], { start: today });
  const oneRun = rateMatches([
    game("2026-09-01", [1], [2], "a", { id: "arena:1:early" }),
    game("2026-12-01", [1], [2], "b", { id: "arena:1:late" }),
  ]);
  const early = rateMatches([game("2026-09-01", [1], [2], "a", { id: "arena:1:early" })], { asOf: "2026-11-25" });
  const resumedFromEarly = rateMatches([game("2026-12-01", [1], [2], "b", { id: "arena:1:late" })], { start: early });
  near(resumedFromEarly.get(1)!.rating, oneRun.get(1)!.rating, 1e-9);
  near(resumedFromEarly.get(1)!.rd, oneRun.get(1)!.rd, 1e-9);
  assert.ok(resumed.get(1)!.games === 2);
});

test("a saved rating can't be rewound, and sports are never mixed", () => {
  const now = rateMatches([game("2026-11-24", [1], [2])]);
  assert.throws(() => rateMatches([game("2026-11-10", [1], [2])], { start: now }), /before player/);
  assert.throws(() => rateMatches([game("2026-11-24", [1], [2]), game("2026-11-24", [1], [2], "a", { sport: "pickleball" })]), /per sport/);
  assert.throws(() => rateMatches([game("2026-11-24", [1, 2], [2, 3])]), /twice/);
  assert.throws(() => rateMatches([game("2026-11-24", [1], [])]), /empty side/);
});

test("the total rating of equally uncertain players is conserved; the better player rises over a season", () => {
  // Player 1 wins 75% against each of five others; they split evenly among themselves.
  const matches: VerifiedMatch[] = [];
  let day = Date.UTC(2026, 0, 5);
  let n = 0;
  for (let week = 0; week < 26; week++) {
    for (let opp = 2; opp <= 6; opp++) {
      const date = new Date(day).toISOString().slice(0, 10);
      matches.push(game(date, [1], [opp], n % 4 === 3 ? "b" : "a"));
      matches.push(game(date, [opp], [opp === 6 ? 2 : opp + 1], (n + opp) % 2 ? "a" : "b"));
      n++;
    }
    day += 7 * 86_400_000;
  }
  const r = rateMatches(matches);
  for (let opp = 2; opp <= 6; opp++) assert.ok(r.get(1)!.rating > r.get(opp)!.rating + 100, `1 above ${opp}`);
  assert.ok(r.get(1)!.rd < 80);
  assert.equal(r.get(1)!.games, 130);
});

// ── Leaderboard views ─────────────────────────────────────────────────────

const today = "2026-11-25";
const player = (playerId: number, rating: number, over: Partial<BoardPlayer> = {}): BoardPlayer => ({
  playerId,
  rating,
  rd: 60,
  games: 30,
  lastPlayed: "2026-11-20",
  optedIn: true,
  junior: false,
  city: "Auckland",
  country: "NZ",
  birthYear: 1990,
  gender: "men",
  ...over,
});

test("age bands are for adults only", () => {
  assert.deepEqual([...AGE_BANDS], ["18-34", "35-44", "45-54", "55-64", "65+"]);
  assert.equal(ageBand(2008, 2026), "18-34");
  assert.equal(ageBand(2009, 2026), null);
  assert.equal(ageBand(1992, 2026), "18-34");
  assert.equal(ageBand(1991, 2026), "35-44");
  assert.equal(ageBand(1961, 2026), "65+");
  assert.equal(ageBand(null, 2026), null);
  assert.equal(ageBand(1800, 2026), null);
});

test("place names match without accents, case or spacing", () => {
  assert.equal(placeKey("Hà Nội"), "ha noi");
  assert.equal(placeKey("  HA  NOI "), "ha noi");
  assert.equal(placeKey("Đà Nẵng"), "da nang");
  assert.equal(placeKey("Whangārei"), placeKey("whangarei"));
  assert.equal(placeKey(null), "");
});

test("only opted-in adults appear: never a junior, never without opt-in", () => {
  const board = leaderboard(
    [player(1, 1700), player(2, 1900, { optedIn: false }), player(3, 2000, { junior: true }), player(4, 1600)],
    { scope: "world" },
    { today },
  );
  assert.deepEqual(board.ranked.map((r) => r.playerId), [1, 4]);
  assert.deepEqual(board.provisional, []);
});

test("new ratings are provisional and unranked; inactive players drop off", () => {
  assert.equal(isProvisional({ rd: 60, games: 4 }), true);
  assert.equal(isProvisional({ rd: 111, games: 40 }), true);
  assert.equal(isProvisional({ rd: 110, games: 5 }), false);
  const board = leaderboard(
    [player(1, 1700), player(2, 1950, { games: 3, rd: 240 }), player(3, 1800, { lastPlayed: "2026-05-01" }), player(4, 1500, { games: 0, lastPlayed: "2026-11-20" })],
    { scope: "world" },
    { today },
  );
  assert.deepEqual(board.ranked.map((r) => r.playerId), [1]);
  assert.deepEqual(board.provisional, [{ rank: 0, playerId: 2, rating: 1950, rd: 240, games: 3 }]);
});

test("city, country and world; age band and gender category", () => {
  const players = [
    player(1, 1800),
    player(2, 1750, { city: "auckland ", gender: "women" }),
    player(3, 1700, { city: "Wellington", birthYear: 1975 }),
    player(4, 1650, { city: "Hà Nội", country: "VN", gender: "women", birthYear: 1985 }),
    player(5, 1600, { city: null, country: null, birthYear: null, gender: null }),
  ];
  const ids = (view: Parameters<typeof leaderboard>[1]) => leaderboard(players, view, { today }).ranked.map((r) => r.playerId);
  assert.deepEqual(ids({ scope: "world" }), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids({ scope: "country", country: "nz" }), [1, 2, 3]);
  assert.deepEqual(ids({ scope: "city", country: "NZ", city: "AUCKLAND" }), [1, 2]);
  assert.deepEqual(ids({ scope: "city", country: "VN", city: "ha noi" }), [4]);
  assert.deepEqual(ids({ scope: "world", gender: "women" }), [2, 4]);
  assert.deepEqual(ids({ scope: "world", ageBand: "45-54" }), [3]);
  assert.deepEqual(ids({ scope: "country", country: "VN", gender: "women", ageBand: "35-44" }), [4]);
  assert.throws(() => leaderboard(players, { scope: "city", country: "NZ" }, { today }));
  assert.throws(() => leaderboard(players, { scope: "country" }, { today }));
});

test("ranks: best first, level ratings share a rank, the next rank skips", () => {
  const board = leaderboard([player(1, 1700.4), player(2, 1800), player(3, 1699.6, { rd: 50 }), player(4, 1500)], { scope: "world" }, { today });
  assert.deepEqual(
    board.ranked.map((r) => [r.rank, r.playerId, r.rating]),
    [
      [1, 2, 1800],
      [2, 3, 1700],
      [2, 1, 1700],
      [4, 4, 1500],
    ],
  );
});
