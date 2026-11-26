// Runs verified matches through Glicko-2 in rating periods.
//
// - Ratings are kept per sport: call `rateMatches` with one sport's matches.
// - A rating period is a calendar week (Monday to Sunday). Every game in a
//   week is rated against the ratings as they stood when the week began,
//   so the order of games inside a week doesn't matter and replaying the
//   same matches always gives the same ratings.
// - A player who sits a week out keeps their rating and gets a little less
//   certain (RD grows), from the week of their first game onwards.
//
// Doubles and team games: Glicko-2 rates one player against one opponent, so
// each player in a team game meets a "virtual opponent". The game's expected
// result comes from the two teams' average ratings; the virtual opponent is
// placed so that the player's own expected score equals their team's:
//
//   virtual rating = opponents' average + (own rating − own team's average)
//
// and its RD carries the uncertainty of everyone else in the game (the
// opponents and the player's partners), because all of it blurs what the
// result says about this one player. For singles this is exactly the
// opponent's own rating and RD.

import { DEFAULT_RD, newRating, updateRating, type GameResult, type Glicko2Options, type Opponent, type Rating, type Score } from "./glicko2.ts";
import type { VerifiedMatch } from "./matches.ts";

export const PERIOD_DAYS = 7;

const DAY_MS = 86_400_000;
/** Monday 5 January 1970: period 0 starts here, so periods are Monday-to-Sunday weeks. */
const FIRST_MONDAY_DAY = 4;

function dayNumber(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Not a date: ${date}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(ms);
  if (back.getUTCFullYear() !== Number(m[1]) || back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) {
    throw new Error(`Not a date: ${date}`);
  }
  return Math.round(ms / DAY_MS);
}

/** The rating period (week number) a date falls in. */
export function periodOf(date: string): number {
  return Math.floor((dayNumber(date) - FIRST_MONDAY_DAY) / PERIOD_DAYS);
}

/** The Monday a period starts on (YYYY-MM-DD). */
export function periodStart(period: number): string {
  return new Date((period * PERIOD_DAYS + FIRST_MONDAY_DAY) * DAY_MS).toISOString().slice(0, 10);
}

/** The virtual opponent one player meets in a team game (see the top of this file). */
export function virtualOpponent(self: Opponent, partners: readonly Opponent[], opponents: readonly Opponent[]): Opponent {
  if (opponents.length === 0) throw new Error("virtualOpponent: a game needs opponents.");
  const n = partners.length + 1;
  const m = opponents.length;
  const teamAverage = (self.rating + partners.reduce((s, p) => s + p.rating, 0)) / n;
  const opponentAverage = opponents.reduce((s, o) => s + o.rating, 0) / m;
  // Variance of (opponents' average − partners' share of the team average).
  const variance = opponents.reduce((s, o) => s + o.rd * o.rd, 0) / (m * m) + partners.reduce((s, p) => s + p.rd * p.rd, 0) / (n * n);
  return { rating: opponentAverage + (self.rating - teamAverage), rd: Math.sqrt(variance) };
}

export type PlayerRating = Rating & {
  playerId: number;
  /** Verified games that counted. */
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** The day of the latest game that counted. */
  lastPlayed: string;
  /** The last rating period this rating accounts for (the latest game's week, or later once idle weeks are applied). */
  lastPeriod: number;
  /** The clubs the games were played at. */
  clubIds: number[];
};

export type RateOptions = Glicko2Options & {
  /** Ratings to start from (a saved state), keyed by player. Players not in it start new. */
  start?: ReadonlyMap<number, PlayerRating>;
  /**
   * Bring every player up to this day's period: weeks without a game after a
   * player's last one widen their RD. Without it, each player stands as of
   * their own last game.
   */
  asOf?: string;
};

/**
 * Rates one sport's verified matches. Deterministic: the result depends only
 * on the set of matches (not their order in the array), the starting ratings
 * and the options. A match id that appears twice is counted once.
 */
export function rateMatches(matches: readonly VerifiedMatch[], options: RateOptions = {}): Map<number, PlayerRating> {
  const sports = new Set(matches.map((m) => m.sport));
  if (sports.size > 1) throw new Error("rateMatches: ratings are kept per sport; pass one sport's matches at a time.");

  const players = new Map<number, PlayerRating>();
  for (const [id, r] of options.start ?? []) players.set(id, { ...r, clubIds: [...r.clubIds] });

  const seen = new Set<string>();
  const byPeriod = new Map<number, VerifiedMatch[]>();
  for (const m of matches) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const p = periodOf(m.date);
    const list = byPeriod.get(p);
    if (list) list.push(m);
    else byPeriod.set(p, [m]);
  }

  /** Widen RD for the whole weeks a player sat out before `period`. */
  const idleUntil = (r: PlayerRating, period: number): Rating => {
    let rating: Rating = { rating: r.rating, rd: r.rd, volatility: r.volatility };
    const maxRd = options.maxRd ?? DEFAULT_RD;
    for (let p = r.lastPeriod + 1; p < period && rating.rd < maxRd; p++) rating = updateRating(rating, [], options);
    return rating;
  };

  for (const period of [...byPeriod.keys()].sort((a, b) => a - b)) {
    const games = byPeriod.get(period)!;
    // Everyone's rating as the week begins.
    const before = new Map<number, Rating>();
    const standing = (id: number): Rating => {
      let r = before.get(id);
      if (!r) {
        const known = players.get(id);
        if (known && known.lastPeriod > period) throw new Error(`rateMatches: match dated before player ${id}'s saved rating.`);
        r = known ? idleUntil(known, period) : newRating();
        before.set(id, r);
      }
      return r;
    };

    const results = new Map<number, { games: GameResult[]; wins: number; losses: number; draws: number; lastPlayed: string; clubs: Set<number> }>();
    const record = (id: number, opponent: Opponent, score: Score, m: VerifiedMatch) => {
      let entry = results.get(id);
      if (!entry) {
        entry = { games: [], wins: 0, losses: 0, draws: 0, lastPlayed: m.date, clubs: new Set() };
        results.set(id, entry);
      }
      entry.games.push({ opponent, score });
      if (score === 1) entry.wins++;
      else if (score === 0) entry.losses++;
      else entry.draws++;
      if (m.date > entry.lastPlayed) entry.lastPlayed = m.date;
      entry.clubs.add(m.clubId);
    };

    for (const m of games) {
      if (m.sideA.length === 0 || m.sideB.length === 0) throw new Error(`rateMatches: match ${m.id} has an empty side.`);
      if (new Set([...m.sideA, ...m.sideB]).size !== m.sideA.length + m.sideB.length) throw new Error(`rateMatches: match ${m.id} lists a player twice.`);
      const scoreA: Score = m.winner === "a" ? 1 : m.winner === "b" ? 0 : 0.5;
      const scoreB = (1 - scoreA) as Score;
      const a = m.sideA.map(standing);
      const b = m.sideB.map(standing);
      m.sideA.forEach((id, i) => record(id, virtualOpponent(a[i], a.filter((_, j) => j !== i), b), scoreA, m));
      m.sideB.forEach((id, i) => record(id, virtualOpponent(b[i], b.filter((_, j) => j !== i), a), scoreB, m));
    }

    for (const [id, r] of results) {
      const known = players.get(id);
      const next = updateRating(before.get(id)!, r.games, options);
      players.set(id, {
        playerId: id,
        ...next,
        games: (known?.games ?? 0) + r.games.length,
        wins: (known?.wins ?? 0) + r.wins,
        losses: (known?.losses ?? 0) + r.losses,
        draws: (known?.draws ?? 0) + r.draws,
        lastPlayed: known && known.lastPlayed > r.lastPlayed ? known.lastPlayed : r.lastPlayed,
        lastPeriod: period,
        clubIds: [...new Set([...(known?.clubIds ?? []), ...r.clubs])].sort((x, y) => x - y),
      });
    }
  }

  if (options.asOf) {
    const now = periodOf(options.asOf);
    for (const [id, r] of players) {
      if (r.lastPeriod >= now) continue;
      // The current week isn't over, so only the finished weeks in between count as idle.
      const idle = idleUntil(r, now);
      players.set(id, { ...r, ...idle, lastPeriod: now - 1 });
    }
  }
  return players;
}
