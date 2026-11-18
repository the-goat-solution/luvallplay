import crypto from "crypto";
import { sql, db } from "@vercel/postgres";
import { revalidateTag } from "next/cache";
import { ensurePlayerTables, getPlayerSetting, setPlayerSetting } from "./player-db";
import { ensureStatsTables, runStatsBackfill, syncRosterAttendance } from "./stats-db";
import { after } from "next/server";
import { hmac } from "./player-auth";
import { clubDateKeyForInstant, getClubToday } from "./dates";
import { DISPLAY_NAME_SQL, computeStreaks, initialsOf, periodRange, rankRows, type PeriodRange } from "./stats-periods";
import {
  ACCEPTED_LAPSE_DAYS,
  AUTO_CONFIRM_HOURS,
  CHECKIN_MIN_MINUTES_BEFORE_SCORE,
  CODE_ATTEMPTS_PER_10_MIN,
  CODE_TTL_SECONDS,
  GIANT_KILLER_STEPS,
  PAIR_REQUEST_TTL_SECONDS,
  SCORE_WINDOW_HOURS,
  SEAT_WINDOW_DAYS,
  UPKEEP_WINDOW_DAYS,
  WP,
  achievementsFrom,
  assignSeats,
  crownStillHeld,
  foursomeKey,
  indexForWp,
  isValidGameScore,
  pairKey,
  repeatMatchupBlocker,
  polish,
  progressToNext,
  replayChallenges,
  wpInWindow,
  type AchievementKey,
  type CrownEvent,
  type CrownState,
  type HistoryGame,
  type ReplayChallenge,
  type ReplayPlayerResult,
  type Seat,
  type WpEvent,
  type WpSource,
} from "./ranks";
import { onceThisDeploy } from "./schema-gate";

// The challenge feature ("The Arena"): pairs, 5-digit codes, challenges, and
// Wolf Points worked out from play days, round robin results and challenges.
// Plan: docs/plans/challenges.md.
//
// Preview deployments share the production database, so on a preview every
// table this feature owns gets a "pv_" prefix: test pairs and games never
// mix with real ones. Real attendance and round robin history are only read.

const PREFIX = process.env.ARENA_TABLE_PREFIX ?? (process.env.VERCEL_ENV === "preview" ? "pv_" : "");
export const T = {
  pairs: `${PREFIX}arena_pairs`,
  members: `${PREFIX}arena_pair_members`,
  codes: `${PREFIX}arena_codes`,
  attempts: `${PREFIX}arena_code_attempts`,
  challenges: `${PREFIX}arena_challenges`,
  after: `${PREFIX}arena_after_game`,
  ranks: `${PREFIX}arena_player_ranks`,
  matchStats: `${PREFIX}arena_match_stats`,
};
export const ARENA_SANDBOX = PREFIX !== "";

/** Minutes between check-in and entering a score (shorter on previews so testing doesn't stall). */
export const MIN_GAME_MINUTES = Number(process.env.ARENA_MIN_GAME_MINUTES ?? (process.env.VERCEL_ENV === "preview" ? 1 : CHECKIN_MIN_MINUTES_BEFORE_SCORE));

let ensurePromise: Promise<void> | null = null;
export function ensureArenaTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = onceThisDeploy("arena", async () => {
      await ensurePlayerTables();
      await ensureStatsTables();
      await sql.query(`
        CREATE TABLE IF NOT EXISTS ${T.pairs} (
          id SERIAL PRIMARY KEY,
          player_low INT NOT NULL,
          player_high INT NOT NULL,
          name TEXT,
          formed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMPTZ,
          ended_reason TEXT
        );`);
      await sql.query(`
        CREATE TABLE IF NOT EXISTS ${T.members} (
          pair_id INT NOT NULL,
          player_id INT NOT NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          PRIMARY KEY (pair_id, player_id)
        );`);
      // One current partner per player: two confirmations at the same moment can't both win.
      await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${T.members}_one_active ON ${T.members} (player_id) WHERE active;`);
      await sql.query(`
        CREATE TABLE IF NOT EXISTS ${T.codes} (
          id SERIAL PRIMARY KEY,
          purpose TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          owner_id INT NOT NULL,
          challenge_id INT,
          status TEXT NOT NULL DEFAULT 'live',
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_by INT,
          consumed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );`);
      await sql.query(`CREATE INDEX IF NOT EXISTS ${T.codes}_hash ON ${T.codes} (purpose, code_hash) WHERE status = 'live';`);
      await sql.query(`
        CREATE TABLE IF NOT EXISTS ${T.attempts} (
          player_id INT NOT NULL,
          at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );`);
      await sql.query(`
        CREATE TABLE IF NOT EXISTS ${T.challenges} (
          id SERIAL PRIMARY KEY,
          posting_pair INT NOT NULL,
          p1 INT NOT NULL,
          p2 INT NOT NULL,
          accepting_pair INT,
          a1 INT,
          a2 INT,
          note TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          available_until TIMESTAMPTZ NOT NULL,
          posted_by INT NOT NULL,
          posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          accepted_by INT,
          accepted_at TIMESTAMPTZ,
          called_off_by INT,
          checked_in_at TIMESTAMPTZ,
          played_on DATE,
          score_posting INT,
          score_accepting INT,
          retired_by TEXT,
          entered_by INT,
          entered_at TIMESTAMPTZ,
          confirmed_by INT,
          auto_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
          disputed_by INT,
          disputed_at TIMESTAMPTZ,
          dispute_note TEXT,
          resolved_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
          completed_at TIMESTAMPTZ,
          void_reason TEXT
        );`);
      await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${T.challenges}_one_open ON ${T.challenges} (posting_pair) WHERE status = 'open';`);
      await sql.query(`CREATE INDEX IF NOT EXISTS ${T.challenges}_status ON ${T.challenges} (status);`);
      await sql.query(`
        CREATE TABLE IF NOT EXISTS ${T.after} (
          challenge_id INT NOT NULL,
          player_id INT NOT NULL,
          keep_pair BOOLEAN,
          again BOOLEAN,
          answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (challenge_id, player_id)
        );`);
      // Match Analyzer stats a court assistant recorded for a challenge
      // (lib/match-stats-db.ts). One row per challenge; JSON shaped by
      // SavedMatchStats.
      await sql.query(`
        CREATE TABLE IF NOT EXISTS ${T.matchStats} (
          challenge_id INT PRIMARY KEY,
          recorded_by INT NOT NULL,
          stats JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );`);
      // Wolf Vision live tracking: a phone set up for the game sends a heartbeat.
      // status 'tracking' until the assistant saves the final numbers ('final').
      await sql.query(`ALTER TABLE ${T.matchStats} ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'final';`);
      await sql.query(`ALTER TABLE ${T.matchStats} ADD COLUMN IF NOT EXISTS live JSONB;`);
      await sql.query(`ALTER TABLE ${T.matchStats} ADD COLUMN IF NOT EXISTS live_at TIMESTAMPTZ;`);
      await sql.query(`
        CREATE TABLE IF NOT EXISTS ${T.ranks} (
          player_id INT PRIMARY KEY,
          seen_index INT NOT NULL DEFAULT 0,
          peak_index INT NOT NULL DEFAULT 0,
          was_tarnished BOOLEAN NOT NULL DEFAULT FALSE,
          polished_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );`);
    }).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

export class ArenaError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function refresh(): void {
  try {
    revalidateTag("leaderboard");
  } catch {
    // outside a request
  }
}

// ---------------------------------------------------------------------------
// NZ time helpers
// ---------------------------------------------------------------------------

function nzOffsetMinutes(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Auckland",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** 23:59:59 NZ time on the given club date. */
export function nzEndOfDay(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59);
  return new Date(guess - nzOffsetMinutes(new Date(guess)) * 60000);
}

// ---------------------------------------------------------------------------
// Loading the world: players, points, pairs, challenges
// ---------------------------------------------------------------------------

export type ChallengeStatus = "open" | "accepted" | "live" | "awaiting" | "completed" | "disputed" | "void" | "expired" | "cancelled" | "lapsed";

export type ChallengeRow = {
  id: number;
  postingPair: number;
  postingPlayers: [number, number];
  acceptingPair: number | null;
  acceptingPlayers: [number, number] | null;
  note: string | null;
  status: ChallengeStatus;
  availableUntil: string;
  postedAt: string;
  acceptedAt: string | null;
  checkedInAt: string | null;
  playedOn: string | null;
  scorePosting: number | null;
  scoreAccepting: number | null;
  retiredBy: "posting" | "accepting" | null;
  enteredBy: number | null;
  enteredAt: string | null;
  confirmedBy: number | null;
  autoConfirmed: boolean;
  disputedBy: number | null;
  disputeNote: string | null;
  completedAt: string | null;
  calledOffBy: number | null;
  voidReason: string | null;
};

function mapChallenge(r: Record<string, unknown>): ChallengeRow {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: r.id as number,
    postingPair: r.posting_pair as number,
    postingPlayers: [r.p1 as number, r.p2 as number],
    acceptingPair: (r.accepting_pair as number) ?? null,
    acceptingPlayers: r.a1 ? [r.a1 as number, r.a2 as number] : null,
    note: (r.note as string) ?? null,
    status: r.status as ChallengeStatus,
    availableUntil: iso(r.available_until)!,
    postedAt: iso(r.posted_at)!,
    acceptedAt: iso(r.accepted_at),
    checkedInAt: iso(r.checked_in_at),
    playedOn: r.played_on ? String(r.played_on).slice(0, 10) : null,
    scorePosting: (r.score_posting as number) ?? null,
    scoreAccepting: (r.score_accepting as number) ?? null,
    retiredBy: (r.retired_by as "posting" | "accepting") ?? null,
    enteredBy: (r.entered_by as number) ?? null,
    enteredAt: iso(r.entered_at),
    confirmedBy: (r.confirmed_by as number) ?? null,
    autoConfirmed: Boolean(r.auto_confirmed),
    disputedBy: (r.disputed_by as number) ?? null,
    disputeNote: (r.dispute_note as string) ?? null,
    completedAt: iso(r.completed_at),
    calledOffBy: (r.called_off_by as number) ?? null,
    voidReason: (r.void_reason as string) ?? null,
  };
}

export type ArenaPlayer = { id: number; name: string; firstName: string; initials: string; visible: boolean; email: string; avatarUrl?: string | null };
export type PairRow = { id: number; players: [number, number]; name: string | null; formedAt: string; endedAt: string | null };

export type PlayerRank = {
  wpTotal: number;
  wpPlayDays: number;
  wpRoundRobin: number;
  wpChallenges: number;
  wpBonuses: number;
  wp90: number;
  wp60: number;
  earned: number;
  shown: number;
  tarnishing: boolean;
  daysToSlip: number | null;
  progress: number;
  seat: Seat | null;
};

export type ResultWithRank = ReplayPlayerResult & { rankBefore: number; rankAfter: number };

export type World = {
  today: string;
  players: Map<number, ArenaPlayer>;
  ranks: Map<number, PlayerRank>;
  events: Map<number, WpEvent[]>;
  pairs: Map<number, PairRow>;
  activePairOf: Map<number, PairRow>;
  challenges: ChallengeRow[];
  results: ResultWithRank[];
  crown: CrownState;
  crownEvents: Map<number, CrownEvent>;
  streakOf: Map<number, number>;
  facedBy: Map<number, Set<number>>;
  attendedDates: Map<number, string[]>;
  clubDays: string[];
  peaks: Map<number, { seen: number; peak: number; wasTarnished: boolean; polishedAt: string | null }>;
  /** Challenges with Match Analyzer stats saved. */
  statsFor: Set<number>;
  /** Challenges a phone is tracking right now (Wolf Vision heartbeat in the last 90 s). */
  trackingFor: Map<number, { rallies: number; hits: number; quality: number }>;
};

const ACTIVE: ChallengeStatus[] = ["accepted", "live", "awaiting", "disputed"];

/** Expire, lapse and auto-confirm on the way in (no cron needed). */
let lastTick = 0;
export async function tick(force = false): Promise<void> {
  if (!force && Date.now() - lastTick < 15_000) return;
  lastTick = Date.now();
  // Independent housekeeping updates: one round trip together.
  const [, , , confirmed] = await Promise.all([
    sql.query(`UPDATE ${T.challenges} SET status = 'expired' WHERE status = 'open' AND available_until < NOW();`),
    sql.query(`UPDATE ${T.challenges} SET status = 'lapsed' WHERE status = 'accepted' AND accepted_at < NOW() - ($1 * INTERVAL '1 day');`, [ACCEPTED_LAPSE_DAYS]),
    sql.query(`UPDATE ${T.challenges} SET status = 'lapsed' WHERE status = 'live' AND checked_in_at < NOW() - ($1 * INTERVAL '1 hour');`, [SCORE_WINDOW_HOURS]),
    sql.query(
      `UPDATE ${T.challenges} SET status = 'completed', auto_confirmed = TRUE, completed_at = NOW()
       WHERE status = 'awaiting' AND entered_at < NOW() - ($1 * INTERVAL '1 hour');`,
      [AUTO_CONFIRM_HOURS],
    ),
    sql.query(`UPDATE ${T.codes} SET status = 'expired' WHERE status IN ('live', 'requested') AND expires_at < NOW();`),
  ]);
  const rowCount = confirmed.rowCount;
  if (rowCount) refresh();
}

let cachedWorld: { at: number; world: Promise<World> } | null = null;

/** Drops the cached snapshot (after any change). */
export function invalidateWorld(): void {
  cachedWorld = null;
}

/**
 * The read-only board can reuse a snapshot for a few seconds (many players
 * polling every 5 s); every action loads fresh.
 */
export function loadWorldCached(maxAgeMs: number): Promise<World> {
  if (cachedWorld && Date.now() - cachedWorld.at < maxAgeMs) return cachedWorld.world;
  const world = loadWorld();
  cachedWorld = { at: Date.now(), world };
  world.catch(() => {
    if (cachedWorld?.world === world) cachedWorld = null;
  });
  return world;
}

// ---------------------------------------------------------------------------
// Keeping points current
// ---------------------------------------------------------------------------

// Bump to recalculate everyone once more (each environment's ranks are kept
// separately, so production and previews each run it once).
const RECALC_KEY = `points_recalc_2026_11_ladder1200${PREFIX ? `:${PREFIX}` : ""}`;
let pointsSyncedAt = 0;

/**
 * Play days from the sign-up list, hourly per server instance; the first
 * time (per RECALC_KEY) a full recalculation instead. Runs after the
 * response, so nobody waits for it.
 */
export async function syncPoints(): Promise<void> {
  if (!process.env.POSTGRES_URL || Date.now() - pointsSyncedAt < 60 * 60 * 1000) return;
  pointsSyncedAt = Date.now();
  try {
    if (!(await getPlayerSetting(RECALC_KEY))) {
      await recalculateAllPoints();
      await setPlayerSetting(RECALC_KEY, new Date().toISOString());
    } else {
      await syncRosterAttendance(true);
    }
    invalidateWorld();
  } catch (err) {
    pointsSyncedAt = 0;
    console.error("[arena] points sync failed:", err);
  }
}

function syncPointsLater(): void {
  if (Date.now() - pointsSyncedAt < 60 * 60 * 1000) return;
  try {
    after(() => syncPoints());
  } catch {
    void syncPoints();
  }
}

/**
 * Recalculates everyone from the records: play days rebuilt from the sign-up
 * lists, round robin results re-read from every draw, then each player's
 * stored peak rank set back to what their points earn now (a peak reached
 * on points that were wrong no longer holds them up). The new rank counts as
 * seen, so nobody gets a rank-up screen for the recalculation (or a ladder
 * change) itself.
 */
export async function recalculateAllPoints(): Promise<{ attendance: number; roundRobin: number; players: number }> {
  const backfill = await runStatsBackfill();
  invalidateWorld();
  const world = await loadWorld({ skipSync: true });
  let players = 0;
  for (const [id, r] of world.ranks) {
    const earned = indexForWp(r.wpTotal);
    const { rowCount } = await sql.query(
      `UPDATE ${T.ranks} SET peak_index = $2, seen_index = $2, updated_at = NOW()
       WHERE player_id = $1 AND (peak_index <> $2 OR seen_index <> $2);`,
      [id, earned],
    );
    players += rowCount ?? 0;
  }
  invalidateWorld();
  refresh();
  return { ...backfill, players };
}

export async function loadWorld(opts: { skipSync?: boolean } = {}): Promise<World> {
  await ensureArenaTables();
  if (!opts.skipSync) syncPointsLater();
  await tick();
  const today = getClubToday().dateKey;
  const [pl, att, rr, pairs, members, ch, peaks, club, stats] = await Promise.all([
    sql.query(
      `SELECT p.id, p.email, p.first_name, ${DISPLAY_NAME_SQL} AS name, p.leaderboard_visible, p.avatar_url
       FROM players p WHERE p.deleted_at IS NULL;`,
    ),
    sql.query(
      `SELECT p.id, a.session_date::text AS d FROM attendance a JOIN players p ON p.email = a.email
       WHERE a.verified AND NOT a.removed AND p.deleted_at IS NULL;`,
    ),
    sql.query(
      `SELECT p.id, r.session_date::text AS d, r.rr_points FROM rr_results r
       JOIN players p ON lower(p.minigame_name) = lower(r.mg_name) WHERE p.deleted_at IS NULL;`,
    ),
    sql.query(`SELECT * FROM ${T.pairs};`),
    sql.query(`SELECT pair_id, player_id FROM ${T.members} WHERE active;`),
    sql.query(`SELECT * FROM ${T.challenges} ORDER BY id;`),
    sql.query(`SELECT * FROM ${T.ranks};`),
    sql.query(`SELECT date::text AS d FROM sessions WHERE date <= $1 ORDER BY date;`, [today]),
    sql.query(`SELECT challenge_id, status, live, (live_at > NOW() - INTERVAL '90 seconds') AS fresh FROM ${T.matchStats};`),
  ]);

  const players = new Map<number, ArenaPlayer>();
  for (const r of pl.rows) {
    players.set(r.id, {
      id: r.id,
      name: r.name,
      firstName: (r.first_name as string) || (r.name as string),
      initials: initialsOf(r.name),
      visible: r.leaderboard_visible,
      email: r.email,
      avatarUrl: (r.avatar_url as string | null) ?? null,
    });
  }

  const baseEvents = new Map<number, WpEvent[]>();
  const attendedDates = new Map<number, string[]>();
  const push = (m: Map<number, WpEvent[]>, id: number, e: WpEvent) => m.set(id, [...(m.get(id) ?? []), e]);
  for (const r of att.rows) {
    push(baseEvents, r.id, { date: r.d, points: WP.playDay, source: "play" });
    attendedDates.set(r.id, [...(attendedDates.get(r.id) ?? []), r.d]);
  }
  const rrTotals = new Map<number, number>();
  for (const r of rr.rows) {
    push(baseEvents, r.id, { date: r.d, points: r.rr_points, source: "rr" });
    rrTotals.set(r.id, (rrTotals.get(r.id) ?? 0) + (r.rr_points as number));
  }

  const pairMap = new Map<number, PairRow>();
  for (const r of pairs.rows) {
    pairMap.set(r.id, {
      id: r.id,
      players: [r.player_low, r.player_high],
      name: r.name ?? null,
      formedAt: new Date(r.formed_at).toISOString(),
      endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
    });
  }
  const activePairOf = new Map<number, PairRow>();
  for (const r of members.rows) {
    const p = pairMap.get(r.pair_id);
    if (p) activePairOf.set(r.player_id, p);
  }

  const challenges = ch.rows.map(mapChallenge);
  const completed = challenges.filter((c) => c.status === "completed" && c.acceptingPair && c.acceptingPlayers);
  const replayInput: ReplayChallenge[] = completed.map((c) => ({
    id: c.id,
    at: c.completedAt ?? c.enteredAt ?? c.postedAt,
    date: c.playedOn ?? today,
    posting: { pairId: c.postingPair, players: c.postingPlayers },
    accepting: { pairId: c.acceptingPair!, players: c.acceptingPlayers! },
    postingScore: c.scorePosting,
    acceptingScore: c.scoreAccepting,
    retiredBy: c.retiredBy,
  }));
  const baseBefore = (id: number, date: string) => (baseEvents.get(id) ?? []).reduce((s, e) => (e.date <= date ? s + e.points : s), 0);
  const ended = new Map<number, string>();
  for (const p of pairMap.values()) if (p.endedAt) ended.set(p.id, clubDateKeyForInstant(new Date(p.endedAt)));
  const replay = replayChallenges(replayInput, baseBefore, ended);

  // Rank before/after each result, for the feed.
  const runningChallengeWp = new Map<number, number>();
  const orderedIds = [...replayInput].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id).map((c) => c.id);
  const results: ResultWithRank[] = [];
  for (const id of orderedIds) {
    for (const r of replay.results.filter((x) => x.challengeId === id)) {
      const before = baseBefore(r.playerId, r.date) + (runningChallengeWp.get(r.playerId) ?? 0);
      results.push({ ...r, rankBefore: indexForWp(before), rankAfter: indexForWp(before + r.total) });
    }
    for (const r of replay.results.filter((x) => x.challengeId === id)) {
      runningChallengeWp.set(r.playerId, (runningChallengeWp.get(r.playerId) ?? 0) + r.total);
    }
  }

  const events = new Map<number, WpEvent[]>();
  for (const [id, ev] of baseEvents) events.set(id, [...ev]);
  for (const r of replay.results) push(events, r.playerId, { date: r.date, points: r.total, source: "challenge" });

  const peakMap = new Map<number, { seen: number; peak: number; wasTarnished: boolean; polishedAt: string | null }>();
  for (const r of peaks.rows) {
    peakMap.set(r.player_id, {
      seen: r.seen_index,
      peak: r.peak_index,
      wasTarnished: r.was_tarnished,
      polishedAt: r.polished_at ? new Date(r.polished_at).toISOString() : null,
    });
  }

  const ranks = new Map<number, PlayerRank>();
  const seatInput: { id: number; earned: number; wp90: number; wpTotal: number }[] = [];
  for (const id of players.keys()) {
    const ev = events.get(id) ?? [];
    const wpTotal = ev.reduce((s, e) => s + e.points, 0);
    const res = replay.results.filter((r) => r.playerId === id);
    const earned = Math.max(indexForWp(wpTotal), peakMap.get(id)?.peak ?? 0);
    const p = polish(earned, ev, today);
    const rank: PlayerRank = {
      wpTotal,
      wpPlayDays: (attendedDates.get(id) ?? []).length * WP.playDay,
      wpRoundRobin: rrTotals.get(id) ?? 0,
      wpChallenges: res.reduce((s, r) => s + r.base, 0),
      wpBonuses: res.reduce((s, r) => s + r.total - r.base, 0),
      wp90: wpInWindow(ev, today, SEAT_WINDOW_DAYS),
      wp60: wpInWindow(ev, today, UPKEEP_WINDOW_DAYS),
      earned,
      shown: p.shown,
      tarnishing: p.tarnishing,
      daysToSlip: p.daysToSlip,
      progress: progressToNext(wpTotal, Math.min(earned, indexForWp(wpTotal))),
      seat: null,
    };
    ranks.set(id, rank);
    seatInput.push({ id, earned, wp90: rank.wp90, wpTotal });
  }
  for (const [id, seat] of assignSeats(seatInput)) ranks.get(id)!.seat = seat;

  const streakOf = new Map<number, number>();
  const facedBy = new Map<number, Set<number>>();
  for (const id of orderedIds) {
    const rs = replay.results.filter((r) => r.challengeId === id);
    const c = completed.find((x) => x.id === id)!;
    if (c.retiredBy) continue;
    for (const r of rs) streakOf.set(r.playerId, r.won ? (streakOf.get(r.playerId) ?? 0) + 1 : 0);
    for (const a of c.postingPlayers)
      for (const b of c.acceptingPlayers!) {
        facedBy.set(a, (facedBy.get(a) ?? new Set()).add(b));
        facedBy.set(b, (facedBy.get(b) ?? new Set()).add(a));
      }
  }

  return {
    today,
    players,
    ranks,
    events,
    pairs: pairMap,
    activePairOf,
    challenges,
    results,
    crown: crownStillHeld(replay.crown, today, ended),
    crownEvents: new Map(replay.crownHistory.map((h) => [h.challengeId, h.kind])),
    streakOf,
    facedBy,
    attendedDates,
    clubDays: club.rows.map((r) => r.d as string),
    peaks: peakMap,
    statsFor: new Set(stats.rows.filter((r) => r.status === "final").map((r) => r.challenge_id as number)),
    trackingFor: new Map(
      stats.rows
        .filter((r) => r.fresh && r.live && !(r.live as { ended?: boolean }).ended)
        .map((r) => {
          const l = r.live as { rallies?: number; hits?: number; quality?: number };
          return [r.challenge_id as number, { rallies: l.rallies ?? 0, hits: l.hits ?? 0, quality: l.quality ?? 0 }];
        }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Codes and attempts
// ---------------------------------------------------------------------------

const codeHash = (purpose: string, code: string) => hmac(`arena:${purpose}:${code}`);

async function checkAttempts(playerId: number): Promise<void> {
  const { rows } = await sql.query(
    `SELECT count(*)::int AS n FROM ${T.attempts} WHERE player_id = $1 AND at > NOW() - INTERVAL '10 minutes';`,
    [playerId],
  );
  if ((rows[0]?.n ?? 0) >= CODE_ATTEMPTS_PER_10_MIN) throw new ArenaError("too_many_tries");
}

async function recordFailedAttempt(playerId: number): Promise<void> {
  await sql.query(`INSERT INTO ${T.attempts} (player_id) VALUES ($1);`, [playerId]);
  await sql.query(`DELETE FROM ${T.attempts} WHERE at < NOW() - INTERVAL '1 day';`);
}

async function issueCode(purpose: "pair" | "checkin", ownerId: number, challengeId: number | null): Promise<{ code: string; expiresAt: string }> {
  await sql.query(
    `UPDATE ${T.codes} SET status = 'replaced' WHERE owner_id = $1 AND purpose = $2 AND status = 'live' AND coalesce(challenge_id, 0) = $3;`,
    [ownerId, purpose, challengeId ?? 0],
  );
  for (let i = 0; i < 8; i++) {
    const code = String(crypto.randomInt(10000, 100000));
    const hash = codeHash(purpose, code);
    const clash = await sql.query(
      `SELECT 1 FROM ${T.codes} WHERE purpose = $1 AND code_hash = $2 AND status IN ('live', 'requested') AND expires_at > NOW();`,
      [purpose, hash],
    );
    if (clash.rowCount) continue;
    const { rows } = await sql.query(
      `INSERT INTO ${T.codes} (purpose, code_hash, owner_id, challenge_id, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5 * INTERVAL '1 second')) RETURNING expires_at;`,
      [purpose, hash, ownerId, challengeId, CODE_TTL_SECONDS],
    );
    return { code, expiresAt: new Date(rows[0].expires_at).toISOString() };
  }
  throw new ArenaError("try_again");
}

const cleanCode = (raw: string) => raw.replace(/\D/g, "");

// ---------------------------------------------------------------------------
// Pairs
// ---------------------------------------------------------------------------

function busyChallengeFor(world: World, pairId: number): ChallengeRow | undefined {
  return world.challenges.find(
    (c) => ACTIVE.includes(c.status) && (c.postingPair === pairId || c.acceptingPair === pairId),
  );
}

export async function createPairCode(playerId: number): Promise<{ code: string; expiresAt: string }> {
  await ensureArenaTables();
  return issueCode("pair", playerId, null);
}

export async function enterPairCode(playerId: number, raw: string): Promise<{ ownerId: number }> {
  await ensureArenaTables();
  await checkAttempts(playerId);
  const code = cleanCode(raw);
  if (code.length !== 5) throw new ArenaError("bad_code");
  const { rows } = await sql.query(
    `UPDATE ${T.codes} SET status = 'requested', consumed_by = $3, consumed_at = NOW(),
       expires_at = NOW() + ($4 * INTERVAL '1 second')
     WHERE id = (SELECT id FROM ${T.codes} WHERE purpose = 'pair' AND code_hash = $1 AND status = 'live'
                   AND expires_at > NOW() AND owner_id <> $2 ORDER BY id DESC LIMIT 1)
     RETURNING owner_id;`,
    [codeHash("pair", code), playerId, playerId, PAIR_REQUEST_TTL_SECONDS],
  );
  if (!rows.length) {
    const own = await sql.query(
      `SELECT 1 FROM ${T.codes} WHERE purpose = 'pair' AND code_hash = $1 AND status = 'live' AND owner_id = $2;`,
      [codeHash("pair", code), playerId],
    );
    if (own.rowCount) throw new ArenaError("own_code");
    await recordFailedAttempt(playerId);
    throw new ArenaError("bad_code");
  }
  return { ownerId: rows[0].owner_id };
}

export async function cancelPairRequest(playerId: number): Promise<void> {
  await sql.query(
    `UPDATE ${T.codes} SET status = 'cancelled' WHERE purpose = 'pair' AND status IN ('requested', 'live') AND (consumed_by = $1 OR owner_id = $1);`,
    [playerId],
  );
}

async function endPair(client: { query: typeof sql.query }, pairId: number, reason: string): Promise<void> {
  await client.query(`UPDATE ${T.pairs} SET ended_at = NOW(), ended_reason = $2 WHERE id = $1 AND ended_at IS NULL;`, [pairId, reason]);
  await client.query(`UPDATE ${T.members} SET active = FALSE WHERE pair_id = $1;`, [pairId]);
  await client.query(`UPDATE ${T.challenges} SET status = 'cancelled' WHERE posting_pair = $1 AND status = 'open';`, [pairId]);
}

export async function respondPairRequest(ownerId: number, accept: boolean): Promise<void> {
  await ensureArenaTables();
  const { rows } = await sql.query(
    `SELECT id, consumed_by FROM ${T.codes} WHERE purpose = 'pair' AND owner_id = $1 AND status = 'requested' AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1;`,
    [ownerId],
  );
  if (!rows.length) throw new ArenaError("request_gone");
  const requesterId = rows[0].consumed_by as number;
  if (!accept) {
    await sql.query(`UPDATE ${T.codes} SET status = 'declined' WHERE id = $1;`, [rows[0].id]);
    return;
  }
  const world = await loadWorld();
  for (const p of [ownerId, requesterId]) {
    const pair = world.activePairOf.get(p);
    if (pair && busyChallengeFor(world, pair.id)) throw new ArenaError("pair_busy");
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const p of [ownerId, requesterId]) {
      const pair = world.activePairOf.get(p);
      if (pair) await endPair(client, pair.id, "repaired");
    }
    const [lo, hi] = ownerId < requesterId ? [ownerId, requesterId] : [requesterId, ownerId];
    const { rows: made } = await client.query(
      `INSERT INTO ${T.pairs} (player_low, player_high) VALUES ($1, $2) RETURNING id;`,
      [lo, hi],
    );
    await client.query(`INSERT INTO ${T.members} (pair_id, player_id) VALUES ($1, $2), ($1, $3);`, [made[0].id, lo, hi]);
    await client.query(`UPDATE ${T.codes} SET status = 'accepted' WHERE id = $1;`, [rows[0].id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if ((err as { code?: string }).code === "23505") throw new ArenaError("try_again");
    throw err;
  } finally {
    client.release();
  }
}

export async function leavePair(playerId: number): Promise<void> {
  const world = await loadWorld();
  const pair = world.activePairOf.get(playerId);
  if (!pair) return;
  if (busyChallengeFor(world, pair.id)) throw new ArenaError("pair_busy");
  await endPair(sql, pair.id, "unpaired");
}

const BLOCKED_WORDS = ["fuck", "shit", "cunt", "bitch", "dick", "nigg", "đụ", "địt", "lồn", "cặc"];
export async function renamePair(playerId: number, raw: string): Promise<void> {
  const world = await loadWorld();
  const pair = world.activePairOf.get(playerId);
  if (!pair) throw new ArenaError("no_pair");
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 24);
  if (name && BLOCKED_WORDS.some((w) => name.toLowerCase().includes(w))) throw new ArenaError("bad_name");
  await sql.query(`UPDATE ${T.pairs} SET name = $2 WHERE id = $1;`, [pair.id, name || null]);
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

function participantSide(c: ChallengeRow, playerId: number): "posting" | "accepting" | null {
  if (c.postingPlayers.includes(playerId)) return "posting";
  if (c.acceptingPlayers?.includes(playerId)) return "accepting";
  return null;
}

async function getChallenge(id: number): Promise<ChallengeRow> {
  const { rows } = await sql.query(`SELECT * FROM ${T.challenges} WHERE id = $1;`, [id]);
  if (!rows.length) throw new ArenaError("not_found");
  return mapChallenge(rows[0]);
}

export async function postChallenge(playerId: number, days: number, rawNote: string): Promise<void> {
  const world = await loadWorld();
  const pair = world.activePairOf.get(playerId);
  if (!pair) throw new ArenaError("no_pair");
  if (busyChallengeFor(world, pair.id)) throw new ArenaError("pair_busy");
  if (world.challenges.some((c) => c.status === "open" && c.postingPair === pair.id)) throw new ArenaError("already_up");
  const until = nzEndOfDay(addDaysKey(world.today, Math.max(0, Math.min(7, Math.round(days)))));
  const note = rawNote.replace(/\s+/g, " ").trim().slice(0, 120) || null;
  try {
    await sql.query(
      `INSERT INTO ${T.challenges} (posting_pair, p1, p2, note, available_until, posted_by) VALUES ($1, $2, $3, $4, $5, $6);`,
      [pair.id, pair.players[0], pair.players[1], note, until.toISOString(), playerId],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new ArenaError("already_up");
    throw err;
  }
}

function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function cancelChallenge(playerId: number, id: number): Promise<void> {
  const c = await getChallenge(id);
  if (participantSide(c, playerId) !== "posting") throw new ArenaError("not_yours");
  await sql.query(`UPDATE ${T.challenges} SET status = 'cancelled' WHERE id = $1 AND status = 'open';`, [id]);
}

/** Why a pair can't take a challenge on, or null if it can. */
export function acceptBlocker(world: World, c: ChallengeRow, playerId: number): string | null {
  const pair = world.activePairOf.get(playerId);
  if (!pair) return "no_pair";
  if (c.status !== "open") return "not_open";
  if (pair.id === c.postingPair) return "own";
  if (pair.players.some((p) => c.postingPlayers.includes(p))) return "own";
  if (busyChallengeFor(world, pair.id)) return "pair_busy";
  const four = foursomeKey([...pair.players, ...c.postingPlayers]);
  const counted = world.challenges.filter((x) => x.acceptedAt && [...ACTIVE, "completed"].includes(x.status));
  const sameFour = counted.filter((x) => x.acceptingPlayers && foursomeKey([...x.postingPlayers, ...x.acceptingPlayers]) === four);
  // Revenge rematches are welcome; only the same four trading wins over and
  // over is capped (lib/ranks.ts CAPS). A player's own daily total isn't.
  return repeatMatchupBlocker(
    sameFour.map((x) => clubDateKeyForInstant(new Date(x.acceptedAt!))),
    world.today,
  );
}

export async function acceptChallenge(playerId: number, id: number): Promise<void> {
  const world = await loadWorld();
  const c = world.challenges.find((x) => x.id === id);
  if (!c) throw new ArenaError("not_found");
  const blocker = acceptBlocker(world, c, playerId);
  if (blocker) throw new ArenaError(blocker);
  const pair = world.activePairOf.get(playerId)!;
  const { rowCount } = await sql.query(
    `UPDATE ${T.challenges} SET status = 'accepted', accepting_pair = $2, a1 = $3, a2 = $4, accepted_by = $5, accepted_at = NOW()
     WHERE id = $1 AND status = 'open' AND available_until > NOW();`,
    [id, pair.id, pair.players[0], pair.players[1], playerId],
  );
  if (!rowCount) throw new ArenaError("not_open");
  // A pair that takes a challenge on is no longer up for one of its own.
  await sql.query(`UPDATE ${T.challenges} SET status = 'cancelled' WHERE posting_pair = $1 AND status = 'open';`, [pair.id]);
}

export async function callOffChallenge(playerId: number, id: number): Promise<void> {
  const c = await getChallenge(id);
  if (!participantSide(c, playerId)) throw new ArenaError("not_yours");
  await sql.query(`UPDATE ${T.challenges} SET status = 'cancelled', called_off_by = $2 WHERE id = $1 AND status = 'accepted';`, [id, playerId]);
}

export async function checkinCode(playerId: number, id: number): Promise<{ code: string; expiresAt: string }> {
  const c = await getChallenge(id);
  if (participantSide(c, playerId) !== "accepting") throw new ArenaError("not_yours");
  if (c.status !== "accepted") throw new ArenaError("not_accepted");
  return issueCode("checkin", playerId, id);
}

export async function checkIn(playerId: number, id: number, raw: string): Promise<void> {
  const c = await getChallenge(id);
  if (participantSide(c, playerId) !== "posting") throw new ArenaError("not_yours");
  if (c.status !== "accepted") throw new ArenaError("not_accepted");
  await checkAttempts(playerId);
  const code = cleanCode(raw);
  const { rows } = await sql.query(
    `UPDATE ${T.codes} SET status = 'used', consumed_by = $3, consumed_at = NOW()
     WHERE purpose = 'checkin' AND challenge_id = $1 AND code_hash = $2 AND status = 'live' AND expires_at > NOW()
     RETURNING id;`,
    [id, codeHash("checkin", code), playerId],
  );
  if (!rows.length) {
    await recordFailedAttempt(playerId);
    throw new ArenaError("bad_code");
  }
  await sql.query(
    `UPDATE ${T.challenges} SET status = 'live', checked_in_at = NOW(), played_on = $2 WHERE id = $1 AND status = 'accepted';`,
    [id, getClubToday().dateKey],
  );
}

export async function enterScore(
  playerId: number,
  id: number,
  input: { posting: number; accepting: number } | { retiredBy: "posting" | "accepting" },
): Promise<void> {
  const c = await getChallenge(id);
  if (!participantSide(c, playerId)) throw new ArenaError("not_yours");
  if (c.status !== "live") throw new ArenaError("not_live");
  if (Date.now() - Date.parse(c.checkedInAt!) < MIN_GAME_MINUTES * 60_000) throw new ArenaError("too_soon");
  if ("retiredBy" in input) {
    await sql.query(
      `UPDATE ${T.challenges} SET status = 'awaiting', retired_by = $2, score_posting = NULL, score_accepting = NULL,
         entered_by = $3, entered_at = NOW() WHERE id = $1 AND status = 'live';`,
      [id, input.retiredBy, playerId],
    );
    return;
  }
  if (!isValidGameScore(input.posting, input.accepting)) throw new ArenaError("bad_score");
  await sql.query(
    `UPDATE ${T.challenges} SET status = 'awaiting', score_posting = $2, score_accepting = $3, retired_by = NULL,
       entered_by = $4, entered_at = NOW() WHERE id = $1 AND status = 'live';`,
    [id, input.posting, input.accepting, playerId],
  );
}

export async function confirmScore(playerId: number, id: number): Promise<void> {
  const c = await getChallenge(id);
  const side = participantSide(c, playerId);
  if (!side) throw new ArenaError("not_yours");
  if (c.status !== "awaiting") throw new ArenaError("not_awaiting");
  if (c.enteredBy && participantSide(c, c.enteredBy) === side) throw new ArenaError("other_pair_confirms");
  await sql.query(
    `UPDATE ${T.challenges} SET status = 'completed', confirmed_by = $2, completed_at = NOW() WHERE id = $1 AND status = 'awaiting';`,
    [id, playerId],
  );
  refresh();
}

export async function disputeScore(playerId: number, id: number, note: string): Promise<void> {
  const c = await getChallenge(id);
  const side = participantSide(c, playerId);
  if (!side) throw new ArenaError("not_yours");
  if (c.status !== "awaiting") throw new ArenaError("not_awaiting");
  if (c.enteredBy && participantSide(c, c.enteredBy) === side) throw new ArenaError("other_pair_confirms");
  await sql.query(
    `UPDATE ${T.challenges} SET status = 'disputed', disputed_by = $2, disputed_at = NOW(), dispute_note = $3 WHERE id = $1 AND status = 'awaiting';`,
    [id, playerId, note.trim().slice(0, 300) || null],
  );
}

export async function answerAfterGame(playerId: number, id: number, keep: boolean, again: boolean): Promise<void> {
  const c = await getChallenge(id);
  const side = participantSide(c, playerId);
  if (!side || c.status !== "completed") throw new ArenaError("not_yours");
  await sql.query(
    `INSERT INTO ${T.after} (challenge_id, player_id, keep_pair, again) VALUES ($1, $2, $3, $4)
     ON CONFLICT (challenge_id, player_id) DO UPDATE SET keep_pair = EXCLUDED.keep_pair, again = EXCLUDED.again, answered_at = NOW();`,
    [id, playerId, keep, again],
  );
  const pairId = side === "posting" ? c.postingPair : c.acceptingPair!;
  const world = await loadWorld();
  const current = world.activePairOf.get(playerId);
  if (!keep) {
    if (current?.id === pairId && !busyChallengeFor(world, pairId)) await endPair(sql, pairId, "declined_after_match");
    return;
  }
  if (again && current?.id === pairId && !busyChallengeFor(world, pairId) && !world.challenges.some((x) => x.status === "open" && x.postingPair === pairId)) {
    await postChallenge(playerId, 3, "");
  }
}

export async function markRankSeen(playerId: number): Promise<void> {
  const world = await loadWorld();
  const r = world.ranks.get(playerId);
  if (!r) return;
  await sql.query(
    `INSERT INTO ${T.ranks} (player_id, seen_index, peak_index) VALUES ($1, $2, $2)
     ON CONFLICT (player_id) DO UPDATE SET seen_index = GREATEST(${T.ranks}.seen_index, $2), updated_at = NOW();`,
    [playerId, r.earned],
  );
}

/**
 * Keeps a player's stored peak, first-seen rank and tarnish history up to
 * date. A brand-new row starts "seen" at the current rank, so nobody gets a
 * flood of rank-up screens on launch day.
 */
export async function syncPlayerRank(world: World, playerId: number): Promise<{ seen: number; polishedAt: string | null }> {
  const r = world.ranks.get(playerId);
  if (!r) return { seen: 0, polishedAt: null };
  // Read fresh: the world may be a cached snapshot.
  const { rows: own } = await sql.query(`SELECT * FROM ${T.ranks} WHERE player_id = $1;`, [playerId]);
  const stored = own[0]
    ? {
        seen: own[0].seen_index as number,
        peak: own[0].peak_index as number,
        wasTarnished: own[0].was_tarnished as boolean,
        polishedAt: own[0].polished_at ? new Date(own[0].polished_at).toISOString() : null,
      }
    : undefined;
  if (!stored) {
    await sql.query(
      `INSERT INTO ${T.ranks} (player_id, seen_index, peak_index, was_tarnished) VALUES ($1, $2, $2, $3) ON CONFLICT DO NOTHING;`,
      [playerId, r.earned, r.tarnishing],
    );
    return { seen: r.earned, polishedAt: null };
  }
  let polishedAt = stored.polishedAt;
  const polished = stored.wasTarnished && !r.tarnishing;
  if (polished) polishedAt = new Date().toISOString();
  if (r.earned > stored.peak || r.tarnishing !== stored.wasTarnished) {
    await sql.query(
      `UPDATE ${T.ranks} SET peak_index = GREATEST(peak_index, $2), was_tarnished = $3,
         polished_at = CASE WHEN $4 THEN NOW() ELSE polished_at END, updated_at = NOW() WHERE player_id = $1;`,
      [playerId, r.earned, r.tarnishing, polished],
    );
  }
  return { seen: stored.seen, polishedAt };
}

// ---------------------------------------------------------------------------
// Achievements, records and the board
// ---------------------------------------------------------------------------

export function historyFor(world: World, playerId: number): HistoryGame[] {
  const out: HistoryGame[] = [];
  for (const r of world.results.filter((x) => x.playerId === playerId)) {
    const c = world.challenges.find((x) => x.id === r.challengeId)!;
    const side = participantSide(c, playerId)!;
    const mine = side === "posting" ? c.postingPlayers : c.acceptingPlayers!;
    const theirs = side === "posting" ? c.acceptingPlayers! : c.postingPlayers;
    out.push({
      challengeId: c.id,
      date: r.date,
      won: r.won,
      retired: Boolean(c.retiredBy),
      own: r.pointsFor,
      other: r.pointsAgainst,
      partnerId: mine.find((p) => p !== playerId) ?? playerId,
      opponentPairKey: pairKey(theirs[0], theirs[1]),
      giantKiller: r.giantKiller > 0,
      crownBounty: r.crownBounty > 0,
    });
  }
  return out;
}

export function achievementsOf(world: World, playerId: number, polishedAt: string | null): Partial<Record<AchievementKey, string>> {
  const attended = [...(world.attendedDates.get(playerId) ?? [])].sort();
  const clubDays = [...new Set([...world.clubDays, ...attended])].sort();
  const iron = attended.length >= 10 && computeStreaks(attended, clubDays, [], world.today).best >= 10 ? attended[attended.length - 1] : null;
  return achievementsFrom(historyFor(world, playerId), { ironWolf: iron, polished: polishedAt ? polishedAt.slice(0, 10) : null });
}

export function pairRecord(world: World, pairId: number): { won: number; lost: number; streak: number } {
  const games = world.results
    .filter((r) => r.pairId === pairId)
    .filter((r, i, all) => all.findIndex((x) => x.challengeId === r.challengeId) === i);
  let streak = 0;
  for (const g of games) streak = g.won ? streak + 1 : 0;
  return { won: games.filter((g) => g.won).length, lost: games.filter((g) => !g.won).length, streak };
}

/** Head-to-head between two pairs (by the players in them, any time they met as these pairs). */
export function headToHead(world: World, mine: [number, number], theirs: [number, number]): { won: number; lost: number } {
  const k1 = pairKey(mine[0], mine[1]);
  const k2 = pairKey(theirs[0], theirs[1]);
  let won = 0;
  let lost = 0;
  for (const c of world.challenges) {
    if (c.status !== "completed" || !c.acceptingPlayers) continue;
    const ka = pairKey(c.postingPlayers[0], c.postingPlayers[1]);
    const kb = pairKey(c.acceptingPlayers[0], c.acceptingPlayers[1]);
    if (!((ka === k1 && kb === k2) || (ka === k2 && kb === k1))) continue;
    const r = world.results.find((x) => x.challengeId === c.id && x.playerId === mine[0]);
    if (r?.won) won++;
    else lost++;
  }
  return { won, lost };
}

export function avgRank(world: World, players: [number, number]): number {
  return ((world.ranks.get(players[0])?.earned ?? 0) + (world.ranks.get(players[1])?.earned ?? 0)) / 2;
}

export function bonusesOnOffer(world: World, mine: [number, number], theirs: [number, number]): { giantKiller: boolean; newRival: boolean } {
  return {
    giantKiller: avgRank(world, theirs) - avgRank(world, mine) >= GIANT_KILLER_STEPS,
    newRival: !mine.some((m) => theirs.some((t) => world.facedBy.get(m)?.has(t))),
  };
}

export function packLeader(world: World): { playerId: number; games: number } | null {
  const since = addDaysKey(world.today, -(SEAT_WINDOW_DAYS - 1));
  const count = new Map<number, number>();
  for (const r of world.results) if (r.date >= since) count.set(r.playerId, (count.get(r.playerId) ?? 0) + 1);
  const best = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return best ? { playerId: best[0], games: best[1] } : null;
}

export function seasonChampion(world: World): { playerId: number; wp: number; key: string } | null {
  const last = periodRange("quarter", world.today, -1);
  let best: { playerId: number; wp: number } | null = null;
  for (const [id, ev] of world.events) {
    if (!world.players.get(id)?.visible) continue;
    const wp = ev.reduce((s, e) => (e.date >= last.start! && e.date <= last.end! ? s + e.points : s), 0);
    if (wp > 0 && (!best || wp > best.wp)) best = { playerId: id, wp };
  }
  return best ? { ...best, key: last.key } : null;
}

// ---------------------------------------------------------------------------
// Leaderboards (Wolf Points and Challenges tabs)
// ---------------------------------------------------------------------------

export type PointsSource = "all" | "challenges" | "play" | "rr";
const SOURCE_OF: Record<Exclude<PointsSource, "all">, WpSource> = { challenges: "challenge", play: "play", rr: "rr" };

export type PointsBoardRow = {
  rank: number;
  playerId: number;
  name: string;
  initials: string;
  avatarUrl: string | null;
  /** Points from the chosen source(s) in the period. */
  value: number;
  /** The same period split by source (for the row's small print). */
  play: number;
  rr: number;
  challenges: number;
  /** Ladder position (from all-time WP) and Wolf title. */
  index: number;
  seat: Seat | null;
  tarnishing: boolean;
};

/**
 * The leaderboard: one list of Wolf Points from every source (play days,
 * round robin, challenges with bonuses) in the period, or from one source.
 * Only players who show themselves on the leaderboard (plus, for their own
 * eyes, `includePlayerId`).
 */
export async function getPointsBoard(source: PointsSource, range: PeriodRange, includePlayerId?: number): Promise<PointsBoardRow[]> {
  if (!process.env.POSTGRES_URL) return [];
  const world = await loadWorld();
  const inRange = (d: string) => (!range.start || d >= range.start) && (!range.end || d <= range.end);
  const rows: (PointsBoardRow & { tie: string })[] = [];
  for (const p of world.players.values()) {
    if (!p.visible && p.id !== includePlayerId) continue;
    const by = { play: 0, rr: 0, challenge: 0 } as Record<WpSource, number>;
    for (const e of world.events.get(p.id) ?? []) if (inRange(e.date) && e.source) by[e.source] += e.points;
    const value = source === "all" ? by.play + by.rr + by.challenge : by[SOURCE_OF[source]];
    if (value <= 0) continue;
    const r = world.ranks.get(p.id);
    rows.push({
      rank: 0,
      playerId: p.id,
      name: p.name,
      initials: p.initials,
      avatarUrl: p.avatarUrl ?? null,
      value,
      play: by.play,
      rr: by.rr,
      challenges: by.challenge,
      index: r?.shown ?? 0,
      seat: r?.seat ?? null,
      tarnishing: r?.tarnishing ?? false,
      tie: "",
    });
  }
  rows.sort((a, b) => b.value - a.value || b.index - a.index || a.name.localeCompare(b.name));
  return rankRows(rows)
    .slice(0, 200)
    .map(({ tie: _tie, ...r }) => r);
}

/** Rank icon data for every player (leaderboards show it beside names). */
export async function getRankBadges(): Promise<Record<number, { index: number; seat: Seat | null; tarnishing: boolean }>> {
  if (!process.env.POSTGRES_URL) return {};
  const world = await loadWorld();
  const out: Record<number, { index: number; seat: Seat | null; tarnishing: boolean }> = {};
  for (const [id, r] of world.ranks) out[id] = { index: r.shown, seat: r.seat, tarnishing: r.tarnishing };
  return out;
}

/** The player's accepted challenge that hasn't been played yet, if any (one cheap query). */
export async function liveMatchFor(playerId: number): Promise<number | null> {
  await ensureArenaTables();
  const { rows } = await sql.query(
    `SELECT id FROM ${T.challenges} WHERE status = 'accepted' AND $1 IN (p1, p2, a1, a2) ORDER BY accepted_at DESC LIMIT 1;`,
    [playerId],
  );
  return (rows[0]?.id as number | undefined) ?? null;
}

/** Things waiting on the player (badge on the Arena tab): a score to confirm, a team-up request. Two cheap queries. */
export async function countArenaActions(playerId: number): Promise<number> {
  await ensureArenaTables();
  const [scores, requests] = await Promise.all([
    sql.query(
      `SELECT count(*)::int AS n FROM ${T.challenges}
       WHERE status = 'awaiting' AND entered_at > NOW() - ($2 * INTERVAL '1 hour')
         AND ((($1 = p1 OR $1 = p2) AND entered_by NOT IN (p1, p2)) OR (($1 = a1 OR $1 = a2) AND entered_by NOT IN (a1, a2)));`,
      [playerId, AUTO_CONFIRM_HOURS],
    ),
    sql.query(
      `SELECT count(*)::int AS n FROM ${T.codes} WHERE purpose = 'pair' AND owner_id = $1 AND status = 'requested' AND expires_at > NOW();`,
      [playerId],
    ),
  ]);
  return (scores.rows[0]?.n ?? 0) + (requests.rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function adminResolve(id: number, outcome: "posting" | "accepting" | "void" | "as_entered", reason: string): Promise<void> {
  await ensureArenaTables();
  const c = await getChallenge(id);
  if (outcome === "void") {
    await sql.query(`UPDATE ${T.challenges} SET status = 'void', void_reason = $2 WHERE id = $1;`, [id, reason.trim().slice(0, 300) || "Voided by an admin"]);
  } else if (outcome === "as_entered") {
    await sql.query(`UPDATE ${T.challenges} SET status = 'completed', resolved_by_admin = TRUE, completed_at = coalesce(completed_at, NOW()) WHERE id = $1;`, [id]);
  } else {
    // An admin decides the winner without a score: recorded as the other pair retiring.
    const loser = outcome === "posting" ? "accepting" : "posting";
    if (!c.playedOn) await sql.query(`UPDATE ${T.challenges} SET played_on = $2 WHERE id = $1;`, [id, getClubToday().dateKey]);
    await sql.query(
      `UPDATE ${T.challenges} SET status = 'completed', resolved_by_admin = TRUE, retired_by = $2, score_posting = NULL, score_accepting = NULL,
         completed_at = coalesce(completed_at, NOW()) WHERE id = $1;`,
      [id, loser],
    );
  }
  refresh();
}

export async function countDisputes(): Promise<number> {
  try {
    await ensureArenaTables();
    const { rows } = await sql.query(`SELECT count(*)::int AS n FROM ${T.challenges} WHERE status = 'disputed';`);
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Removes everything a deleted account had in the Arena from play (results stay for the other players). */
export async function endPlayerArena(playerId: number): Promise<void> {
  await ensureArenaTables();
  const { rows } = await sql.query(`SELECT pair_id FROM ${T.members} WHERE player_id = $1 AND active;`, [playerId]);
  for (const r of rows) await endPair(sql, r.pair_id, "account_deleted");
  await sql.query(
    `UPDATE ${T.challenges} SET status = 'cancelled' WHERE status IN ('open', 'accepted') AND (p1 = $1 OR p2 = $1 OR a1 = $1 OR a2 = $1);`,
    [playerId],
  );
}

export async function arenaExport(playerId: number): Promise<Record<string, unknown>> {
  await ensureArenaTables();
  const [pairs, challenges] = await Promise.all([
    sql.query(`SELECT p.* FROM ${T.pairs} p WHERE player_low = $1 OR player_high = $1 ORDER BY id;`, [playerId]),
    sql.query(
      `SELECT id, status, posted_at, accepted_at, checked_in_at, played_on, score_posting, score_accepting, retired_by, completed_at
       FROM ${T.challenges} WHERE p1 = $1 OR p2 = $1 OR a1 = $1 OR a2 = $1 ORDER BY id;`,
      [playerId],
    ),
  ]);
  return { pairs: pairs.rows, challenges: challenges.rows };
}
