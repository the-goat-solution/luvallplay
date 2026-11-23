import { NextResponse } from "next/server";
import { sql } from "./database";
import { addDays, getSpotsAndHeadcountForDates, listSessionsInRange } from "./db";
import { getClubToday, getMembershipDayForDate } from "./dates";
import { getPlayerById } from "./player-db";
import { getCurrentMembership } from "./membership-self-service";
import {
  PERIODS,
  getLeaderboard,
  getPlayerStats,
  periodFromKey,
  periodRange,
  recordAttendance,
  type Metric,
  type Period,
} from "./stats-db";
import { authenticateToken, bearerFrom, type Scope } from "./webhooks";
import { checkRateLimit } from "./security";

// Shared by the REST API (/api/v1/*) and the MCP server (/api/mcp), so both
// expose exactly the same data with the same permissions.

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
  "Cache-Control": "no-store",
};

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export type ApiCaller = { playerId: number; email: string; scopes: Scope[] };

/** The token's player, if it carries `scope`; otherwise an error response. */
export async function requireScope(request: Request, scope: Scope, tokenOverride?: string | null): Promise<ApiCaller | NextResponse> {
  if (!process.env.POSTGRES_URL) return json({ error: "unavailable" }, 503);
  const caller = await authenticateToken(tokenOverride ?? bearerFrom(request));
  if (!caller) return json({ error: "unauthorized", message: "Send an access key from your profile as 'Authorization: Bearer tw_…'." }, 401);
  if (!checkRateLimit(`api:${caller.playerId}`, 120, 60_000)) return json({ error: "rate_limited" }, 429);
  if (!caller.scopes.includes(scope)) return json({ error: "forbidden", message: `This key needs the ${scope} permission.` }, 403);
  return caller;
}

export async function meData(c: ApiCaller) {
  const player = await getPlayerById(c.playerId);
  if (!player) return null;
  const m = await getCurrentMembership(player.email);
  return {
    displayName: player.displayName,
    firstName: player.firstName,
    memberSince: player.createdAt.slice(0, 10),
    language: player.lang,
    membership: m
      ? { plan: m.plan, day: m.day, status: m.cancelAtPeriodEnd ? "ending" : m.status, periodStart: m.periodStart, periodEnd: m.periodEnd, autoRenews: m.recurring && !m.cancelAtPeriodEnd }
      : null,
  };
}

export async function attendanceData(c: ApiCaller, from?: string | null, to?: string | null) {
  const { rows } = await sql.query(
    `SELECT session_date::text AS date, source, verified FROM attendance
     WHERE email = $1 AND NOT removed
       AND ($2::date IS NULL OR session_date >= $2::date)
       AND ($3::date IS NULL OR session_date <= $3::date)
     ORDER BY session_date DESC LIMIT 1000;`,
    [c.email, validDate(from), validDate(to)],
  );
  return rows.map((r) => ({ date: r.date as string, source: r.source as string, confirmed: r.verified as boolean }));
}

export async function roundRobinData(c: ApiCaller) {
  const player = await getPlayerById(c.playerId);
  if (!player?.minigameName) return [];
  const { rows } = await sql`
    SELECT session_date::text AS date, wins, losses, points_for, points_against, rr_points, finish_place, teams_count
    FROM rr_results WHERE lower(mg_name) = lower(${player.minigameName}) ORDER BY session_date DESC;
  `;
  return rows.map((r) => ({
    date: r.date as string,
    rrPoints: r.rr_points as number,
    wins: r.wins as number,
    losses: r.losses as number,
    pointsFor: r.points_for as number,
    pointsAgainst: r.points_against as number,
    placing: r.finish_place as number,
    teams: r.teams_count as number,
  }));
}

export async function statsData(c: ApiCaller) {
  const player = await getPlayerById(c.playerId);
  if (!player) return null;
  const s = await getPlayerStats(player);
  return {
    playDays: s.attended,
    streakWeeks: s.streak,
    roundRobin: s.rr,
    leaderboardRanks: s.ranks,
  };
}

export function parsePeriod(raw: string | null | undefined): Period {
  return (PERIODS as string[]).includes(raw ?? "") ? (raw as Period) : "month";
}

export async function leaderboardData(metricRaw: string | null | undefined, periodRaw: string | null | undefined, key?: string | null) {
  const metric: Metric = metricRaw === "rr" ? "rr" : "attendance";
  const period = parsePeriod(periodRaw);
  const range = periodFromKey(period, key ?? undefined) ?? periodRange(period, getClubToday().dateKey);
  const rows = await getLeaderboard(metric, range);
  return {
    metric,
    period,
    key: range.key,
    from: range.start,
    to: range.end,
    rows: rows.map((r) => ({ rank: r.rank, name: r.name, value: r.value, ...(metric === "rr" ? { wins: r.wins, diff: r.diff } : {}) })),
  };
}

export async function upcomingSessionsData(days = 30) {
  const today = getClubToday().dateKey;
  const sessions = await listSessionsInRange(today, addDays(today, Math.min(60, Math.max(1, days))));
  const { spots } = await getSpotsAndHeadcountForDates(sessions.map((s) => s.date));
  return sessions.map((s) => ({
    date: s.date,
    start: s.eventStartTime,
    end: s.eventEndTime,
    location: s.eventLocation,
    membershipDay: getMembershipDayForDate(s.date),
    casualSpotsLeft: spots[s.date] ?? 0,
  }));
}

/** A check-in from a connected app. Stored unconfirmed until an admin confirms it. */
export async function logActivity(c: ApiCaller, date: string): Promise<{ recorded: boolean; confirmed: false }> {
  const d = validDate(date);
  if (!d) throw new Error("invalid_date");
  const today = getClubToday().dateKey;
  if (d > today || d < addDays(today, -60)) throw new Error("date_out_of_range");
  const { rows } = await sql`SELECT 1 FROM sessions WHERE date = ${d} AND google_event_id IS NOT NULL;`;
  if (rows.length === 0) throw new Error("not_a_play_day");
  await recordAttendance(d, [c.email], "api", false);
  return { recorded: true, confirmed: false };
}

/** The player's upcoming play days: membership days (unless they can't make it) and casual bookings. */
export async function myUpcomingPlayDays(c: ApiCaller) {
  const player = await getPlayerById(c.playerId);
  if (!player) return [];
  const m = await getCurrentMembership(player.email);
  const sessions = await upcomingSessionsData(60);
  const today = getClubToday().dateKey;
  const [{ rows: bookings }, { rows: absences }] = await Promise.all([
    sql`SELECT session_date::text AS d FROM bookings WHERE lower(trim(email)) = ${player.email} AND status = 'confirmed' AND session_date >= ${today};`,
    sql`SELECT session_date::text AS d FROM player_absences WHERE email = ${player.email} AND session_date >= ${today};`,
  ]);
  const booked = new Set(bookings.map((b) => b.d as string));
  const absent = new Set(absences.map((a) => a.d as string));
  return sessions.filter((s) => {
    if (booked.has(s.date)) return true;
    if (!m || s.membershipDay !== m.day || absent.has(s.date)) return false;
    if (m.periodStart && s.date < m.periodStart) return false;
    return (m.periodEnd && s.date <= m.periodEnd) || (m.recurring && !m.cancelAtPeriodEnd);
  });
}

function validDate(v: string | null | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
}
