// Three Wolves mini game: doubles round robin.
// Teams are drawn by pairing tier 1 with tier 4 and tier 2 with tier 3, then
// every team plays every other team once. A win is worth 2 points, a loss 0.

export type Tier = 1 | 2 | 3 | 4;

export type Player = { name: string; tier: Tier };

export const ROSTER: Player[] = [
  { name: "Hòa", tier: 1 },
  { name: "Khoai Lang", tier: 1 },
  { name: "Sơn", tier: 1 },
  { name: "Huy", tier: 1 },
  { name: "Quang", tier: 2 },
  { name: "Timba", tier: 2 },
  { name: "Hùng", tier: 2 },
  { name: "Tố Anh", tier: 2 },
  { name: "Jason", tier: 3 },
  { name: "Hiếu", tier: 3 },
  { name: "Ly", tier: 3 },
  { name: "Uyên", tier: 3 },
  { name: "Trang", tier: 4 },
  { name: "Gia Minh", tier: 4 },
  { name: "Tú", tier: 4 },
  { name: "Kelcee", tier: 4 },
];

export const WIN_POINTS = 2;
export const LOSS_POINTS = 0;

export type Team = {
  id: number;
  players: [Player, Player];
};

export type Match = {
  id: string;
  round: number;
  /** 1-based number in the overall running order. */
  number: number;
  teamA: number;
  teamB: number;
};

export type Score = { a: string; b: string };

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pairTiers(roster: Player[], high: Tier, low: Tier): [Player, Player][] {
  const highs = shuffle(roster.filter((p) => p.tier === high));
  const lows = shuffle(roster.filter((p) => p.tier === low));
  if (highs.length !== lows.length) {
    throw new Error(
      `Tier ${high} has ${highs.length} players but tier ${low} has ${lows.length}`,
    );
  }
  return highs.map((p, i) => [p, lows[i]]);
}

/** Randomly draws the doubles teams: tier 1 + tier 4, tier 2 + tier 3. */
export function drawTeams(roster: Player[] = ROSTER): Team[] {
  const pairs = shuffle([...pairTiers(roster, 1, 4), ...pairTiers(roster, 2, 3)]);
  return pairs.map((players, i) => ({ id: i + 1, players }));
}

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

export type MatchResult = { winner: number; loser: number; scoreA: number; scoreB: number };

function parseScore(value: string): number | null {
  if (!/^\d{1,2}$/.test(value.trim())) return null;
  return Number(value);
}

/**
 * Returns the result for a match, or null if the score is incomplete or
 * invalid (badminton has no draws, so equal scores don't count).
 */
export function matchResult(match: Match, score: Score | undefined): MatchResult | null {
  if (!score) return null;
  const a = parseScore(score.a);
  const b = parseScore(score.b);
  if (a === null || b === null || a === b) return null;
  return {
    scoreA: a,
    scoreB: b,
    winner: a > b ? match.teamA : match.teamB,
    loser: a > b ? match.teamB : match.teamA,
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
    results.filter(
      (r) => r.winner === s.team.id && group.has(r.loser),
    ).length * WIN_POINTS;

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
  return `${team.players[0].name} & ${team.players[1].name}`;
}
