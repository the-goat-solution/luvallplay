import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPS,
  LADDER,
  LEAGUE_START,
  TOP_INDEX,
  WOODEN_INDEX,
  achievementsFrom,
  assignSeats,
  crownStillHeld,
  indexForWp,
  isValidGameScore,
  repeatMatchupBlocker,
  polish,
  progressToNext,
  rankName,
  replayChallenges,
  type ReplayChallenge,
} from "../lib/ranks.ts";

test("ladder: 35 steps, kit add-ons between rackets, increasing thresholds", () => {
  assert.equal(LADDER.length, 35);
  for (let i = 1; i < LADDER.length; i++) assert.ok(LADDER[i].wp > LADDER[i - 1].wp, `step ${i}`);
  assert.equal(rankName(LADDER[0], "en"), "Plastic Shuttle");
  assert.equal(rankName(LADDER[1], "vi"), "Cầu Lông");
  const wooden = LADDER.filter((r) => r.item === "wooden");
  assert.deepEqual(wooden.map((r) => r.kit), [[], ["shoes"], ["shoes", "jersey"]]);
  assert.equal(rankName(wooden[2], "en"), "Wooden Racket + Shoes + Jersey");
  assert.equal(LADDER.filter((r) => r.item === "silver").length, 4);
  assert.equal(rankName(LADDER[TOP_INDEX], "vi"), "Vợt Kim Cương + Giày + Áo Club + Túi Vợt + Cúp Vàng");
  assert.equal(LADDER.find((r) => r.item === "pro")?.item, "pro");
  assert.equal(rankName(LADDER.find((r) => r.item === "pro")!, "vi"), "Vợt Đỉnh");
  assert.equal(LADDER[LEAGUE_START[4]].item, "diamond");
  assert.ok(LADDER[LEAGUE_START[4]].wp >= 800, "Diamond is meant to be hard");
  assert.equal(LADDER[TOP_INDEX].wp, 1200, "the top is 1200 WP");
});

test("indexForWp and progress", () => {
  assert.equal(indexForWp(0), 0);
  assert.equal(indexForWp(7), 0);
  assert.equal(indexForWp(8), 1);
  assert.equal(indexForWp(30), WOODEN_INDEX);
  assert.equal(indexForWp(100000), TOP_INDEX);
  assert.equal(progressToNext(4, 0), 0.5);
  assert.equal(progressToNext(5000, TOP_INDEX), 1);
});

test("BWF scores: 21 by two, extend to 30, golden point", () => {
  assert.ok(isValidGameScore(21, 0));
  assert.ok(isValidGameScore(19, 21));
  assert.ok(!isValidGameScore(21, 20));
  assert.ok(isValidGameScore(22, 20));
  assert.ok(!isValidGameScore(23, 20));
  assert.ok(isValidGameScore(29, 27));
  assert.ok(isValidGameScore(30, 29));
  assert.ok(isValidGameScore(28, 30));
  assert.ok(!isValidGameScore(30, 27));
  assert.ok(!isValidGameScore(31, 29));
  assert.ok(!isValidGameScore(15, 10));
  assert.ok(!isValidGameScore(21, 21));
  assert.ok(!isValidGameScore(21.5, 3));
});

test("polish: lower leagues never tarnish", () => {
  const p = polish(10, [], "2027-06-01");
  assert.equal(p.shown, 10);
  assert.equal(p.tarnishing, false);
});

test("polish: precious ranks tarnish after the upkeep window, slip monthly, keep the league floor, and come back", () => {
  const golden = LADDER.findIndex((r) => r.item === "golden" && r.kit.length === 2);
  const events = [{ date: "2027-01-01", points: 6 }];
  // Still inside 60 days of the last points.
  assert.equal(polish(golden, events, "2027-02-15").tarnishing, false);
  // Window empties on day 60: tarnishing, no slip yet.
  const t0 = polish(golden, events, "2027-03-02");
  assert.equal(t0.tarnishing, true);
  assert.equal(t0.shown, golden);
  // 30 more days below: one rank down.
  assert.equal(polish(golden, events, "2027-04-02").shown, golden - 1);
  // Far later: never below the start of the Precious league.
  assert.equal(polish(golden, events, "2030-01-01").shown, LEAGUE_START[3]);
  // Playing again restores the rank at once.
  const back = polish(golden, [...events, { date: "2030-01-01", points: 5 }], "2030-01-01");
  assert.equal(back.shown, golden);
  assert.equal(back.tarnishing, false);
});

test("Wolf seats: 90-day WP, one Alpha and three Silver", () => {
  const seats = assignSeats([
    { id: 1, earned: WOODEN_INDEX, wp90: 40, wpTotal: 50 },
    { id: 2, earned: WOODEN_INDEX + 3, wp90: 30, wpTotal: 200 },
    { id: 3, earned: 1, wp90: 3, wpTotal: 12 },
    { id: 4, earned: WOODEN_INDEX, wp90: 30, wpTotal: 60 },
    { id: 5, earned: WOODEN_INDEX, wp90: 10, wpTotal: 60 },
    { id: 6, earned: WOODEN_INDEX, wp90: 5, wpTotal: 60 },
    { id: 7, earned: WOODEN_INDEX, wp90: 0, wpTotal: 999 },
  ]);
  assert.equal(seats.get(1), "alpha");
  assert.equal(seats.get(2), "silver");
  assert.equal(seats.get(4), "silver");
  assert.equal(seats.get(5), "silver");
  assert.equal(seats.has(3), false, "fewer 90-day WP than the top four");
  assert.equal(seats.has(6), false, "only three Silver seats");
  assert.equal(seats.has(7), false, "no points in 90 days");
});

const ch = (id: number, date: string, posting: [number, number, number], accepting: [number, number, number], ps: number, as: number, retiredBy: "posting" | "accepting" | null = null): ReplayChallenge => ({
  id,
  at: `${date}T10:00:0${id % 10}Z`,
  date,
  posting: { pairId: posting[0], players: [posting[1], posting[2]] },
  accepting: { pairId: accepting[0], players: [accepting[1], accepting[2]] },
  postingScore: retiredBy ? null : ps,
  acceptingScore: retiredBy ? null : as,
  retiredBy,
});

test("replay: base points, new rival, giant-killer and no points for a loss", () => {
  // Players 1,2 are Pro Racket (~400 WP); 3,4 are new.
  const base = (p: number) => (p <= 2 ? 400 : 0);
  const { results } = replayChallenges([ch(1, "2027-01-05", [10, 1, 2], [20, 3, 4], 18, 21)], base);
  const r3 = results.find((r) => r.playerId === 3)!;
  assert.equal(r3.won, true);
  assert.equal(r3.base, 2);
  assert.equal(r3.giantKiller, 2);
  assert.equal(r3.newRival, 1);
  assert.equal(r3.total, 5);
  const r1 = results.find((r) => r.playerId === 1)!;
  assert.equal(r1.won, false);
  assert.equal(r1.total, 1, "the losers still get New rival");
});

test("replay: new rival only once, hot streak after three wins, retirements give a plain win", () => {
  const z = () => 0;
  const games = [
    ch(1, "2027-01-01", [10, 1, 2], [20, 3, 4], 21, 10),
    ch(2, "2027-01-02", [10, 1, 2], [21, 5, 6], 21, 10),
    ch(3, "2027-01-03", [10, 1, 2], [22, 7, 8], 21, 10),
    ch(4, "2027-01-04", [10, 1, 2], [20, 3, 4], 21, 10),
    ch(5, "2027-01-05", [10, 1, 2], [23, 9, 11], 0, 0, "accepting"),
  ];
  const { results } = replayChallenges(games, z);
  const p1 = results.filter((r) => r.playerId === 1);
  assert.deepEqual(p1.map((r) => r.newRival), [1, 1, 1, 0, 0]);
  assert.deepEqual(p1.map((r) => r.hotStreak), [0, 0, 0, 1, 0]);
  assert.equal(p1[4].won, true);
  assert.equal(p1[4].total, 2, "a retirement is a plain 2-point win");
});

test("replay: the crown starts with Wooden+ pairs, transfers with a bounty, and lapses", () => {
  const wp = () => 50; // everyone at Wooden Racket
  const games = [
    ch(1, "2027-01-01", [10, 1, 2], [20, 3, 4], 21, 15),
    ch(2, "2027-01-03", [30, 5, 6], [10, 1, 2], 21, 19),
  ];
  const { results, crown } = replayChallenges(games, wp);
  assert.equal(results.find((r) => r.challengeId === 1 && r.playerId === 1)!.crownBounty, 0, "the first crown has no bounty");
  assert.equal(results.find((r) => r.challengeId === 2 && r.playerId === 5)!.crownBounty, 4);
  assert.equal(crown?.pairId, 30);
  assert.equal(crownStillHeld(crown, "2027-01-10", new Map())?.pairId, 30);
  assert.equal(crownStillHeld(crown, "2027-01-30", new Map()), null, "idle for more than 14 days");
  assert.equal(crownStillHeld(crown, "2027-01-05", new Map([[30, "2027-01-04"]])), null, "the pair split");
});

test("achievements from history", () => {
  const g = (i: number, won: boolean, own: number, other: number, extra: Partial<{ partner: number; opp: string; gk: boolean }> = {}) => ({
    challengeId: i,
    date: `2027-01-${String(i).padStart(2, "0")}`,
    won,
    retired: false,
    own,
    other,
    partnerId: extra.partner ?? 2,
    opponentPairKey: extra.opp ?? `o${i}`,
    giantKiller: extra.gk ?? false,
    crownBounty: false,
  });
  const a = achievementsFrom([g(1, false, 10, 21), g(2, true, 30, 29), g(3, true, 22, 20, { gk: true }), g(4, true, 21, 3), g(5, true, 21, 3), g(6, true, 21, 3), g(7, true, 21, 3)], { ironWolf: null, polished: null });
  assert.equal(a["first-blood"], "2027-01-02");
  assert.equal(a["golden-point"], "2027-01-02");
  assert.equal(a["nail-biter"], "2027-01-02");
  assert.equal(a["giant-killer"], "2027-01-03");
  assert.equal(a["hot-streak"], "2027-01-06");
  assert.equal(a["social-wolf"], undefined);
});

test("caps: revenge is allowed, the same four can't trade wins without end", () => {
  const today = "2027-03-10";
  assert.equal(repeatMatchupBlocker([], today), null);
  // A game and a revenge the same day are fine, and so is a third (the decider).
  assert.equal(repeatMatchupBlocker([today], today), null);
  assert.equal(repeatMatchupBlocker([today, today], today), null);
  assert.equal(repeatMatchupBlocker(Array(CAPS.sameFourPerDay).fill(today), today), "cap_today");
  // Games spread over the month: still fine below the monthly cap, blocked at it.
  const spread = (n: number) => Array.from({ length: n }, (_, i) => `2027-02-${String(20 + (i % 8)).padStart(2, "0")}`);
  assert.equal(repeatMatchupBlocker(spread(CAPS.sameFourPer30Days - 1), today), null);
  assert.equal(repeatMatchupBlocker(spread(CAPS.sameFourPer30Days), today), "cap_month");
  // Games older than 30 days no longer count.
  assert.equal(repeatMatchupBlocker(Array(20).fill("2027-01-01"), today), null);
});

test("caps: there is no per-player daily limit any more", () => {
  assert.deepEqual(Object.keys(CAPS).sort(), ["sameFourPer30Days", "sameFourPerDay"]);
});
