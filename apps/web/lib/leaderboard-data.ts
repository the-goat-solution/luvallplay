import { clubClock } from "./club";
import { unstable_cache } from "next/cache";
import { getPointsBoard, type PointsBoardRow, type PointsSource } from "./arena-db";
import { getClubToday } from "./dates";
import { firstNameOnly } from "./first-name";
import { PERIODS, periodFromKey, periodRange, type Period, type PeriodRange } from "./stats-db";

// The Wolf Points board, shared by the Arena's Leaderboard segment and the
// public teaser on the club home page. Cached and refreshed whenever
// attendance, scores or someone's leaderboard setting changes
// (revalidateTag("leaderboard")), and at least every 5 minutes.

export const SOURCES: PointsSource[] = ["all", "challenges", "play", "rr"];
// Old links (?metric=…) still land on the matching list.
const FROM_METRIC: Record<string, PointsSource> = { wp: "all", challenges: "challenges", attendance: "play", rr: "rr" };

export const cachedBoard = unstable_cache(
  async (source: PointsSource, period: Period, key: string): Promise<PointsBoardRow[]> => {
    const range = periodFromKey(period, key) ?? periodRange(period, getClubToday(new Date(), await clubClock()).dateKey);
    return getPointsBoard(source, range);
  },
  [`points-board-v2-${process.env.VERCEL_ENV ?? "local"}`],
  { tags: ["leaderboard"], revalidate: 300 },
);

export type BoardQuery = { source?: string; metric?: string; period?: string; key?: string };

export type BoardSelection = {
  source: PointsSource;
  period: Period;
  range: PeriodRange;
  current: PeriodRange;
  prevKey: string | null;
  nextKey: string | null;
};

/** Reads ?source, ?metric (old links), ?period and ?key. */
export function selectBoard(q: BoardQuery, today: string): BoardSelection {
  const source: PointsSource = SOURCES.includes(q.source as PointsSource) ? (q.source as PointsSource) : (FROM_METRIC[q.metric ?? ""] ?? "all");
  const period: Period = (PERIODS as string[]).includes(q.period ?? "") ? (q.period as Period) : "month";
  const current = periodRange(period, today);
  const range = periodFromKey(period, q.key) ?? current;
  const prev = period === "lifetime" ? null : periodRange(period, range.start!, -1);
  const next = period === "lifetime" ? null : periodRange(period, range.start!, 1);
  return { source, period, range, current, prevKey: prev?.key ?? null, nextKey: next && next.start! <= today ? next.key : null };
}

export type TeaserRow = { rank: number; firstName: string; points: number };

/**
 * The public teaser: this month's top 5, first names only. Opted-out players
 * are already left out of the board (getPointsBoard), so they never appear.
 */
export async function teaserBoard(): Promise<TeaserRow[]> {
  const today = getClubToday(new Date(), await clubClock()).dateKey;
  const range = periodRange("month", today);
  const rows = await cachedBoard("all", "month", range.key);
  return rows.slice(0, 5).map((r) => ({ rank: r.rank, firstName: firstNameOnly(r.name), points: r.value }));
}
