// Three Wolves casual play: a live court board for ordinary (non mini game)
// play days. Players are split into two tiers. A play day is booked as 1.5
// hours, counted from when the first games go on court: for the first hour
// (two thirds) every doubles team is one tier 1 player with one tier 2
// player; after that games are played within a tier (four tier 1 players, or
// four tier 2 players), still rotating partners, and keep going until the
// organiser concludes the play day (courts sometimes run over).
//
// Two rotation styles:
// - rounds (the default): every court waits for the last game of the round,
//   then everyone is drawn again across all the courts at once. Who sits out
//   is spread evenly and partners and opponents are mixed up across the whole
//   round, so the same four can't keep cycling on one court when only a few
//   people are waiting.
// - continuous: whenever a court comes free the next game is picked straight
//   away from whoever has waited longest. Courts never sit idle, which suits
//   busy nights with plenty of people waiting.
//
// Everything here is pure and shared by the page and the API. The API owns
// the stored state and runs every action through applyAction().

export type Tier = 1 | 2;

export const MIN_COURTS = 1;
export const MAX_COURTS = 4;
export const MAX_GUEST_NAME = 30;
export const MAX_HISTORY = 400;
export const MAX_COURT_NUMBER = 6;
/** Court time per play day, from the first court assignment. */
export const PLAY_DAY_MS = 90 * 60 * 1000;
/** Mixed-tier share of the play day; the rest is played within tiers. */
export const MIXED_SHARE = 2 / 3;

/**
 * mixed: every team is one tier 1 with one tier 2 player.
 * split: games are four tier 1 players or four tier 2 players.
 */
export type TierPhase = "mixed" | "split";
/** auto follows the clock; the other two are an organiser override. */
export type TierMode = "auto" | TierPhase;
/** See the comment at the top of the file. */
export type RotationStyle = "rounds" | "continuous";

export type Player = {
  id: string;
  name: string;
  /** null = not playing today (sits in the "Not playing" list). */
  tier: Tier | null;
  /** Taking a break: stays in their tier but isn't picked for games. */
  paused: boolean;
  guest: boolean;
  /** Finished games today. */
  games: number;
  /** When they last came off court (or joined the rotation), epoch ms. */
  readyAt: number;
  /** Rounds rotation: the last round they played in. Missing = not yet. */
  playedRound?: number;
};

export type Game = {
  id: number;
  court: number;
  teamA: [string, string];
  teamB: [string, string];
  startedAt: number;
  endedAt?: number;
  /** Which rule picked it. Only set on the "up next" preview. */
  phase?: TierPhase;
};

export type CasualPlayState = {
  date: string;
  courts: number;
  started: boolean;
  players: Player[];
  /** Index = court number − 1. */
  onCourt: (Game | null)[];
  /** Continuous rotation: preview of the game that takes the next free court. court is 0. */
  next: Game | null;
  /**
   * Rounds rotation: the next round as it will go on once every court has
   * finished, one game per court. Missing on older boards.
   */
  nextRound?: Game[] | null;
  /**
   * What nextRound was drawn from (see roundKey). The preview goes on as
   * shown only if the board still matches when the round actually starts.
   */
  nextRoundKey?: string | null;
  /** Rounds rotation: the round now on court (or last played), 0 before the first. */
  round?: number;
  /** Missing on boards saved before rounds existed: reads as "rounds". */
  rotation?: RotationStyle;
  history: Game[];
  nextGameId: number;
  /**
   * Set once the organiser concludes the play day: no more games are put on
   * and everyone sees the summary. Missing on boards saved before this
   * existed, which reads the same as null.
   */
  concludedAt?: number | null;
  /**
   * When the first games went on court, epoch ms: the play day's clock.
   * Missing on older boards (then the earliest game stands in).
   */
  startedAt?: number | null;
  /** Organiser override of the mixed/within-tier switch. Missing = auto. */
  tierMode?: TierMode;
  /**
   * The venue's own court numbers, index = court number − 1 ("" = not set,
   * shown as the board's 1, 2, 3…). Missing on older boards.
   */
  courtNumbers?: string[];
};

export type Action =
  | { type: "setTier"; playerId: string; tier: Tier | null }
  | { type: "rename"; playerId: string; name: string }
  | { type: "addGuest"; name: string; tier: Tier | null }
  | { type: "removeGuest"; playerId: string }
  | { type: "setPaused"; playerId: string; paused: boolean }
  | { type: "setCourts"; courts: number }
  | { type: "setCourtNumber"; court: number; number: string }
  | { type: "setTierMode"; mode: TierMode }
  | { type: "setRotation"; rotation: RotationStyle }
  | { type: "start" }
  // gameId (optional) guards against a stale double tap finishing the game
  // that has just gone on in its place.
  | { type: "finish"; court: number; gameId?: number }
  | { type: "void"; court: number; gameId?: number }
  | { type: "nextRound" }
  | { type: "reshuffleNext" }
  | { type: "conclude" }
  | { type: "reopen" }
  | { type: "endSession" };

export function emptyState(date: string, courts: number): CasualPlayState {
  const n = clampCourts(courts);
  return {
    date,
    courts: n,
    started: false,
    players: [],
    onCourt: Array.from({ length: n }, () => null),
    next: null,
    nextRound: null,
    nextRoundKey: null,
    round: 0,
    rotation: "rounds",
    history: [],
    nextGameId: 1,
    concludedAt: null,
    startedAt: null,
    tierMode: "auto",
    courtNumbers: Array.from({ length: n }, () => ""),
  };
}

/** The court's name on the board: the venue's number if set, else its position. */
export function courtLabel(state: CasualPlayState, court: number): string {
  return state.courtNumbers?.[court - 1]?.trim() || String(court);
}

/**
 * Changes how many courts the board runs. Games on courts that no longer
 * exist are called off; their players go back to the queue without the game
 * counting.
 */
export function resizeCourts(state: CasualPlayState, courts: number): CasualPlayState {
  const n = clampCourts(courts);
  return {
    ...state,
    courts: n,
    onCourt: Array.from({ length: n }, (_, i) => state.onCourt[i] ?? null),
    courtNumbers: Array.from({ length: n }, (_, i) => state.courtNumbers?.[i] ?? ""),
  };
}

/** When the first games went on court, or null before the courts start. */
export function courtsStartedAt(state: CasualPlayState): number | null {
  if (!state.started) return null;
  if (state.startedAt) return state.startedAt;
  const games = [...state.history, ...state.onCourt.filter((g): g is Game => g !== null)];
  return games.length ? Math.min(...games.map((g) => g.startedAt)) : null;
}

/**
 * When the board switches to within-tier games: two thirds of the way
 * through the 1.5 hour play day. Null before the courts start.
 */
export function splitTime(state: CasualPlayState): number | null {
  const start = courtsStartedAt(state);
  return start === null ? null : Math.round(start + PLAY_DAY_MS * MIXED_SHARE);
}

/** Whether games right now are mixed-tier or within a tier. */
export function tierPhase(state: CasualPlayState, now: number): TierPhase {
  const mode = state.tierMode ?? "auto";
  if (mode !== "auto") return mode;
  const at = splitTime(state);
  return at !== null && now >= at ? "split" : "mixed";
}

export function rotationStyle(state: CasualPlayState): RotationStyle {
  return state.rotation ?? "rounds";
}

export function isConcluded(state: CasualPlayState): boolean {
  return Boolean(state.concludedAt);
}

export function clampCourts(n: number): number {
  return Math.min(MAX_COURTS, Math.max(MIN_COURTS, Math.round(Number(n) || MIN_COURTS)));
}

export function gamePlayers(game: Game): string[] {
  return [...game.teamA, ...game.teamB];
}

export function onCourtIds(state: CasualPlayState): Set<string> {
  const ids = new Set<string>();
  for (const g of state.onCourt) if (g) for (const id of gamePlayers(g)) ids.add(id);
  return ids;
}

/** Players who can be picked for the next game. */
export function availablePlayers(state: CasualPlayState): Player[] {
  const busy = onCourtIds(state);
  return state.players.filter((p) => p.tier !== null && !p.paused && !busy.has(p.id));
}

/**
 * The waiting queue in pick order: fewest games first, then whoever has been
 * off court longest. Name is the final tiebreak so the order is stable.
 */
export function queueOrder(players: Player[]): Player[] {
  return [...players].sort(
    (a, b) => a.games - b.games || a.readyAt - b.readyAt || a.name.localeCompare(b.name, "vi"),
  );
}

type History = {
  partners: Map<string, number>;
  opponents: Map<string, number>;
  lastFours: Set<string>;
  /** Pairs who shared a court (either side of the net) in the latest round of games. */
  recent: Set<string>;
};

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const fourKey = (ids: string[]) => [...ids].sort().join("|");

function buildHistory(state: CasualPlayState): History {
  const partners = new Map<string, number>();
  const opponents = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const games = [...state.history, ...state.onCourt.filter((g): g is Game => g !== null)];
  for (const g of games) {
    bump(partners, pairKey(...g.teamA));
    bump(partners, pairKey(...g.teamB));
    for (const a of g.teamA) for (const b of g.teamB) bump(opponents, pairKey(a, b));
  }
  // The same four players straight back on court together feels stale even
  // when the pairing differs, so the last few line-ups are remembered.
  const lastFours = new Set(games.slice(-Math.max(2, state.courts * 2)).map((g) => fourKey(gamePlayers(g))));
  const recent = new Set<string>();
  for (const g of games.slice(-state.courts)) {
    const ids = gamePlayers(g);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) recent.add(pairKey(ids[i], ids[j]));
  }
  return { partners, opponents, lastFours, recent };
}

// Cost weights. Fairness (games played) dominates. In the mixed phase an
// all-tier-2 or all-tier-1 team only happens when a tier is genuinely short
// of players; in the within-tier phase a game mixing tiers only happens when
// neither tier has four players free.
const W_GAME_BEHIND = 100;
const W_QUEUE_RANK = 4;
const W_SAME_TIER_TEAM = 1000;
const W_CROSS_TIER_GAME = 1000;
// A within-tier fallback game that has to mix tiers still pairs one of each
// where it can, but weighed lighter than fairness.
const W_SAME_TIER_TEAM_FALLBACK = 50;
const W_PARTNER_REPEAT = 30;
const W_OPPONENT_REPEAT = 8;
const W_SAME_FOUR = 40;
// Preference for the players already shown as "up next". Strong enough that
// they're almost always the ones who go on, but a clearly better mix (say,
// the same pairs about to meet for the third time) can still win.
const W_PLANNED = 25;
// Per person skipped: picking someone over a same-tier player who has
// played no more and has been waiting longer. Seen from the side, that looks
// like queue-jumping, so only a real repeat problem should justify it.
const W_SKIP = 40;
// Rounds only: sharing a court again straight after the round you shared one,
// on top of the partner and opponent repeat costs.
const W_RECENT = 12;
// Rounds only: how much a player is owed a game. Games behind dominates; among
// players level on games, whoever has gone longest since their last game plays.
const OWED_GAME = 100;
const OWED_ROUND_WAITED = 10;
const ROUND_RESTARTS = 40;

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [first, ...c]), ...combinations(rest, k)];
}

/**
 * Picks the next doubles game from the waiting queue, or null when fewer
 * than four players are free. `random` is injectable for tests.
 */
export function pickGame(
  state: CasualPlayState,
  phase: TierPhase = "mixed",
  planned: Set<string> = new Set(),
  random: () => number = Math.random,
): Omit<Game, "id" | "court" | "startedAt"> | null {
  const queue = queueOrder(availablePlayers(state));
  if (queue.length < 4) return null;

  const rank = new Map(queue.map((p, i) => [p.id, i]));
  const minGames = queue[0].games;
  // Only the front of each tier's queue is worth considering: anyone further
  // back has waited less, so they can't win on fairness.
  const front = (tier: Tier) => {
    const list = queue.filter((p) => p.tier === tier);
    return [...new Set([...list.slice(0, 4), ...list.filter((p) => planned.has(p.id))])];
  };
  const pool = [...front(1), ...front(2)];
  const history = buildHistory(state);
  const skipped = (four: Player[]) => {
    const chosen = new Set(four.map((p) => p.id));
    let n = 0;
    for (const p of four) {
      for (const q of queue) {
        if (!chosen.has(q.id) && q.tier === p.tier && q.games <= p.games && q.readyAt < p.readyAt) n++;
      }
    }
    return n;
  };

  let best: { cost: number; teamA: [string, string]; teamB: [string, string] } | null = null;
  for (const four of combinations(pool, 4)) {
    const base =
      four.reduce((sum, p) => sum + (p.games - minGames) * W_GAME_BEHIND + rank.get(p.id)! * W_QUEUE_RANK, 0) +
      (history.lastFours.has(fourKey(four.map((p) => p.id))) ? W_SAME_FOUR : 0) -
      four.filter((p) => planned.has(p.id)).length * W_PLANNED +
      skipped(four) * W_SKIP;
    const oneTier = four.every((p) => p.tier === four[0].tier);
    const sameTierTeam =
      phase === "mixed" ? W_SAME_TIER_TEAM : oneTier ? 0 : W_SAME_TIER_TEAM_FALLBACK;
    const tierCost = phase === "split" && !oneTier ? W_CROSS_TIER_GAME : 0;
    const [a, b, c, d] = four;
    const pairings: [Player, Player, Player, Player][] = [
      [a, b, c, d],
      [a, c, b, d],
      [a, d, b, c],
    ];
    for (const [p1, p2, p3, p4] of pairings) {
      let cost = base + tierCost + random() * 3;
      if (p1.tier === p2.tier) cost += sameTierTeam;
      if (p3.tier === p4.tier) cost += sameTierTeam;
      cost += (history.partners.get(pairKey(p1.id, p2.id)) ?? 0) * W_PARTNER_REPEAT;
      cost += (history.partners.get(pairKey(p3.id, p4.id)) ?? 0) * W_PARTNER_REPEAT;
      for (const x of [p1, p2]) {
        for (const y of [p3, p4]) cost += (history.opponents.get(pairKey(x.id, y.id)) ?? 0) * W_OPPONENT_REPEAT;
      }
      if (!best || cost < best.cost) {
        // Tier 1 player listed first in each team so the board reads the same way every game.
        const order = (x: Player, y: Player): [string, string] =>
          (x.tier ?? 9) <= (y.tier ?? 9) ? [x.id, y.id] : [y.id, x.id];
        best = { cost, teamA: order(p1, p2), teamB: order(p3, p4) };
      }
    }
  }
  return best && { teamA: best.teamA, teamB: best.teamB };
}

/**
 * Whether a previewed game can still happen: everyone in it is still in the
 * rotation. They may be mid-game (the preview looks ahead), and fillCourts
 * clears the preview whenever it puts a game on, so it's never stale there.
 */
function previewStillValid(state: CasualPlayState, game: Game | null, phase: TierPhase): game is Game {
  if (!game) return false;
  // A preview picked before the switch to within-tier games (or before an
  // organiser override) is picked again under the current rule.
  if ((game.phase ?? "mixed") !== phase) return false;
  const ok = new Set(state.players.filter((p) => p.tier !== null && !p.paused).map((p) => p.id));
  return gamePlayers(game).every((id) => ok.has(id));
}

/** Puts a game on every empty court, then refreshes the "up next" preview. */
function fillCourts(state: CasualPlayState, now: number, random: () => number): void {
  if (!state.started || isConcluded(state)) {
    state.next = null;
    state.nextRound = null;
    state.nextRoundKey = null;
    return;
  }
  if (rotationStyle(state) === "rounds") {
    // A new round only once every court is free; until then finished courts wait.
    if (!state.onCourt.some(Boolean)) startRound(state, now, random);
    state.next = null;
    refreshNextRound(state, now, random);
    return;
  }
  state.nextRound = null;
  state.nextRoundKey = null;
  const phase = tierPhase(state, now);
  for (let i = 0; i < state.courts; i++) {
    if (state.onCourt[i]) continue;
    // Picked fresh from everyone free right now (including whoever just came
    // off), leaning hard towards the players already shown as up next. When
    // exactly four people are waiting, locking the preview in would keep the
    // same two pairs cycling all night.
    const planned = new Set(state.next ? gamePlayers(state.next) : []);
    const picked = pickGame(state, phase, planned, random);
    state.next = null;
    if (!picked) break;
    state.onCourt[i] = {
      id: state.nextGameId++,
      court: i + 1,
      teamA: picked.teamA,
      teamB: picked.teamB,
      startedAt: now,
    };
  }
  refreshNext(state, now, random);
}

/**
 * The board as it will most likely look when the next court frees up: the
 * game that has been on longest has finished. Previewing from this, rather
 * than from only the people waiting right now, means the preview can mix
 * waiting players with the ones about to come off, so it rarely has to
 * change when the court actually frees.
 */
function lookahead(state: CasualPlayState): CasualPlayState {
  const running = state.onCourt.filter((g): g is Game => g !== null);
  if (running.length === 0 || availablePlayers(state).length >= 8) return state;
  const first = running.reduce((a, b) => (b.startedAt < a.startedAt ? b : a));
  const coming = new Set(gamePlayers(first));
  const latest = Math.max(0, ...state.players.map((p) => p.readyAt));
  return {
    ...state,
    onCourt: state.onCourt.map((g) => (g === first ? null : g)),
    history: [...state.history, first],
    players: state.players.map((p) => (coming.has(p.id) ? { ...p, games: p.games + 1, readyAt: latest + 1 } : p)),
  };
}

function refreshNext(state: CasualPlayState, now: number, random: () => number, force = false): void {
  if (rotationStyle(state) === "rounds") {
    state.next = null;
    refreshNextRound(state, now, random, force);
    return;
  }
  if (!state.started || isConcluded(state)) {
    state.next = null;
    return;
  }
  const phase = tierPhase(state, now);
  if (!force && previewStillValid(state, state.next, phase)) return;
  const picked = pickGame(lookahead(state), phase, new Set(), random);
  state.next = picked
    ? { id: 0, court: 0, teamA: picked.teamA, teamB: picked.teamB, startedAt: 0, phase }
    : null;
}

/* ── Rounds rotation ─────────────────────────────────── */

type Four = [Player, Player, Player, Player];

/** Cost of one game in a round: tier rules, then repeat partners and opponents. */
function roundGameCost(game: Four, phase: TierPhase, history: History): number {
  const [a, b, c, d] = game;
  const oneTier = game.every((p) => p.tier === a.tier);
  const sameTierTeam = phase === "mixed" ? W_SAME_TIER_TEAM : oneTier ? 0 : W_SAME_TIER_TEAM_FALLBACK;
  let cost = phase === "split" && !oneTier ? W_CROSS_TIER_GAME : 0;
  if (a.tier === b.tier) cost += sameTierTeam;
  if (c.tier === d.tier) cost += sameTierTeam;
  cost += (history.partners.get(pairKey(a.id, b.id)) ?? 0) * W_PARTNER_REPEAT;
  cost += (history.partners.get(pairKey(c.id, d.id)) ?? 0) * W_PARTNER_REPEAT;
  for (const x of [a, b]) {
    for (const y of [c, d]) cost += (history.opponents.get(pairKey(x.id, y.id)) ?? 0) * W_OPPONENT_REPEAT;
  }
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) if (history.recent.has(pairKey(game[i].id, game[j].id))) cost += W_RECENT;
  }
  if (history.lastFours.has(fourKey(game.map((p) => p.id)))) cost += W_SAME_FOUR;
  return cost;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Splits the players into games (every 4 in a row is one game: first two vs
 * last two) with the lowest total cost: random starts, each improved by
 * swapping two players until no swap helps. A round is at most 16 players, so
 * this is quick and in practice finds the best split.
 */
function arrangeRound(players: Player[], phase: TierPhase, history: History, random: () => number): Four[] {
  const k = players.length / 4;
  const costOf = (order: Player[], g: number) => roundGameCost(order.slice(g * 4, g * 4 + 4) as Four, phase, history);
  let best: { order: Player[]; cost: number } | null = null;
  for (let restart = 0; restart < ROUND_RESTARTS; restart++) {
    const order = shuffled(players, random);
    const games = Array.from({ length: k }, (_, g) => costOf(order, g));
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < order.length; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const gi = Math.floor(i / 4);
          const gj = Math.floor(j / 4);
          // Swapping within a game only matters across the net.
          if (gi === gj && Math.floor(i / 2) === Math.floor(j / 2)) continue;
          [order[i], order[j]] = [order[j], order[i]];
          const ci = costOf(order, gi);
          const cj = gi === gj ? ci : costOf(order, gj);
          const delta = gi === gj ? ci - games[gi] : ci + cj - games[gi] - games[gj];
          if (delta < -1e-9) {
            games[gi] = ci;
            games[gj] = cj;
            improved = true;
          } else {
            [order[i], order[j]] = [order[j], order[i]];
          }
        }
      }
    }
    const cost = games.reduce((s, c) => s + c, 0);
    if (!best || cost < best.cost) best = { order: [...order], cost };
  }
  return Array.from({ length: k }, (_, g) => best!.order.slice(g * 4, g * 4 + 4) as Four);
}

/**
 * Draws a whole round: who plays (the players owed a game most, with the tier
 * mix the phase wants) and how they split into games. Null when fewer than
 * four players are free.
 */
export function pickRound(
  state: CasualPlayState,
  phase: TierPhase = "mixed",
  random: () => number = Math.random,
): { teamA: [string, string]; teamB: [string, string] }[] | null {
  const free = availablePlayers(state);
  const k = Math.min(state.courts, Math.floor(free.length / 4));
  if (k === 0) return null;
  const most = Math.max(...free.map((p) => p.games));
  const round = state.round ?? 0;
  const owed = new Map(
    free.map((p) => [
      p.id,
      (most - p.games) * OWED_GAME +
        (round - (p.playedRound ?? 0)) * OWED_ROUND_WAITED +
        random(), // fair coin between players level on everything
    ]),
  );
  const byOwed = (tier: Tier) => free.filter((p) => p.tier === tier).sort((a, b) => owed.get(b.id)! - owed.get(a.id)!);
  const t1 = byOwed(1);
  const t2 = byOwed(2);
  const seats = k * 4;

  // How many of each tier go on: the tier rules first (one of each per team
  // when mixed, four of a tier per game when split), then sitting out whoever
  // is owed least.
  let pick: { n1: number; cost: number } | null = null;
  for (let n1 = Math.max(0, seats - t2.length); n1 <= Math.min(seats, t1.length); n1++) {
    const n2 = seats - n1;
    const tierCost =
      phase === "mixed"
        ? (2 * k - Math.min(n1, n2)) * W_SAME_TIER_TEAM
        : (k - Math.floor(n1 / 4) - Math.floor(n2 / 4)) * W_CROSS_TIER_GAME;
    // Squared, so sitting one person out again costs more than two people once each.
    const sitting = [...t1.slice(n1), ...t2.slice(n2)].reduce((sum, p) => sum + owed.get(p.id)! ** 2 / OWED_GAME, 0);
    const cost = tierCost + sitting;
    if (!pick || cost < pick.cost) pick = { n1, cost };
  }
  if (!pick) return null;
  const playing = [...t1.slice(0, pick.n1), ...t2.slice(0, seats - pick.n1)];

  const games = arrangeRound(playing, phase, buildHistory(state), random);
  // Tier 1 player listed first in each team so the board reads the same way every game.
  const order = (x: Player, y: Player): [string, string] =>
    (x.tier ?? 9) <= (y.tier ?? 9) ? [x.id, y.id] : [y.id, x.id];
  return games.map(([a, b, c, d]) => ({ teamA: order(a, b), teamB: order(c, d) }));
}

/**
 * Everything a round draw depends on. The previewed round goes on as shown
 * only when this still matches as the round starts; anything else (a game
 * called off, someone on a break, the switch to within-tier games) means a
 * fresh draw.
 */
function roundKey(state: CasualPlayState, phase: TierPhase): string {
  const free = availablePlayers(state)
    .map((p) => `${p.id}:${p.tier}:${p.games}:${p.playedRound ?? 0}`)
    .sort();
  return [phase, state.courts, ...free].join("|");
}

/** The board once every game on court now has finished: what the next round is drawn from. */
function roundLookahead(state: CasualPlayState): CasualPlayState {
  const running = state.onCourt.filter((g): g is Game => g !== null);
  if (running.length === 0) return state;
  const coming = new Set(running.flatMap(gamePlayers));
  return {
    ...state,
    onCourt: state.onCourt.map(() => null),
    history: [...state.history, ...running],
    players: state.players.map((p) => (coming.has(p.id) ? { ...p, games: p.games + 1 } : p)),
  };
}

function refreshNextRound(state: CasualPlayState, now: number, random: () => number, force = false): void {
  if (!state.started || isConcluded(state) || rotationStyle(state) !== "rounds") {
    state.nextRound = null;
    state.nextRoundKey = null;
    return;
  }
  const phase = tierPhase(state, now);
  const ahead = roundLookahead(state);
  const key = roundKey(ahead, phase);
  if (!force && state.nextRound && state.nextRoundKey === key) return;
  const picked = pickRound(ahead, phase, random);
  state.nextRound = picked
    ? shuffled(picked, random).map((g, i) => ({ id: 0, court: i + 1, ...g, startedAt: 0, phase }))
    : null;
  state.nextRoundKey = picked ? key : null;
}

/** Puts a whole new round on court (the previewed one if it still fits). */
function startRound(state: CasualPlayState, now: number, random: () => number): void {
  const phase = tierPhase(state, now);
  const planned =
    state.nextRound && state.nextRoundKey === roundKey(state, phase) ? state.nextRound : null;
  const games =
    planned ??
    shuffled(pickRound(state, phase, random) ?? [], random).map((g, i) => ({ court: i + 1, ...g }));
  state.nextRound = null;
  state.nextRoundKey = null;
  if (games.length === 0) return;
  const round = (state.round ?? 0) + 1;
  state.round = round;
  for (const g of games) {
    state.onCourt[g.court - 1] = {
      id: state.nextGameId++,
      court: g.court,
      teamA: g.teamA,
      teamB: g.teamB,
      startedAt: now,
    };
  }
  const playing = onCourtIds(state);
  for (const p of state.players) if (playing.has(p.id)) p.playedRound = round;
}

/** Swaps a player who leaves mid-game for the best free player, ideally from the same tier. */
function replaceOnCourt(state: CasualPlayState, playerId: string, leaving: Player): void {
  const index = state.onCourt.findIndex((g) => g && gamePlayers(g).includes(playerId));
  if (index === -1) return;
  const game = state.onCourt[index]!;
  const queue = queueOrder(availablePlayers(state).filter((p) => p.id !== playerId));
  const sub = queue.find((p) => p.tier === leaving.tier) ?? queue[0];
  if (!sub) {
    // Nobody to bring on: call the game off and send the other three back.
    state.onCourt[index] = null;
    return;
  }
  if (rotationStyle(state) === "rounds") sub.playedRound = state.round;
  const swap = (team: [string, string]): [string, string] =>
    team.map((id) => (id === playerId ? sub.id : id)) as [string, string];
  state.onCourt[index] = { ...game, teamA: swap(game.teamA), teamB: swap(game.teamB) };
}

/** Ends the game on a court: it counts, and its four go to the back of the queue. */
function finishCourt(state: CasualPlayState, court: number, now: number): void {
  const game = state.onCourt[court - 1];
  if (!game) return;
  state.onCourt[court - 1] = null;
  state.history.push({ ...game, endedAt: now });
  if (state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY);
  for (const id of gamePlayers(game)) {
    const p = findPlayer(state, id);
    if (p) {
      p.games++;
      p.readyAt = now;
    }
  }
}

/** The court has a game on it, and (when the page says which) it's that game. */
function checkCourt(state: CasualPlayState, court: number, gameId: number | undefined): void {
  if (court > state.courts) throw new ActionError("That court isn't in use");
  const game = state.onCourt[court - 1];
  if (!game) throw new ActionError("That court is already free");
  if (gameId !== undefined && game.id !== gameId) throw new ActionError("That game has already finished");
}

function findPlayer(state: CasualPlayState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}

export class ActionError extends Error {}

/**
 * Applies one organiser action and returns the new state. Never mutates the
 * input. Throws ActionError for a request that doesn't make sense.
 */
export function applyAction(
  input: CasualPlayState,
  action: Action,
  now: number = Date.now(),
  random: () => number = Math.random,
  newGuestId: () => string = () => `g_${Math.random().toString(36).slice(2, 10)}`,
): CasualPlayState {
  const state: CasualPlayState = structuredClone(input);

  switch (action.type) {
    case "setTier": {
      const p = findPlayer(state, action.playerId);
      if (!p) throw new ActionError("Player not found");
      if (action.tier !== null && action.tier !== 1 && action.tier !== 2) throw new ActionError("Invalid tier");
      if (p.tier === action.tier) return state;
      const wasResting = p.tier === null;
      // Moving someone out of the tiers takes them off court; a change
      // between tiers mid-game only affects future picks.
      if (action.tier === null) replaceOnCourt(state, p.id, p);
      if (state.next && gamePlayers(state.next).includes(p.id)) state.next = null;
      p.tier = action.tier;
      // Someone joining the rotation late goes to the back of their games
      // bracket rather than jumping the people already waiting.
      if (wasResting && action.tier !== null) p.readyAt = now;
      break;
    }
    case "rename": {
      // Roster players are named from the play day roster; only walk-ins
      // are named here.
      const p = findPlayer(state, action.playerId);
      if (!p || !p.guest) throw new ActionError("Guest not found");
      const name = action.name.trim().slice(0, MAX_GUEST_NAME);
      if (!name) throw new ActionError("Name can't be empty");
      p.name = name;
      return state;
    }
    case "addGuest": {
      const name = action.name.trim().slice(0, MAX_GUEST_NAME);
      if (!name) throw new ActionError("Name can't be empty");
      if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        throw new ActionError(`There's already a player called ${name}`);
      }
      state.players.push({
        id: newGuestId(),
        name,
        tier: action.tier,
        paused: false,
        guest: true,
        games: 0,
        readyAt: now,
      });
      break;
    }
    case "removeGuest": {
      const p = findPlayer(state, action.playerId);
      if (!p || !p.guest) throw new ActionError("Guest not found");
      replaceOnCourt(state, p.id, p);
      if (state.next && gamePlayers(state.next).includes(p.id)) state.next = null;
      state.players = state.players.filter((x) => x.id !== p.id);
      break;
    }
    case "setPaused": {
      const p = findPlayer(state, action.playerId);
      if (!p) throw new ActionError("Player not found");
      if (p.paused === action.paused) return state;
      if (action.paused) replaceOnCourt(state, p.id, p);
      else p.readyAt = Math.max(p.readyAt, now);
      p.paused = action.paused;
      break;
    }
    case "setCourts": {
      Object.assign(state, resizeCourts(state, action.courts));
      break;
    }
    case "setCourtNumber": {
      if (action.court < 1 || action.court > state.courts) throw new ActionError("That court isn't in use");
      const number = action.number.trim().slice(0, MAX_COURT_NUMBER);
      const numbers = Array.from({ length: state.courts }, (_, i) => state.courtNumbers?.[i] ?? "");
      if (number && numbers.some((n, i) => i !== action.court - 1 && n.toLowerCase() === number.toLowerCase())) {
        throw new ActionError(`Court ${number} is already on the board`);
      }
      numbers[action.court - 1] = number;
      state.courtNumbers = numbers;
      return state;
    }
    case "setTierMode": {
      if (!["auto", "mixed", "split"].includes(action.mode)) throw new ActionError("Invalid mode");
      state.tierMode = action.mode;
      refreshNext(state, now, random);
      return state;
    }
    case "setRotation": {
      if (action.rotation !== "rounds" && action.rotation !== "continuous") throw new ActionError("Invalid rotation");
      if (rotationStyle(state) === action.rotation) return state;
      state.rotation = action.rotation;
      state.next = null;
      state.nextRound = null;
      state.nextRoundKey = null;
      // Continuous fills any free court straight away; rounds waits for the
      // games on court now to finish, then draws a full round.
      break;
    }
    case "start": {
      if (state.started) return state;
      state.concludedAt = null;
      state.started = true;
      state.startedAt = now;
      for (const p of state.players) p.readyAt = now;
      break;
    }
    case "finish": {
      if (isConcluded(state)) throw new ActionError("The play day has been concluded");
      checkCourt(state, action.court, action.gameId);
      finishCourt(state, action.court, now);
      break;
    }
    case "nextRound": {
      // Rounds rotation: don't wait for the courts still playing. Their games
      // count as played and everyone is drawn into the next round now.
      if (!state.started || isConcluded(state)) throw new ActionError("The courts aren't running");
      if (rotationStyle(state) !== "rounds") throw new ActionError("Only in rounds rotation");
      for (let court = 1; court <= state.courts; court++) {
        if (state.onCourt[court - 1]) finishCourt(state, court, now);
      }
      break;
    }
    case "conclude": {
      if (!state.started || isConcluded(state)) return state;
      // Whatever is on court when the night wraps up counts as played.
      for (let court = 1; court <= state.courts; court++) {
        if (state.onCourt[court - 1]) finishCourt(state, court, now);
      }
      state.next = null;
      state.nextRound = null;
      state.nextRoundKey = null;
      state.concludedAt = now;
      return state;
    }
    case "reopen": {
      if (!isConcluded(state)) return state;
      state.concludedAt = null;
      for (const p of state.players) p.readyAt = Math.max(p.readyAt, now);
      break;
    }
    case "void": {
      // Called off (wrong players, someone hurt…): the game doesn't count and
      // the four keep their place at the front of the queue.
      checkCourt(state, action.court, action.gameId);
      state.onCourt[action.court - 1] = null;
      state.next = null;
      break;
    }
    case "reshuffleNext": {
      refreshNext(state, now, random, true);
      return state;
    }
    case "endSession": {
      const reset = emptyState(state.date, state.courts);
      reset.courtNumbers = Array.from({ length: state.courts }, (_, i) => state.courtNumbers?.[i] ?? "");
      reset.rotation = rotationStyle(state);
      reset.players = state.players.map((p) => ({
        ...p,
        games: 0,
        paused: false,
        readyAt: now,
        playedRound: undefined,
      }));
      return reset;
    }
    default:
      throw new ActionError("Unknown action");
  }

  fillCourts(state, now, random);
  return state;
}

export function isValidAction(value: unknown): value is Action {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  const tierOk = (t: unknown) => t === null || t === 1 || t === 2;
  const str = (s: unknown) => typeof s === "string" && s.length > 0 && s.length <= 100;
  const court = (c: unknown) => Number.isInteger(c) && (c as number) >= 1 && (c as number) <= MAX_COURTS;
  switch (a.type) {
    case "setTier":
      return str(a.playerId) && tierOk(a.tier);
    case "rename":
      return str(a.playerId) && typeof a.name === "string";
    case "addGuest":
      return typeof a.name === "string" && tierOk(a.tier);
    case "removeGuest":
      return str(a.playerId);
    case "setPaused":
      return str(a.playerId) && typeof a.paused === "boolean";
    case "setCourts":
      return court(a.courts);
    case "setCourtNumber":
      return court(a.court) && typeof a.number === "string" && a.number.length <= 20;
    case "setTierMode":
      return a.mode === "auto" || a.mode === "mixed" || a.mode === "split";
    case "setRotation":
      return a.rotation === "rounds" || a.rotation === "continuous";
    case "finish":
    case "void":
      return court(a.court) && (a.gameId === undefined || (Number.isInteger(a.gameId) && (a.gameId as number) > 0));
    case "start":
    case "nextRound":
    case "reshuffleNext":
    case "conclude":
    case "reopen":
    case "endSession":
      return true;
    default:
      return false;
  }
}

/** Copy of the state safe to show everyone: tiers stay with the organisers. */
export function publicState(state: CasualPlayState): CasualPlayState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, tier: p.tier === null ? null : 1 })),
  };
}

/** API response for GET and POST /api/casual-play. */
export type CasualPlayResponse = {
  state: CasualPlayState;
  /** Saved version of the board; a response with a lower one is out of date. */
  version: number;
  organiser: boolean;
  serverNow: number;
  /** Play days to choose from (organisers only). */
  dates: string[];
  session: { time: string | null; location: string | null } | null;
};

export type PlayDaySummary = {
  games: number;
  /** Minutes from the first game starting to the last one ending. */
  minutes: number;
  players: { id: string; name: string; games: number; partners: number }[];
};

/** End-of-night numbers for the concluded board: games, time on court, and who played how much. */
export function summarise(state: CasualPlayState): PlayDaySummary {
  const games = state.history;
  const first = Math.min(...games.map((g) => g.startedAt));
  const last = Math.max(...games.map((g) => g.endedAt ?? g.startedAt));
  const partners = new Map<string, Set<string>>();
  for (const g of games) {
    for (const [a, b] of [g.teamA, g.teamB]) {
      partners.set(a, (partners.get(a) ?? new Set()).add(b));
      partners.set(b, (partners.get(b) ?? new Set()).add(a));
    }
  }
  return {
    games: games.length,
    minutes: games.length ? Math.round((last - first) / 60_000) : 0,
    players: state.players
      .filter((p) => p.games > 0)
      .map((p) => ({ id: p.id, name: p.name, games: p.games, partners: partners.get(p.id)?.size ?? 0 }))
      .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, "vi")),
  };
}
