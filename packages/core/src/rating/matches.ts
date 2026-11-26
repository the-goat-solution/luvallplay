// Which games count towards a global rating (build plan §8 item 2): only
// VERIFIED matches. An Arena challenge counts when both sides checked in,
// one side entered the score and the other side confirmed it. A round robin
// game counts when a club admin entered and locked its score. Anything
// disputed, voided, unfinished or waved through by a timer is left out.
//
// Pure: callers read the rows and hand them over; nothing here touches a
// database.

export type MatchSource = "arena" | "round-robin";

/** One verified game, ready for the rating engine. */
export type VerifiedMatch = {
  /** Stable and unique across sources, e.g. "arena:1:42" (club 1, challenge 42). */
  id: string;
  source: MatchSource;
  /** Ratings are kept per sport (§6.7). */
  sport: string;
  /** The club it was played at. */
  clubId: number;
  /** The day it was played (the club's local date, YYYY-MM-DD). */
  date: string;
  /** Account ids. One player each for singles, two for doubles, more for team sports. */
  sideA: number[];
  sideB: number[];
  winner: "a" | "b" | "draw";
};

export type Exclusion =
  | "not_completed"
  | "disputed"
  | "void"
  | "retired"
  | "auto_confirmed"
  | "not_confirmed_by_opponent"
  | "no_score"
  | "no_date"
  | "bad_players";

export type Verdict = { match: VerifiedMatch; excluded?: undefined } | { match?: undefined; excluded: Exclusion };

/** The columns of an Arena challenge that decide whether it counts. */
export type ArenaChallengeFacts = {
  id: number;
  clubId: number;
  status: string;
  /** Posting side, then accepting side: account ids. */
  posting: (number | null)[];
  accepting: (number | null)[];
  playedOn: string | null;
  scorePosting: number | null;
  scoreAccepting: number | null;
  retiredBy: string | null;
  enteredBy: number | null;
  confirmedBy: number | null;
  autoConfirmed: boolean;
  /** Set once a result was ever disputed, even if an admin settled it later. */
  disputedAt: string | null;
  resolvedByAdmin: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanSides(a: (number | null)[], b: (number | null)[]): { a: number[]; b: number[] } | null {
  const ok = (ids: (number | null)[]): ids is number[] => ids.length > 0 && ids.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0);
  if (!ok(a) || !ok(b)) return null;
  // Nobody plays themselves, and nobody is listed twice.
  if (new Set([...a, ...b]).size !== a.length + b.length) return null;
  return { a: [...a], b: [...b] };
}

/**
 * An Arena challenge as a verified match, or the reason it doesn't count.
 *
 * Counts only when: completed; never disputed (an admin-settled dispute is
 * still a dispute); played to a finish (no retirement); the score was
 * entered by a player on one side and confirmed by a player on the OTHER
 * side. A result confirmed by the timer because the other side never
 * answered is not "confirmed by both sides", so it's left out.
 */
export function verifyArenaChallenge(c: ArenaChallengeFacts, sport: string): Verdict {
  if (c.status === "void") return { excluded: "void" };
  if (c.status === "disputed" || c.disputedAt || c.resolvedByAdmin) return { excluded: "disputed" };
  if (c.status !== "completed") return { excluded: "not_completed" };
  if (c.retiredBy) return { excluded: "retired" };
  if (c.autoConfirmed) return { excluded: "auto_confirmed" };
  const sides = cleanSides(c.posting, c.accepting);
  if (!sides) return { excluded: "bad_players" };
  const enteredOnA = c.enteredBy !== null && sides.a.includes(c.enteredBy);
  const enteredOnB = c.enteredBy !== null && sides.b.includes(c.enteredBy);
  const confirmedOnA = c.confirmedBy !== null && sides.a.includes(c.confirmedBy);
  const confirmedOnB = c.confirmedBy !== null && sides.b.includes(c.confirmedBy);
  if (!((enteredOnA && confirmedOnB) || (enteredOnB && confirmedOnA))) return { excluded: "not_confirmed_by_opponent" };
  if (c.scorePosting === null || c.scoreAccepting === null) return { excluded: "no_score" };
  if (!c.playedOn || !ISO_DATE.test(c.playedOn)) return { excluded: "no_date" };
  return {
    match: {
      id: `arena:${c.clubId}:${c.id}`,
      source: "arena",
      sport,
      clubId: c.clubId,
      date: c.playedOn,
      sideA: sides.a,
      sideB: sides.b,
      winner: c.scorePosting > c.scoreAccepting ? "a" : c.scorePosting < c.scoreAccepting ? "b" : "draw",
    },
  };
}

/** One round robin game whose score a club admin entered and locked. */
export type RoundRobinGameFacts = {
  clubId: number;
  drawId: number;
  matchId: string;
  /** The day of the round robin (the club's local date). */
  date: string | null;
  /** Account ids. A player without an account (a guest, a name only) is null. */
  teamA: (number | null)[];
  teamB: (number | null)[];
  scoreA: number | null;
  scoreB: number | null;
  /** When an admin locked the score; null while it can still change. */
  lockedAt: string | null;
};

/**
 * A round robin game as a verified match. It counts when an admin has locked
 * a score and every player on both teams has an account: a game with a guest
 * in it can't be rated fairly, so the whole game is left out.
 */
export function verifyRoundRobinGame(g: RoundRobinGameFacts, sport: string): Verdict {
  if (!g.lockedAt) return { excluded: "not_completed" };
  if (g.scoreA === null || g.scoreB === null) return { excluded: "no_score" };
  const sides = cleanSides(g.teamA, g.teamB);
  if (!sides) return { excluded: "bad_players" };
  if (!g.date || !ISO_DATE.test(g.date)) return { excluded: "no_date" };
  return {
    match: {
      id: `rr:${g.clubId}:${g.drawId}:${g.matchId}`,
      source: "round-robin",
      sport,
      clubId: g.clubId,
      date: g.date,
      sideA: sides.a,
      sideB: sides.b,
      winner: g.scoreA > g.scoreB ? "a" : g.scoreA < g.scoreB ? "b" : "draw",
    },
  };
}
