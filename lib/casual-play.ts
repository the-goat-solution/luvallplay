// Three Wolves casual play: a live court board for ordinary (non mini game)
// play days. Players are split into two tiers, and every doubles team is one
// tier 1 player with one tier 2 player. Whenever a court comes free the next
// game is picked straight away from whoever has waited longest, so courts
// never sit idle waiting for a whole "round" to finish.
//
// Everything here is pure and shared by the page and the API. The API owns
// the stored state and runs every action through applyAction().

export type Tier = 1 | 2;

export const MIN_COURTS = 1;
export const MAX_COURTS = 4;
export const MAX_GUEST_NAME = 30;
export const MAX_HISTORY = 400;

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
};

export type Game = {
  id: number;
  court: number;
  teamA: [string, string];
  teamB: [string, string];
  startedAt: number;
  endedAt?: number;
};

export type CasualPlayState = {
  date: string;
  courts: number;
  started: boolean;
  players: Player[];
  /** Index = court number − 1. */
  onCourt: (Game | null)[];
  /** Preview of the game that takes the next free court. court is 0. */
  next: Game | null;
  history: Game[];
  nextGameId: number;
  /**
   * Set once the organiser concludes the play day: no more games are put on
   * and everyone sees the summary. Missing on boards saved before this
   * existed, which reads the same as null.
   */
  concludedAt?: number | null;
};

export type Action =
  | { type: "setTier"; playerId: string; tier: Tier | null }
  | { type: "rename"; playerId: string; name: string }
  | { type: "addGuest"; name: string; tier: Tier | null }
  | { type: "removeGuest"; playerId: string }
  | { type: "setPaused"; playerId: string; paused: boolean }
  | { type: "setCourts"; courts: number }
  | { type: "start" }
  | { type: "finish"; court: number }
  | { type: "void"; court: number }
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
    history: [],
    nextGameId: 1,
    concludedAt: null,
  };
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
  return { partners, opponents, lastFours };
}

// Cost weights. Fairness (games played) dominates; an all-tier-2 or
// all-tier-1 team only happens when a tier is genuinely short of players.
const W_GAME_BEHIND = 100;
const W_QUEUE_RANK = 4;
const W_SAME_TIER_TEAM = 1000;
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
    const [a, b, c, d] = four;
    const pairings: [Player, Player, Player, Player][] = [
      [a, b, c, d],
      [a, c, b, d],
      [a, d, b, c],
    ];
    for (const [p1, p2, p3, p4] of pairings) {
      let cost = base + random() * 3;
      if (p1.tier === p2.tier) cost += W_SAME_TIER_TEAM;
      if (p3.tier === p4.tier) cost += W_SAME_TIER_TEAM;
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
function previewStillValid(state: CasualPlayState, game: Game | null): game is Game {
  if (!game) return false;
  const ok = new Set(state.players.filter((p) => p.tier !== null && !p.paused).map((p) => p.id));
  return gamePlayers(game).every((id) => ok.has(id));
}

/** Puts a game on every empty court, then refreshes the "up next" preview. */
function fillCourts(state: CasualPlayState, now: number, random: () => number): void {
  if (!state.started || isConcluded(state)) {
    state.next = null;
    return;
  }
  for (let i = 0; i < state.courts; i++) {
    if (state.onCourt[i]) continue;
    // Picked fresh from everyone free right now (including whoever just came
    // off), leaning hard towards the players already shown as up next. When
    // exactly four people are waiting, locking the preview in would keep the
    // same two pairs cycling all night.
    const planned = new Set(state.next ? gamePlayers(state.next) : []);
    const picked = pickGame(state, planned, random);
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
  refreshNext(state, random);
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

function refreshNext(state: CasualPlayState, random: () => number, force = false): void {
  if (!state.started || isConcluded(state)) {
    state.next = null;
    return;
  }
  if (!force && previewStillValid(state, state.next)) return;
  const picked = pickGame(lookahead(state), new Set(), random);
  state.next = picked
    ? { id: 0, court: 0, teamA: picked.teamA, teamB: picked.teamB, startedAt: 0 }
    : null;
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
      const p = findPlayer(state, action.playerId);
      if (!p) throw new ActionError("Player not found");
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
      const n = clampCourts(action.courts);
      // Games on courts that no longer exist are called off; their players
      // go back to the queue without the game counting.
      state.onCourt = Array.from({ length: n }, (_, i) => state.onCourt[i] ?? null);
      state.courts = n;
      break;
    }
    case "start": {
      if (state.started) return state;
      state.concludedAt = null;
      state.started = true;
      for (const p of state.players) p.readyAt = now;
      break;
    }
    case "finish": {
      if (isConcluded(state)) throw new ActionError("The play day has been concluded");
      if (!state.onCourt[action.court - 1]) throw new ActionError("That court is already free");
      finishCourt(state, action.court, now);
      break;
    }
    case "conclude": {
      if (!state.started || isConcluded(state)) return state;
      // Whatever is on court when the night wraps up counts as played.
      for (let court = 1; court <= state.courts; court++) {
        if (state.onCourt[court - 1]) finishCourt(state, court, now);
      }
      state.next = null;
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
      if (!state.onCourt[action.court - 1]) throw new ActionError("That court is already free");
      state.onCourt[action.court - 1] = null;
      state.next = null;
      break;
    }
    case "reshuffleNext": {
      refreshNext(state, random, true);
      return state;
    }
    case "endSession": {
      const reset = emptyState(state.date, state.courts);
      reset.players = state.players.map((p) => ({ ...p, games: 0, paused: false, readyAt: now }));
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
    case "finish":
    case "void":
      return court(a.court);
    case "start":
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
