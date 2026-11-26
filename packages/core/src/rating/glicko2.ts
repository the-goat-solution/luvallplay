// Glicko-2 (Mark Glickman, "Example of the Glicko-2 system", 2012/2022
// revision). Pure maths, no I/O: build plan §8 item 2, global ratings.
//
// A rating is three numbers: `rating` (the skill estimate, 1500 for a new
// player), `rd` (rating deviation: how unsure the estimate is, 350 for a new
// player) and `volatility` (how erratic the player's results are). Ratings
// move once per rating period, from all of that period's results at once.
//
// Club points (Wolf Points) reward turning up, so they aren't comparable
// between clubs; this is the skill number that is (§8).

export type Rating = {
  rating: number;
  rd: number;
  volatility: number;
};

/** What a rating update needs to know about one opponent. */
export type Opponent = { rating: number; rd: number };

/** 1 = win, 0.5 = draw, 0 = loss. */
export type Score = 0 | 0.5 | 1;

export type GameResult = { opponent: Opponent; score: Score };

export type Glicko2Options = {
  /** System constant τ: how fast volatility may change. Glickman suggests 0.3–1.2. */
  tau?: number;
  /** RD never grows past this (a long-absent player is as unsure as a new one, no more). */
  maxRd?: number;
  /** RD never shrinks below this, so a settled player's rating can still move. */
  minRd?: number;
  /** Volatility never rises past this. */
  maxVolatility?: number;
  /** The most a rating can move in one rating period, up or down. */
  maxChange?: number;
};

export const DEFAULT_RATING = 1500;
export const DEFAULT_RD = 350;
export const DEFAULT_VOLATILITY = 0.06;
export const DEFAULT_TAU = 0.5;
/** Floor for RD: without one, hundreds of games freeze a rating. */
export const DEFAULT_MIN_RD = 30;

/**
 * Two guards the paper doesn't have. A run of "impossible" results (a
 * 1500 beating a 2500 ten times in a week) makes the expected-score terms
 * vanish, and the textbook formulas then send volatility and the rating to
 * absurd values. Such a run is far likelier to be a wrong account or made-up
 * scores than real play, so volatility is capped and a rating moves by at
 * most MAX_CHANGE in one period. Neither guard touches ordinary results.
 */
export const DEFAULT_MAX_VOLATILITY = 0.1;
export const DEFAULT_MAX_CHANGE = 700;

/** Converts between the public scale (1500 / 350) and Glicko-2's internal one. */
export const GLICKO2_SCALE = 173.7178;

const CONVERGENCE = 1e-6;
const MAX_ITERATIONS = 100;

export function newRating(): Rating {
  return { rating: DEFAULT_RATING, rd: DEFAULT_RD, volatility: DEFAULT_VOLATILITY };
}

function isRating(r: Rating): boolean {
  return Number.isFinite(r.rating) && Number.isFinite(r.rd) && r.rd > 0 && Number.isFinite(r.volatility) && r.volatility > 0;
}

/** g(φ): how much an opponent's own uncertainty dampens a result against them. */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** E(μ, μj, φj): the expected score against an opponent, on the internal scale. */
function expected(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * The chance (0–1) that `player` beats `opponent`, allowing for the
 * opponent's uncertainty (the E used inside the update). Not symmetric: it
 * ignores the player's own RD. For a prediction between two uncertain
 * players use `winProbability`.
 */
export function expectedScore(player: { rating: number }, opponent: Opponent): number {
  return expected((player.rating - DEFAULT_RATING) / GLICKO2_SCALE, (opponent.rating - DEFAULT_RATING) / GLICKO2_SCALE, opponent.rd / GLICKO2_SCALE);
}

/** The chance that `a` beats `b`, allowing for both players' uncertainty. Symmetric: p(a,b) + p(b,a) = 1. */
export function winProbability(a: Opponent, b: Opponent): number {
  const phi = Math.sqrt(a.rd * a.rd + b.rd * b.rd) / GLICKO2_SCALE;
  return 1 / (1 + Math.exp((-g(phi) * (a.rating - b.rating)) / GLICKO2_SCALE));
}

/**
 * One rating period for one player (steps 2–8 of Glickman's paper).
 *
 * `results` are all of the player's games in the period, each against the
 * opponent's rating as it stood BEFORE the period. With no games only the
 * RD grows (step 6 alone): the rating and volatility stay as they were.
 */
export function updateRating(player: Rating, results: readonly GameResult[], options: Glicko2Options = {}): Rating {
  const tau = options.tau ?? DEFAULT_TAU;
  const maxRd = options.maxRd ?? DEFAULT_RD;
  const minRd = options.minRd ?? DEFAULT_MIN_RD;
  if (!isRating(player)) throw new Error("updateRating: the player's rating isn't a valid Glicko-2 rating.");
  if (!(tau > 0)) throw new Error("updateRating: tau must be positive.");

  // Step 2: to the internal scale.
  const mu = (player.rating - DEFAULT_RATING) / GLICKO2_SCALE;
  const phi = player.rd / GLICKO2_SCALE;
  const sigma = player.volatility;
  const clampRd = (rd: number) => Math.min(maxRd, Math.max(minRd, rd));

  if (results.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: clampRd(phiStar * GLICKO2_SCALE), volatility: sigma };
  }

  // Steps 3 and 4: the estimated variance v and the improvement Δ.
  let vInverse = 0;
  let sum = 0;
  for (const { opponent, score } of results) {
    if (!Number.isFinite(opponent.rating) || !(opponent.rd >= 0) || !Number.isFinite(opponent.rd)) {
      throw new Error("updateRating: an opponent's rating isn't valid.");
    }
    if (score !== 0 && score !== 0.5 && score !== 1) throw new Error("updateRating: a score must be 0, 0.5 or 1.");
    const muJ = (opponent.rating - DEFAULT_RATING) / GLICKO2_SCALE;
    const phiJ = opponent.rd / GLICKO2_SCALE;
    const gJ = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    vInverse += gJ * gJ * e * (1 - e);
    sum += gJ * (score - e);
  }
  const v = 1 / vInverse;
  const delta = v * sum;

  // Step 5: the new volatility σ′, by the Illinois variant of regula falsi.
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0 && k < MAX_ITERATIONS) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; Math.abs(B - A) > CONVERGENCE && i < MAX_ITERATIONS; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const sigmaPrime = Math.min(Math.exp(A / 2), Math.max(sigma, options.maxVolatility ?? DEFAULT_MAX_VOLATILITY));

  // Steps 6 and 7: the pre-period deviation φ*, then the new φ′ and μ′.
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * sum;

  // Step 8: back to the public scale.
  const maxChange = options.maxChange ?? DEFAULT_MAX_CHANGE;
  const change = Math.max(-maxChange, Math.min(maxChange, (muPrime - mu) * GLICKO2_SCALE));
  return {
    rating: player.rating + change,
    rd: clampRd(phiPrime * GLICKO2_SCALE),
    volatility: sigmaPrime,
  };
}

/**
 * A 95% range for the player's true skill: rating ± 2 RD (Glickman's
 * recommended way to show a rating).
 */
export function ratingInterval(r: { rating: number; rd: number }): { low: number; high: number } {
  return { low: r.rating - 2 * r.rd, high: r.rating + 2 * r.rd };
}
