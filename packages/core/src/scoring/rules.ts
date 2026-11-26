// Per-sport scoring rules (build plan §6.7): scoring is DATA in a sport
// pack, not code. Each sport says how one game (or set, or match) is won;
// the checks below work for every sport from that description.
//
// The Arena accepted only badminton scores (`isValidGameScore` in
// ../ranks.ts). The badminton rules here give exactly the same answers
// (tested score by score), so the Arena can switch to them with no change
// for a badminton club.

/** First to `target`, leading by `winBy`; at `cap` the next point wins. */
export type RallyGame = {
  kind: "rally";
  target: number;
  winBy: number;
  /** The score that wins outright however close it is; null when play goes on until someone leads by `winBy`. */
  cap: number | null;
};

/** A final score counted in goals or points, any numbers. */
export type GoalsGame = {
  kind: "goals";
  /** Whether a level score can stand as the result. */
  draws: boolean;
  /** A sanity limit for typing mistakes, not a rule of the sport. */
  max: number;
};

export type GameRules = RallyGame | GoalsGame;

export type ScoringRules = {
  sport: string;
  /** What one scored unit is called: a badminton "game", a tennis or volleyball "set", a futsal "match". */
  unit: "game" | "set" | "match";
  game: GameRules;
  /** The deciding game, when it's played to a different score (volleyball's fifth set to 15). */
  decider?: GameRules;
  /** Match lengths the sport is played in (best of 1, 3 or 5), most usual first. */
  bestOf: readonly number[];
};

const rally = (target: number, winBy: number, cap: number | null): RallyGame => ({ kind: "rally", target, winBy, cap });

/**
 * The sports with a scoring pack. Adding a sport is adding an entry (and
 * its wording in English and Vietnamese, §6.7), not new code.
 */
export const SCORING = {
  // BWF: rally points to 21, win by 2, 30 wins at 29-all.
  badminton: { sport: "badminton", unit: "game", game: rally(21, 2, 30), bestOf: [3, 1] },
  // USA Pickleball: to 11, win by 2, no cap.
  pickleball: { sport: "pickleball", unit: "game", game: rally(11, 2, null), bestOf: [3, 1] },
  // ITTF: to 11, win by 2, no cap.
  "table-tennis": { sport: "table-tennis", unit: "game", game: rally(11, 2, null), bestOf: [5, 3, 7, 1] },
  // WSF point-a-rally: to 11, win by 2, no cap.
  squash: { sport: "squash", unit: "game", game: rally(11, 2, null), bestOf: [5, 3, 1] },
  // FIVB: sets to 25, win by 2, no cap; the deciding set to 15.
  volleyball: { sport: "volleyball", unit: "set", game: rally(25, 2, null), decider: rally(15, 2, null), bestOf: [5, 3, 1] },
  // A tie-break set: 6 games leading by 2, or 7-5, or 7-6 on the tie-break.
  tennis: { sport: "tennis", unit: "set", game: rally(6, 2, 7), bestOf: [3, 1, 5] },
  futsal: { sport: "futsal", unit: "match", game: { kind: "goals", draws: true, max: 99 }, bestOf: [1] },
  football: { sport: "football", unit: "match", game: { kind: "goals", draws: true, max: 99 }, bestOf: [1] },
  // Overtime is played until someone wins.
  basketball: { sport: "basketball", unit: "match", game: { kind: "goals", draws: false, max: 300 }, bestOf: [1] },
} as const satisfies Record<string, ScoringRules>;

export type ScoredSport = keyof typeof SCORING;
export const SCORED_SPORTS = Object.keys(SCORING) as ScoredSport[];

/** A sport's scoring rules, or null when the sport has no pack yet. */
export function scoringFor(sport: string): ScoringRules | null {
  return Object.hasOwn(SCORING, sport) ? SCORING[sport as ScoredSport] : null;
}

const isCount = (n: number) => Number.isInteger(n) && n >= 0;

/** Whether `a`–`b` can be the final score of one game under `game`. */
export function isValidGame(game: GameRules, a: number, b: number): boolean {
  if (!isCount(a) || !isCount(b)) return false;
  if (game.kind === "goals") return a <= game.max && b <= game.max && (game.draws || a !== b);
  if (a === b) return false;
  const win = Math.max(a, b);
  const lose = Math.min(a, b);
  if (win < game.target) return false;
  if (win === game.target) return lose <= game.target - game.winBy;
  if (game.cap !== null) {
    if (win > game.cap) return false;
    // At the cap the next point wins, so the loser is within `winBy` of it.
    if (win === game.cap) return lose >= game.cap - game.winBy;
  }
  // Past the target: play stopped the moment someone led by `winBy`.
  return win - lose === game.winBy;
}

/** The side that won a game, or "draw" (only possible where the sport allows one). */
export function gameWinner(a: number, b: number): "a" | "b" | "draw" {
  return a > b ? "a" : a < b ? "b" : "draw";
}

export type GameScore = readonly [a: number, b: number];

export type MatchVerdict =
  | { ok: true; winner: "a" | "b" | "draw"; gamesA: number; gamesB: number }
  | { ok: false; reason: "bad_format" | "too_few_games" | "too_many_games" | "bad_game"; game?: number };

/**
 * Checks a whole match: each game is a valid score, the winner took the
 * majority of a best-of-`bestOf`, and play stopped once the match was won
 * (no games after the deciding one). `bestOf` defaults to the sport's usual
 * length and must be one the sport is played in.
 */
export function checkMatch(rules: ScoringRules, games: readonly GameScore[], bestOf: number = rules.bestOf[0]): MatchVerdict {
  if (!rules.bestOf.includes(bestOf) || bestOf % 2 === 0) return { ok: false, reason: "bad_format" };
  const needed = (bestOf + 1) / 2;
  if (games.length === 0) return { ok: false, reason: "too_few_games" };
  if (games.length > bestOf) return { ok: false, reason: "too_many_games" };
  let gamesA = 0;
  let gamesB = 0;
  for (let i = 0; i < games.length; i++) {
    if (gamesA === needed || gamesB === needed) return { ok: false, reason: "too_many_games" };
    const [a, b] = games[i];
    const deciding = bestOf > 1 && i === bestOf - 1;
    if (!isValidGame(deciding && rules.decider ? rules.decider : rules.game, a, b)) return { ok: false, reason: "bad_game", game: i };
    const w = gameWinner(a, b);
    if (w === "draw") {
      // A drawn result is the whole match (goal sports are single matches).
      return bestOf === 1 ? { ok: true, winner: "draw", gamesA: 0, gamesB: 0 } : { ok: false, reason: "bad_game", game: i };
    }
    if (w === "a") gamesA++;
    else gamesB++;
  }
  if (gamesA < needed && gamesB < needed) return { ok: false, reason: "too_few_games" };
  return { ok: true, winner: gamesA > gamesB ? "a" : "b", gamesA, gamesB };
}

/**
 * Whether one typed score pair is acceptable for a sport: the check the
 * Arena makes on a challenge result (one game, one set or one match).
 * A sport without a pack accepts nothing.
 */
export function isValidScoreFor(sport: string, a: number, b: number): boolean {
  const rules = scoringFor(sport);
  return rules ? isValidGame(rules.game, a, b) : false;
}
