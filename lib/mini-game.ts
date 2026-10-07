// Three Wolves mini game: doubles round robin. Every team plays every other
// team once. A win is worth 2 points, a loss 0. Shared by the page and the
// API; the tiered roster that drives the draw lives in mini-game-roster.ts
// and stays on the server.

export const WIN_POINTS = 2;
export const LOSS_POINTS = 0;
export const TEAM_LOCK_DAYS = 7;
export const MAX_SCORE = 99;

export type Team = {
  id: number;
  players: [string, string];
};

export type Match = {
  id: string;
  round: number;
  /** 1-based number in the overall running order. */
  number: number;
  teamA: number;
  teamB: number;
};

/** A confirmed, locked-in score. */
export type Score = { a: number; b: number };

/** State of the current draw as served by /api/mini-game. */
export type MiniGameState = {
  players: string[];
  draw: {
    id: number;
    teams: Team[];
    matches: Match[];
    scores: Record<string, Score>;
    createdAt: string;
    lockedUntil: string;
  } | null;
};

/**
 * Round-robin schedule using the circle method. Every round each team plays
 * exactly once (with an even team count), so a round can run across several
 * courts at the same time and nobody sits out twice in a row.
 */
export function buildSchedule(teams: Team[]): Match[] {
  const ids: (number | null)[] = teams.map((t) => t.id);
  if (ids.length % 2 === 1) ids.push(null); // bye
  const n = ids.length;
  const matches: Match[] = [];
  let rotation = [...ids];

  for (let round = 1; round < n; round++) {
    for (let i = 0; i < n / 2; i++) {
      const home = rotation[i];
      const away = rotation[n - 1 - i];
      if (home === null || away === null) continue;
      // Alternate sides so the fixed team isn't always listed first.
      const [teamA, teamB] = round % 2 === 0 && i === 0 ? [away, home] : [home, away];
      matches.push({
        id: `${Math.min(teamA, teamB)}-${Math.max(teamA, teamB)}`,
        round,
        number: matches.length + 1,
        teamA,
        teamB,
      });
    }
    rotation = [rotation[0], rotation[n - 1], ...rotation.slice(1, n - 1)];
  }
  return matches;
}

/** Badminton has no draws: a valid score is two whole numbers that differ. */
export function isValidScore(a: number, b: number): boolean {
  return (
    Number.isInteger(a) &&
    Number.isInteger(b) &&
    a >= 0 &&
    b >= 0 &&
    a <= MAX_SCORE &&
    b <= MAX_SCORE &&
    a !== b
  );
}

export type MatchResult = { winner: number; loser: number; scoreA: number; scoreB: number };

export function matchResult(match: Match, score: Score | undefined): MatchResult | null {
  if (!score || !isValidScore(score.a, score.b)) return null;
  return {
    scoreA: score.a,
    scoreB: score.b,
    winner: score.a > score.b ? match.teamA : match.teamB,
    loser: score.a > score.b ? match.teamB : match.teamA,
  };
}

export type Standing = {
  team: Team;
  played: number;
  won: number;
  lost: number;
  points: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  /** Results in running order, most recent last. */
  form: ("W" | "L")[];
};

/**
 * Ranks teams by: competition points, then head-to-head points among the
 * tied teams, then rally-point difference, then rally points scored.
 */
export function computeStandings(
  teams: Team[],
  matches: Match[],
  scores: Record<string, Score>,
): Standing[] {
  const byId = new Map<number, Standing>(
    teams.map((team) => [
      team.id,
      { team, played: 0, won: 0, lost: 0, points: 0, pointsFor: 0, pointsAgainst: 0, diff: 0, form: [] },
    ]),
  );
  const results: MatchResult[] = [];

  for (const match of matches) {
    const result = matchResult(match, scores[match.id]);
    if (!result) continue;
    results.push(result);
    const a = byId.get(match.teamA)!;
    const b = byId.get(match.teamB)!;
    a.played++;
    b.played++;
    a.pointsFor += result.scoreA;
    a.pointsAgainst += result.scoreB;
    b.pointsFor += result.scoreB;
    b.pointsAgainst += result.scoreA;
    const winner = byId.get(result.winner)!;
    const loser = byId.get(result.loser)!;
    winner.won++;
    winner.points += WIN_POINTS;
    winner.form.push("W");
    loser.lost++;
    loser.points += LOSS_POINTS;
    loser.form.push("L");
  }

  const standings = [...byId.values()];
  for (const s of standings) s.diff = s.pointsFor - s.pointsAgainst;

  const headToHead = (s: Standing, group: Set<number>) =>
    results.filter((r) => r.winner === s.team.id && group.has(r.loser)).length * WIN_POINTS;

  const groups = new Map<number, Standing[]>();
  for (const s of standings) {
    groups.set(s.points, [...(groups.get(s.points) ?? []), s]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .flatMap(([, group]) => {
      const ids = new Set(group.map((s) => s.team.id));
      return group.sort(
        (x, y) =>
          headToHead(y, ids) - headToHead(x, ids) ||
          y.diff - x.diff ||
          y.pointsFor - x.pointsFor ||
          x.team.id - y.team.id,
      );
    });
}

export function teamName(team: Team): string {
  return `${team.players[0]} & ${team.players[1]}`;
}
