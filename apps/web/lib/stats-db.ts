import { clubClock } from "./club";
import crypto from "crypto";
import { sql } from "./database";
import { MEMBERSHIP_DAY_TO_DOW } from "./constants";
import { getPlayerSetting, setPlayerSetting } from "./player-db";
import { getClubToday } from "./dates";
import { computeStandings, type Match, type Score, type Team } from "./mini-game";
import { PLAYER_NAMES } from "./mini-game-roster";
import { emitToPlayers } from "./webhooks";
import {
  DISPLAY_NAME_SQL,
  PERIODS,
  computeStreaks,
  initialsOf,
  periodRange,
  rankRows,
  type Period,
  type PeriodRange,
} from "./stats-periods";

export { PERIODS, computeStreaks, periodFromKey, periodRange, weekKey } from "./stats-periods";
export type { Period, PeriodRange } from "./stats-periods";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

/** Refreshes the cached public leaderboard (no-op outside a request). */
function refreshLeaderboard(): void {
  try {
    revalidateTag("leaderboard", { expire: 0 });
  } catch {
    // called outside a request (scripts/tests): nothing cached to refresh
  }
}

// Player stats: play days attended and round robin results, for the Player
// tab and the public leaderboard.
//
// Attendance is keyed by email (like everything else in the club's data),
// so play days recorded before someone creates an account count for them
// the moment they do. Sources, in order of trust:
//   admin    – ticked on /admin/play-days
//   board    – finished at least one game on the court board that day
//   minigame – played in that day's round robin
//   roster   – on a past play day's sign-up list:
//              roster (confirmed booking, or a membership covering the day),
//              not marked "Can't make it"; a fill-in counts instead of the
//              person they replaced (recordRosterAttendance, automatic)
//   booking_history – older backfill rows (now covered by roster)
//   api      – sent in by a connected app; unverified until an admin confirms
//
// Round robin results are keyed by the mini game name; players.minigame_name
// links a name to an account, so linking a name later applies to every past
// result at once.

export type AttendanceSource = "admin" | "board" | "minigame" | "roster" | "booking_history" | "api";

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
  const { rowCount } = await sql.query(
    `INSERT INTO attendance (session_date, email, source, verified, removed)
     SELECT $1::date, e, $2, $3, FALSE FROM unnest($4::text[]) AS e
     ON CONFLICT (tenant_id, session_date, email) DO UPDATE SET
       verified = attendance.verified OR EXCLUDED.verified,
       source = CASE WHEN attendance.verified AND NOT attendance.removed THEN attendance.source ELSE EXCLUDED.source END,
       removed = CASE WHEN EXCLUDED.source = 'admin' THEN FALSE ELSE attendance.removed END
     WHERE NOT attendance.removed OR EXCLUDED.source = 'admin';`,
    [date, source, verified, clean],
  );
  if (verified && rowCount) {
    refreshLeaderboard();
    await emitToPlayers(clean, "attendance.recorded", () => ({ date, source }));
  }
  return rowCount ?? 0;
}

export async function removeAttendance(date: string, email: string): Promise<void> {
  await sql`
    INSERT INTO attendance (session_date, email, source, verified, removed)
    VALUES (${date}, ${email.trim().toLowerCase()}, 'admin', TRUE, TRUE)
    ON CONFLICT (tenant_id, session_date, email) DO UPDATE SET removed = TRUE, source = 'admin';
  `;
  refreshLeaderboard();
}

export async function confirmAttendance(date: string, email: string): Promise<void> {
  await sql`
    UPDATE attendance SET verified = TRUE WHERE session_date = ${date} AND email = ${email.trim().toLowerCase()};
  `;
}

export async function listAttendanceForDate(date: string): Promise<{ email: string; source: string; verified: boolean; removed: boolean }[]> {
  const { rows } = await sql`
    SELECT email, source, verified, removed FROM attendance WHERE session_date = ${date} ORDER BY email;
  `;
  return rows.map((r) => ({ email: r.email as string, source: r.source as string, verified: r.verified as boolean, removed: r.removed as boolean }));
}

export async function listUnverifiedAttendance(): Promise<{ date: string; email: string; recordedAt: string }[]> {
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
  refreshLeaderboard();
  await recordAttendance(date, linked.map((r) => r.email as string), "minigame");
  const { rows: linkedNames } = await sql.query(
    `SELECT email, minigame_name FROM players WHERE lower(minigame_name) = ANY($1::text[]) AND deleted_at IS NULL;`,
    [names],
  );
  const nameByEmail = new Map(linkedNames.map((r) => [r.email as string, (r.minigame_name as string).toLowerCase()]));
  await emitToPlayers([...nameByEmail.keys()], "round_robin.result", (email) => {
    const name = nameByEmail.get(email);
    const index = standings.findIndex((s) => s.team.players.some((p) => p.toLowerCase() === name));
    const s = standings[index];
    return s
      ? { date, placing: index + 1, teams: standings.length, wins: s.won, losses: s.lost, rrPoints: s.points, pointsFor: s.pointsFor, pointsAgainst: s.pointsAgainst }
      : { date };
  });
  return written;
}

export type NameMatch = { name: string; playerId: number | null };

export async function listMinigameNameMatches(): Promise<NameMatch[]> {
  if (!process.env.POSTGRES_URL) return [];
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
  const clean = name.trim();
  if (!clean) throw new Error("Name is empty");
  await sql`UPDATE players SET minigame_name = NULL WHERE lower(minigame_name) = lower(${clean});`;
  if (playerId) await sql`UPDATE players SET minigame_name = ${clean} WHERE id = ${playerId};`;
}

// ---------------------------------------------------------------------------
// Play days from the roster (all time, automatic)
// ---------------------------------------------------------------------------

// Membership statuses that once gave access. 'pending' never paid, so it
// never put anyone on a roster.
const ROSTER_MEMBERSHIP_STATUSES = ["active", "trialing", "past_due", "expired", "canceled"];

/**
 * Play days come from the sign-up list: everyone on a past play day's
 * roster counts (confirmed casual bookings, plus members whose membership
 * covered the date on its weekday), minus "Can't make it", with a fill-in
 * counted instead of the person they replaced. The same rules as the admin
 * roster (lib/db.ts getRosterForDate), applied to all history at once, so
 * nobody has to be checked in by hand. A day counts from the day after.
 *
 * Rebuilds the roster rows each time: someone who later said "Can't make
 * it" (or whose booking was cancelled) drops off. Court board, round robin
 * and admin records are never touched, and an admin's removal sticks.
 */
export async function recordRosterAttendance(): Promise<number> {
  if (!process.env.POSTGRES_URL) return 0;
  const today = getClubToday(new Date(), await clubClock()).dateKey;
  // Weekday of each membership pool, e.g. friday → 5 (Postgres DOW: Sunday = 0).
  const dowCase = Object.entries(MEMBERSHIP_DAY_TO_DOW)
    .map(([day, dow]) => `WHEN ${Number(dow)} THEN '${day.replace(/[^a-z]/g, "")}'`)
    .join(" ");
  const roster = `WITH days AS (
       SELECT s.date AS d, CASE EXTRACT(DOW FROM s.date)::int ${dowCase} END AS pool
       FROM sessions s
       WHERE s.date < $1::date
     ),
     casual AS (
       SELECT b.session_date AS d, lower(trim(coalesce(f.email, b.email))) AS e
       FROM bookings b
       JOIN days ON days.d = b.session_date
       LEFT JOIN session_fill_ins f ON f.booking_id = b.id AND f.session_date = b.session_date
       WHERE b.status = 'confirmed'
     ),
     members AS (
       SELECT days.d, lower(trim(coalesce(f.email, m.email))) AS e
       FROM days
       JOIN memberships m
         ON days.pool IS NOT NULL
        AND m.day = days.pool
        AND m.status = ANY($2::text[])
        AND m.period_start <= days.d
        AND (m.period_end >= days.d OR (m.status = 'active' AND m.recurring AND m.cancel_at_period_end = FALSE))
       LEFT JOIN session_fill_ins f ON f.membership_id = m.id AND f.session_date = days.d
       WHERE NOT EXISTS (
         SELECT 1 FROM player_absences pa WHERE pa.session_date = days.d AND pa.email = lower(trim(m.email))
       )
     ),
     signed_up AS (
       SELECT DISTINCT d, e FROM (SELECT * FROM casual UNION SELECT * FROM members) r
       WHERE e IS NOT NULL AND e <> ''
     )`;
  const params = [today, ROSTER_MEMBERSHIP_STATUSES];
  // Off the list now: drop the roster row (other sources keep theirs).
  const { rowCount: dropped } = await sql.query(
    `${roster}
     DELETE FROM attendance a
     WHERE a.source IN ('roster', 'booking_history') AND NOT a.removed AND a.session_date < $1::date
       AND NOT EXISTS (SELECT 1 FROM signed_up u WHERE u.d = a.session_date AND u.e = a.email);`,
    params,
  );
  const { rowCount: added } = await sql.query(
    `${roster}
     INSERT INTO attendance (session_date, email, source, verified, removed)
     SELECT d, e, 'roster', TRUE, FALSE FROM signed_up
     ON CONFLICT (tenant_id, session_date, email) DO UPDATE SET verified = TRUE
     WHERE NOT attendance.removed AND NOT attendance.verified;`,
    params,
  );
  if (dropped || added) refreshLeaderboard();
  return added ?? 0;
}

let rosterSyncedAt = 0;
const HISTORY_BACKFILL_KEY = "stats_history_backfilled_at";

/** Starts the roster sync after the response is sent, so the page doesn't wait for it. */
function syncRosterAttendanceLater(): void {
  try {
    after(() => syncRosterAttendance());
  } catch {
    void syncRosterAttendance();
  }
}

/**
 * Keeps play-day history current without anyone pressing a button. The
 * first time, it runs the full backfill (saved court boards, round robin
 * draws, rosters) and remembers that in player_settings; after that only
 * the cheap roster sync runs, since new boards and draws are recorded as
 * they're saved. At most hourly per server instance (forced by the Arena's
 * points sync, lib/arena-db.ts syncPoints).
 */
export async function syncRosterAttendance(force = false): Promise<void> {
  if (!force && Date.now() - rosterSyncedAt < 60 * 60 * 1000) return;
  rosterSyncedAt = Date.now();
  try {
    if (!(await getPlayerSetting(HISTORY_BACKFILL_KEY))) {
      await runStatsBackfill();
      await setPlayerSetting(HISTORY_BACKFILL_KEY, new Date().toISOString());
    } else {
      await recordRosterAttendance();
    }
  } catch (err) {
    rosterSyncedAt = 0;
    console.error("[stats] play-day history sync failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Backfill for imported members (§4a)
// ---------------------------------------------------------------------------

export async function getStatsBackfillPreview(): Promise<{ boardDays: number; draws: number; bookingDays: number }> {
  if (!process.env.POSTGRES_URL) return { boardDays: 0, draws: 0, bookingDays: 0 };
  const today = getClubToday(new Date(), await clubClock()).dateKey;
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
      `SELECT count(*)::int AS n FROM sessions s
       WHERE s.date < $1::date AND NOT EXISTS (SELECT 1 FROM casual_play_sessions c WHERE c.date = s.date);`,
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
  const today = getClubToday(new Date(), await clubClock()).dateKey;
  let attendance = 0;
  let roundRobin = 0;

  // 1. Saved court boards.
  try {
    const idToEmail = await knownEmailsByBoardId();
    const { rows } = await sql`SELECT date::text AS d, state FROM casual_play_sessions WHERE date <= ${today};`;
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

  // 3. Every other past play day (no saved board): the day's roster.
  attendance += await recordRosterAttendance();

  return { attendance, roundRobin };
}

// ---------------------------------------------------------------------------
// Periods (NZ calendar)
// ---------------------------------------------------------------------------

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

/**
 * One leaderboard. Only players with an account who haven't opted out are
 * listed. `includePlayerId` keeps a hidden player's own row so they can see
 * where they'd rank (it's never shown to anyone else).
 */
export async function getLeaderboard(metric: Metric, range: PeriodRange, includePlayerId?: number): Promise<LeaderboardRow[]> {
  if (!process.env.POSTGRES_URL) return [];
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

export async function getPlayerStats(player: { id: number; email: string; minigameName: string | null }): Promise<PlayerStats> {
  const today = getClubToday(new Date(), await clubClock()).dateKey;
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
  syncRosterAttendanceLater();

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

  // All eight boards at once (they used to run four rounds one after another).
  const boards = await Promise.all(
    PERIODS.map((p) => {
      const range = periodRange(p, today);
      return Promise.all([getLeaderboard("attendance", range, player.id), getLeaderboard("rr", range, player.id)]);
    }),
  );
  PERIODS.forEach((p, i) => {
    const [a, r] = boards[i];
    stats.ranks[p] = {
      attendance: a.find((x) => x.playerId === player.id)?.rank ?? null,
      rr: r.find((x) => x.playerId === player.id)?.rank ?? null,
    };
  });
  return stats;
}

// ---------------------------------------------------------------------------
// "Can't make it"
// ---------------------------------------------------------------------------

export async function setAbsence(date: string, email: string, absent: boolean): Promise<void> {
  const e = email.trim().toLowerCase();
  if (absent) {
    await sql`INSERT INTO player_absences (session_date, email) VALUES (${date}, ${e}) ON CONFLICT DO NOTHING;`;
  } else {
    await sql`DELETE FROM player_absences WHERE session_date = ${date} AND email = ${e};`;
  }
}

export async function listAbsences(email: string, fromDate: string): Promise<string[]> {
  const { rows } = await sql`
    SELECT session_date::text AS d FROM player_absences WHERE email = ${email.trim().toLowerCase()} AND session_date >= ${fromDate};
  `;
  return rows.map((r) => r.d as string);
}

/** Just the streak and this month's attendance rank (for the Membership tab). */
export async function getQuickStats(player: { id: number; email: string }): Promise<{ streak: number; monthRank: number | null }> {
  if (!process.env.POSTGRES_URL) return { streak: 0, monthRank: null };
  syncRosterAttendanceLater();
  const today = getClubToday(new Date(), await clubClock()).dateKey;
  const [{ rows: att }, { rows: club }, { rows: abs }, board] = await Promise.all([
    sql`SELECT session_date::text AS d FROM attendance WHERE email = ${player.email} AND verified AND NOT removed;`,
    sql`SELECT date::text AS d FROM sessions WHERE date <= ${today};`,
    sql`SELECT session_date::text AS d FROM player_absences WHERE email = ${player.email};`,
    getLeaderboard("attendance", periodRange("month", today), player.id),
  ]);
  const attended = att.map((r) => r.d as string);
  const clubDays = [...new Set([...club.map((r) => r.d as string), ...attended])].sort();
  return {
    streak: computeStreaks(attended, clubDays, abs.map((r) => r.d as string), today).current,
    monthRank: board.find((r) => r.playerId === player.id)?.rank ?? null,
  };
}
