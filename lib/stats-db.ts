import crypto from "crypto";
import { sql } from "@vercel/postgres";
import { ensureTables } from "./db";
import { ensurePlayerTables } from "./player-db";
import { getClubToday } from "./dates";
import { computeStandings, type Match, type Score, type Team } from "./mini-game";
import { PLAYER_NAMES } from "./mini-game-roster";

// Player stats: play days attended and round robin results, for the Player
// tab and the public leaderboard.
//
// Attendance is keyed by email (like everything else in the club's data),
// so play days recorded before someone creates an account count for them
// the moment they do. Sources, in order of trust:
//   admin    – ticked on /admin/play-days
//   board    – finished at least one game on the court board that day
//   minigame – played in that day's round robin
//   booking_history – a confirmed casual booking on an older day that has
//                     no saved court board (backfill only)
//   api      – sent in by a connected app; unverified until an admin confirms
//
// Round robin results are keyed by the mini game name; players.minigame_name
// links a name to an account, so linking a name later applies to every past
// result at once.

let ensurePromise: Promise<void> | null = null;

export function ensureStatsTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await ensureTables();
      await ensurePlayerTables();
      await sql`
        CREATE TABLE IF NOT EXISTS attendance (
          session_date DATE NOT NULL,
          email TEXT NOT NULL,
          source TEXT NOT NULL,
          verified BOOLEAN NOT NULL DEFAULT TRUE,
          removed BOOLEAN NOT NULL DEFAULT FALSE,
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (session_date, email)
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS attendance_email_idx ON attendance (email, session_date);`;
      await sql`
        CREATE TABLE IF NOT EXISTS rr_results (
          draw_id INT NOT NULL,
          mg_name TEXT NOT NULL,
          session_date DATE NOT NULL,
          team_id INT NOT NULL,
          wins INT NOT NULL,
          losses INT NOT NULL,
          points_for INT NOT NULL,
          points_against INT NOT NULL,
          rr_points INT NOT NULL,
          finish_place INT NOT NULL,
          teams_count INT NOT NULL,
          PRIMARY KEY (draw_id, mg_name)
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS rr_results_name_idx ON rr_results (lower(mg_name), session_date);`;
      // "Can't make it" from the Membership tab: frees the spot and keeps the
      // member's streak intact for that week.
      await sql`
        CREATE TABLE IF NOT EXISTS player_absences (
          session_date DATE NOT NULL,
          email TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (session_date, email)
        );
      `;
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

export type AttendanceSource = "admin" | "board" | "minigame" | "booking_history" | "api";

/**
 * Records attendance. Verified records win over unverified ones, and an
 * admin's removal sticks unless an admin adds the person back.
 */
export async function recordAttendance(
  date: string,
  emails: string[],
  source: AttendanceSource,
  verified = true,
): Promise<number> {
  const clean = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (clean.length === 0) return 0;
  await ensureStatsTables();
  const { rowCount } = await sql.query(
    `INSERT INTO attendance (session_date, email, source, verified, removed)
     SELECT $1::date, e, $2, $3, FALSE FROM unnest($4::text[]) AS e
     ON CONFLICT (session_date, email) DO UPDATE SET
       verified = attendance.verified OR EXCLUDED.verified,
       source = CASE WHEN attendance.verified AND NOT attendance.removed THEN attendance.source ELSE EXCLUDED.source END,
       removed = CASE WHEN EXCLUDED.source = 'admin' THEN FALSE ELSE attendance.removed END
     WHERE NOT attendance.removed OR EXCLUDED.source = 'admin';`,
    [date, source, verified, clean],
  );
  return rowCount ?? 0;
}

export async function removeAttendance(date: string, email: string): Promise<void> {
  await ensureStatsTables();
  await sql`
    INSERT INTO attendance (session_date, email, source, verified, removed)
    VALUES (${date}, ${email.trim().toLowerCase()}, 'admin', TRUE, TRUE)
    ON CONFLICT (session_date, email) DO UPDATE SET removed = TRUE, source = 'admin';
  `;
}

export async function confirmAttendance(date: string, email: string): Promise<void> {
  await ensureStatsTables();
  await sql`
    UPDATE attendance SET verified = TRUE WHERE session_date = ${date} AND email = ${email.trim().toLowerCase()};
  `;
}

export async function listAttendanceForDate(date: string): Promise<{ email: string; source: string; verified: boolean; removed: boolean }[]> {
  await ensureStatsTables();
  const { rows } = await sql`
    SELECT email, source, verified, removed FROM attendance WHERE session_date = ${date} ORDER BY email;
  `;
  return rows.map((r) => ({ email: r.email as string, source: r.source as string, verified: r.verified as boolean, removed: r.removed as boolean }));
}

export async function listUnverifiedAttendance(): Promise<{ date: string; email: string; recordedAt: string }[]> {
  await ensureStatsTables();
  const { rows } = await sql`
    SELECT session_date::text AS d, email, recorded_at FROM attendance
    WHERE verified = FALSE AND removed = FALSE ORDER BY session_date DESC LIMIT 100;
  `;
  return rows.map((r) => ({ date: r.d as string, email: r.email as string, recordedAt: new Date(r.recorded_at as Date).toISOString() }));
}

// ---------------------------------------------------------------------------
// Court board
// ---------------------------------------------------------------------------

/** Same id the court board gives each player (lib/casual-play-db.ts). */
export function boardPlayerId(email: string): string {
  return `p_${crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 12)}`;
}

/** Everyone who finished at least one game on a concluded board. */
export async function recordBoardAttendance(
  date: string,
  players: { id: string; games: number; guest: boolean }[],
  roster: { id: string; email: string }[],
): Promise<number> {
  const byId = new Map(roster.map((r) => [r.id, r.email]));
  const emails = players.filter((p) => !p.guest && p.games >= 1).map((p) => byId.get(p.id)).filter((e): e is string => Boolean(e));
  return recordAttendance(date, emails, "board");
}

// ---------------------------------------------------------------------------
// Round robin (mini game)
// ---------------------------------------------------------------------------

type DrawData = { id: number; teams: Team[]; matches: Match[]; createdAt: Date };

async function drawDate(drawId: number, createdAt: Date): Promise<string> {
  const { rows } = await sql`SELECT min(locked_at) AS t FROM mini_game_scores WHERE draw_id = ${drawId};`;
  const t = (rows[0]?.t as Date | null) ?? createdAt;
  return getClubToday(new Date(t)).dateKey;
}

/** Writes (or rewrites) every player's result for one draw. */
export async function storeDrawResults(drawId: number): Promise<number> {
  await ensureStatsTables();
  const { rows: drawRows } = await sql`
    SELECT id, teams, matches, created_at FROM mini_game_draws WHERE id = ${drawId};
  `;
  if (!drawRows[0]) return 0;
  const draw: DrawData = {
    id: drawRows[0].id as number,
    teams: drawRows[0].teams as Team[],
    matches: drawRows[0].matches as Match[],
    createdAt: drawRows[0].created_at as Date,
  };
  const { rows: scoreRows } = await sql`
    SELECT match_id, score_a, score_b FROM mini_game_scores WHERE draw_id = ${drawId};
  `;
  if (scoreRows.length === 0) return 0;
  const scores: Record<string, Score> = {};
  for (const r of scoreRows) scores[r.match_id as string] = { a: r.score_a as number, b: r.score_b as number };

  const standings = computeStandings(draw.teams, draw.matches, scores);
  const date = await drawDate(draw.id, draw.createdAt);
  await sql`DELETE FROM rr_results WHERE draw_id = ${draw.id};`;
  let written = 0;
  for (const [index, s] of standings.entries()) {
    for (const name of s.team.players) {
      await sql`
        INSERT INTO rr_results (draw_id, mg_name, session_date, team_id, wins, losses, points_for, points_against, rr_points, finish_place, teams_count)
        VALUES (${draw.id}, ${name}, ${date}, ${s.team.id}, ${s.won}, ${s.lost}, ${s.pointsFor}, ${s.pointsAgainst}, ${s.points}, ${index + 1}, ${standings.length})
        ON CONFLICT (draw_id, mg_name) DO NOTHING;
      `;
      written++;
    }
  }
  // Everyone in the draw who has a linked account played that day.
  const names = draw.teams.flatMap((t) => t.players.map((n) => n.toLowerCase()));
  const { rows: linked } = await sql.query(
    `SELECT email FROM players WHERE lower(minigame_name) = ANY($1::text[]) AND deleted_at IS NULL;`,
    [names],
  );
  await recordAttendance(date, linked.map((r) => r.email as string), "minigame");
  return written;
}

export type NameMatch = { name: string; playerId: number | null };

export async function listMinigameNameMatches(): Promise<NameMatch[]> {
  if (!process.env.POSTGRES_URL) return [];
  await ensureStatsTables();
  const names = new Set<string>(PLAYER_NAMES);
  try {
    const { rows } = await sql`SELECT teams FROM mini_game_draws;`;
    for (const r of rows) for (const t of r.teams as Team[]) t.players.forEach((n) => names.add(n));
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err;
  }
  const { rows: linked } = await sql`SELECT id, minigame_name FROM players WHERE minigame_name IS NOT NULL AND deleted_at IS NULL;`;
  const byName = new Map(linked.map((r) => [(r.minigame_name as string).toLowerCase(), r.id as number]));
  return [...names]
    .sort((a, b) => a.localeCompare(b, "vi"))
    .map((name) => ({ name, playerId: byName.get(name.toLowerCase()) ?? null }));
}

export async function setMinigameName(name: string, playerId: number | null): Promise<void> {
  await ensureStatsTables();
  const clean = name.trim();
  if (!clean) throw new Error("Name is empty");
  await sql`UPDATE players SET minigame_name = NULL WHERE lower(minigame_name) = lower(${clean});`;
  if (playerId) await sql`UPDATE players SET minigame_name = ${clean} WHERE id = ${playerId};`;
}

// ---------------------------------------------------------------------------
// Backfill for imported members (§4a)
// ---------------------------------------------------------------------------

export async function getStatsBackfillPreview(): Promise<{ boardDays: number; draws: number; bookingDays: number }> {
  if (!process.env.POSTGRES_URL) return { boardDays: 0, draws: 0, bookingDays: 0 };
  await ensureStatsTables();
  const today = getClubToday().dateKey;
  const count = async (q: string, params: unknown[] = []) => {
    try {
      const { rows } = await sql.query(q, params);
      return (rows[0]?.n as number) ?? 0;
    } catch (err) {
      if ((err as { code?: string }).code === "42P01") return 0;
      throw err;
    }
  };
  const [boardDays, draws, bookingDays] = await Promise.all([
    count(`SELECT count(*)::int AS n FROM casual_play_sessions WHERE date <= $1::date;`, [today]),
    count(`SELECT count(DISTINCT draw_id)::int AS n FROM mini_game_scores;`),
    count(
      `SELECT count(DISTINCT b.session_date)::int AS n FROM bookings b
       WHERE b.status = 'confirmed' AND b.session_date < $1::date
         AND NOT EXISTS (SELECT 1 FROM casual_play_sessions c WHERE c.date = b.session_date);`,
      [today],
    ).catch(() => 0),
  ]);
  return { boardDays, draws, bookingDays };
}

async function knownEmailsByBoardId(): Promise<Map<string, string>> {
  const emails = new Set<string>();
  const sources = [
    `SELECT lower(trim(email)) AS e FROM players WHERE deleted_at IS NULL`,
    `SELECT lower(trim(email)) AS e FROM memberships`,
    `SELECT lower(trim(email)) AS e FROM bookings`,
    `SELECT lower(trim(email)) AS e FROM session_fill_ins`,
  ];
  for (const q of sources) {
    try {
      const { rows } = await sql.query(q);
      rows.forEach((r) => r.e && emails.add(r.e as string));
    } catch (err) {
      if ((err as { code?: string }).code !== "42P01") throw err;
    }
  }
  return new Map([...emails].map((e) => [boardPlayerId(e), e]));
}

export async function runStatsBackfill(): Promise<{ attendance: number; roundRobin: number }> {
  await ensureStatsTables();
  const today = getClubToday().dateKey;
  let attendance = 0;
  let roundRobin = 0;

  // 1. Saved court boards.
  let boardDates = new Set<string>();
  try {
    const idToEmail = await knownEmailsByBoardId();
    const { rows } = await sql`SELECT date::text AS d, state FROM casual_play_sessions WHERE date <= ${today};`;
    boardDates = new Set(rows.map((r) => r.d as string));
    for (const r of rows) {
      const state = r.state as { players?: { id: string; games: number; guest: boolean }[] };
      const emails = (state.players ?? [])
        .filter((p) => !p.guest && p.games >= 1)
        .map((p) => idToEmail.get(p.id))
        .filter((e): e is string => Boolean(e));
      attendance += await recordAttendance(r.d as string, emails, "board");
    }
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err;
  }

  // 2. Mini game draws with scores.
  try {
    const { rows } = await sql`SELECT DISTINCT draw_id FROM mini_game_scores;`;
    for (const r of rows) roundRobin += await storeDrawResults(r.draw_id as number);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err;
  }

  // 3. Older play days with no saved board: confirmed casual bookings (the
  //    player paid for that day). A fill-in played instead of the booker.
  const { rows: bookings } = await sql`
    SELECT b.session_date::text AS d, lower(trim(coalesce(f.email, b.email))) AS email
    FROM bookings b
    LEFT JOIN session_fill_ins f ON f.booking_id = b.id AND f.session_date = b.session_date
    WHERE b.status = 'confirmed' AND b.session_date < ${today};
  `;
  const byDate = new Map<string, string[]>();
  for (const b of bookings) {
    if (boardDates.has(b.d as string)) continue;
    byDate.set(b.d as string, [...(byDate.get(b.d as string) ?? []), b.email as string]);
  }
  for (const [d, emails] of byDate) attendance += await recordAttendance(d, emails, "booking_history");

  return { attendance, roundRobin };
}

// ---------------------------------------------------------------------------
// Periods (NZ calendar)
// ---------------------------------------------------------------------------

export type Period = "month" | "quarter" | "year" | "lifetime";
export const PERIODS: Period[] = ["month", "quarter", "year", "lifetime"];

export type PeriodRange = { period: Period; key: string; start: string | null; end: string | null };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function lastDay(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The period containing `anchor` (YYYY-MM-DD), stepped `offset` periods back
 * (negative) or forward. Keys: 2026-11, 2026-Q4, 2026, all.
 */
export function periodRange(period: Period, anchor: string, offset = 0): PeriodRange {
  const [y0, m0] = anchor.split("-").map(Number);
  if (period === "lifetime") return { period, key: "all", start: null, end: null };
  if (period === "year") {
    const y = y0 + offset;
    return { period, key: String(y), start: `${y}-01-01`, end: `${y}-12-31` };
  }
  if (period === "quarter") {
    const q0 = Math.floor((m0 - 1) / 3) + offset;
    const y = y0 + Math.floor(q0 / 4);
    const q = ((q0 % 4) + 4) % 4;
    const sm = q * 3 + 1;
    const em = sm + 2;
    return { period, key: `${y}-Q${q + 1}`, start: `${y}-${pad(sm)}-01`, end: `${y}-${pad(em)}-${pad(lastDay(y, em))}` };
  }
  const total = y0 * 12 + (m0 - 1) + offset;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { period, key: `${y}-${pad(m)}`, start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
}

/** Parses a period key back to its range (null if malformed). */
export function periodFromKey(period: Period, key: string | undefined): PeriodRange | null {
  if (!key) return null;
  if (period === "lifetime") return periodRange("lifetime", "2000-01-01");
  if (period === "year" && /^\d{4}$/.test(key)) return periodRange("year", `${key}-01-01`);
  if (period === "quarter") {
    const m = /^(\d{4})-Q([1-4])$/.exec(key);
    if (m) return periodRange("quarter", `${m[1]}-${pad((Number(m[2]) - 1) * 3 + 1)}-01`);
  }
  if (period === "month" && /^\d{4}-\d{2}$/.test(key)) return periodRange("month", `${key}-01`);
  return null;
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export type Metric = "attendance" | "rr";

export type LeaderboardRow = {
  rank: number;
  playerId: number;
  name: string;
  initials: string;
  value: number;
  wins?: number;
  diff?: number;
  days?: number;
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const DISPLAY_NAME_SQL = `coalesce(nullif(trim(p.display_name), ''),
  p.first_name || CASE WHEN p.last_name <> '' THEN ' ' || upper(left(p.last_name, 1)) || '.' ELSE '' END)`;

/** Standard competition ranking (1, 2, 2, 4) over already-sorted rows. */
function rankRows<T extends { value: number; tie: string }>(rows: T[]): (T & { rank: number })[] {
  let lastKey = "";
  let lastRank = 0;
  return rows.map((r, i) => {
    const key = `${r.value}|${r.tie}`;
    const rank = key === lastKey ? lastRank : i + 1;
    lastKey = key;
    lastRank = rank;
    return { ...r, rank };
  });
}

/**
 * One leaderboard. Only players with an account who haven't opted out are
 * listed. `includePlayerId` keeps a hidden player's own row so they can see
 * where they'd rank (it's never shown to anyone else).
 */
export async function getLeaderboard(metric: Metric, range: PeriodRange, includePlayerId?: number): Promise<LeaderboardRow[]> {
  if (!process.env.POSTGRES_URL) return [];
  await ensureStatsTables();
  const start = range.start;
  const end = range.end;
  if (metric === "attendance") {
    const { rows } = await sql.query(
      `SELECT p.id, ${DISPLAY_NAME_SQL} AS name, count(*)::int AS value, max(a.session_date)::text AS reached
       FROM attendance a JOIN players p ON p.email = a.email
       WHERE a.verified AND NOT a.removed AND p.deleted_at IS NULL
         AND (p.leaderboard_visible OR p.id = $3)
         AND ($1::date IS NULL OR a.session_date >= $1::date)
         AND ($2::date IS NULL OR a.session_date <= $2::date)
       GROUP BY p.id
       ORDER BY value DESC, reached ASC, name ASC
       LIMIT 200;`,
      [start, end, includePlayerId ?? -1],
    );
    return rankRows(rows.map((r) => ({ ...r, value: r.value as number, tie: "" }))).map((r) => ({
      rank: r.rank,
      playerId: r.id as number,
      name: r.name as string,
      initials: initialsOf(r.name as string),
      value: r.value,
    }));
  }
  const { rows } = await sql.query(
    `SELECT p.id, ${DISPLAY_NAME_SQL} AS name, sum(r.rr_points)::int AS value, sum(r.wins)::int AS wins,
       sum(r.points_for - r.points_against)::int AS diff, count(*)::int AS days
     FROM rr_results r JOIN players p ON lower(p.minigame_name) = lower(r.mg_name)
     WHERE p.deleted_at IS NULL AND (p.leaderboard_visible OR p.id = $3)
       AND ($1::date IS NULL OR r.session_date >= $1::date)
       AND ($2::date IS NULL OR r.session_date <= $2::date)
     GROUP BY p.id
     ORDER BY value DESC, diff DESC, wins DESC, name ASC
     LIMIT 200;`,
    [start, end, includePlayerId ?? -1],
  );
  return rankRows(rows.map((r) => ({ ...r, value: r.value as number, tie: `${r.diff}` }))).map((r) => ({
    rank: r.rank,
    playerId: r.id as number,
    name: r.name as string,
    initials: initialsOf(r.name as string),
    value: r.value,
    wins: r.wins as number,
    diff: r.diff as number,
    days: r.days as number,
  }));
}

// ---------------------------------------------------------------------------
// One player's stats (Player tab)
// ---------------------------------------------------------------------------

export type PlayerStats = {
  attended: Record<Period, number>;
  ranks: Record<Period, { attendance: number | null; rr: number | null }>;
  streak: { current: number; best: number };
  rr: { days: number; points: number; wins: number; losses: number; bestPlacing: number | null };
  /** Attended play days (YYYY-MM-DD), newest first, for the heatmap and history. */
  attendedDates: string[];
  /** Play days the club ran in the last 26 weeks (for the heatmap). */
  clubDates: string[];
  rrHistory: { date: string; points: number; wins: number; losses: number; placing: number; teams: number; diff: number }[];
};

/** Monday-based week key, so a streak counts weeks played. */
function weekKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Current and best streak in weeks. Only weeks when the club actually ran a
 * play day count; a week the player said they couldn't make keeps the
 * streak going; the current week doesn't break it before it's over.
 */
export function computeStreaks(attended: string[], clubDays: string[], excused: string[], today: string): { current: number; best: number } {
  const played = new Set(attended.map(weekKey));
  const excusedWeeks = new Set(excused.map(weekKey));
  const weeks = [...new Set(clubDays.filter((d) => d <= today).map(weekKey))].sort();
  const thisWeek = weekKey(today);
  let best = 0;
  let run = 0;
  for (const w of weeks) {
    if (played.has(w)) {
      run++;
      best = Math.max(best, run);
    } else if (excusedWeeks.has(w) || w === thisWeek) {
      // keeps the streak, doesn't add to it
    } else {
      run = 0;
    }
  }
  return { current: run, best };
}

export async function getPlayerStats(player: { id: number; email: string; minigameName: string | null }): Promise<PlayerStats> {
  const today = getClubToday().dateKey;
  const empty: PlayerStats = {
    attended: { month: 0, quarter: 0, year: 0, lifetime: 0 },
    ranks: {
      month: { attendance: null, rr: null },
      quarter: { attendance: null, rr: null },
      year: { attendance: null, rr: null },
      lifetime: { attendance: null, rr: null },
    },
    streak: { current: 0, best: 0 },
    rr: { days: 0, points: 0, wins: 0, losses: 0, bestPlacing: null },
    attendedDates: [],
    clubDates: [],
    rrHistory: [],
  };
  if (!process.env.POSTGRES_URL) return empty;
  await ensureStatsTables();

  const [{ rows: att }, { rows: club }, { rows: abs }, rr] = await Promise.all([
    sql`SELECT session_date::text AS d FROM attendance WHERE email = ${player.email} AND verified AND NOT removed ORDER BY session_date DESC;`,
    sql`SELECT date::text AS d FROM sessions WHERE date <= ${today} ORDER BY date;`,
    sql`SELECT session_date::text AS d FROM player_absences WHERE email = ${player.email};`,
    player.minigameName
      ? sql`
          SELECT session_date::text AS d, rr_points, wins, losses, finish_place, teams_count, points_for - points_against AS diff
          FROM rr_results WHERE lower(mg_name) = lower(${player.minigameName}) ORDER BY session_date;
        `
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
  ]);

  const attendedDates = att.map((r) => r.d as string);
  const clubDays = [...new Set([...club.map((r) => r.d as string), ...attendedDates])].sort();
  const stats: PlayerStats = { ...empty, attendedDates };

  for (const p of PERIODS) {
    const range = periodRange(p, today);
    stats.attended[p] = attendedDates.filter((d) => (!range.start || d >= range.start) && (!range.end || d <= range.end)).length;
  }
  stats.streak = computeStreaks(attendedDates, clubDays, abs.map((r) => r.d as string), today);

  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 26 * 7);
  const sinceKey = since.toISOString().slice(0, 10);
  stats.clubDates = clubDays.filter((d) => d >= sinceKey);

  stats.rrHistory = rr.rows.map((r) => ({
    date: r.d as string,
    points: r.rr_points as number,
    wins: r.wins as number,
    losses: r.losses as number,
    placing: r.finish_place as number,
    teams: r.teams_count as number,
    diff: r.diff as number,
  }));
  stats.rr = {
    days: stats.rrHistory.length,
    points: stats.rrHistory.reduce((s, r) => s + r.points, 0),
    wins: stats.rrHistory.reduce((s, r) => s + r.wins, 0),
    losses: stats.rrHistory.reduce((s, r) => s + r.losses, 0),
    bestPlacing: stats.rrHistory.length ? Math.min(...stats.rrHistory.map((r) => r.placing)) : null,
  };

  for (const p of PERIODS) {
    const range = periodRange(p, today);
    const [a, r] = await Promise.all([getLeaderboard("attendance", range, player.id), getLeaderboard("rr", range, player.id)]);
    stats.ranks[p] = {
      attendance: a.find((x) => x.playerId === player.id)?.rank ?? null,
      rr: r.find((x) => x.playerId === player.id)?.rank ?? null,
    };
  }
  return stats;
}

// ---------------------------------------------------------------------------
// "Can't make it"
// ---------------------------------------------------------------------------

export async function setAbsence(date: string, email: string, absent: boolean): Promise<void> {
  await ensureStatsTables();
  const e = email.trim().toLowerCase();
  if (absent) {
    await sql`INSERT INTO player_absences (session_date, email) VALUES (${date}, ${e}) ON CONFLICT DO NOTHING;`;
  } else {
    await sql`DELETE FROM player_absences WHERE session_date = ${date} AND email = ${e};`;
  }
}

export async function listAbsences(email: string, fromDate: string): Promise<string[]> {
  await ensureStatsTables();
  const { rows } = await sql`
    SELECT session_date::text AS d FROM player_absences WHERE email = ${email.trim().toLowerCase()} AND session_date >= ${fromDate};
  `;
  return rows.map((r) => r.d as string);
}
