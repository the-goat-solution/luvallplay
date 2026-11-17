import type { Metadata, Viewport } from "next";
import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { LeaderboardView, type BoardMetric, type RankBadges } from "@/components/leaderboard/LeaderboardView";
import { getArenaLeaderboard, getRankBadges } from "@/lib/arena-db";
import { getClubToday } from "@/lib/dates";
import { PLAYER_COOKIE, getCurrentPlayer } from "@/lib/player-auth";
import {
  PERIODS,
  getLeaderboard,
  syncRosterAttendance,
  periodFromKey,
  periodRange,
  type LeaderboardRow,
  type Period,
} from "@/lib/stats-db";

export const metadata: Metadata = {
  title: "Leaderboard — Three Wolves Badminton Club",
  description: "Wolf Points, challenges, play days attended and round robin points at Three Wolves Badminton Club, by month, quarter, year and all time.",
};

export const viewport: Viewport = { themeColor: "#0e2c3f", viewportFit: "cover" };

// The public board is cached and refreshed whenever attendance, scores or
// someone's leaderboard setting changes (revalidateTag("leaderboard")), and
// at least every 10 minutes.
const cachedBoard = unstable_cache(
  async (metric: "attendance" | "rr", period: Period, key: string): Promise<LeaderboardRow[]> => {
    const range = periodFromKey(period, key) ?? periodRange(period, getClubToday().dateKey);
    await syncRosterAttendance();
    return getLeaderboard(metric, range);
  },
  ["leaderboard-v1"],
  { tags: ["leaderboard"], revalidate: 600 },
);

// Wolf Points and Challenges come from the Arena (lib/arena-db.ts); the
// rank icons beside every name too. Same cache tag, so a confirmed result
// or a new play day refreshes them.
const cachedArenaBoard = unstable_cache(
  async (metric: "wp" | "challenges", period: Period, key: string): Promise<LeaderboardRow[]> => {
    const range = periodFromKey(period, key) ?? periodRange(period, getClubToday().dateKey);
    const rows = await getArenaLeaderboard(metric, range);
    return rows.map((r) => ({ rank: r.rank, playerId: r.playerId, name: r.name, initials: r.initials, value: r.value, wins: r.wins, days: r.played }));
  },
  [`arena-board-${process.env.VERCEL_ENV ?? "local"}`],
  { tags: ["leaderboard"], revalidate: 300 },
);
const cachedBadges = unstable_cache(async (): Promise<RankBadges> => getRankBadges(), [`arena-badges-${process.env.VERCEL_ENV ?? "local"}`], {
  tags: ["leaderboard"],
  revalidate: 300,
});

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ metric?: string; period?: string; key?: string; hidden?: string }>;
}) {
  const params = await searchParams;
  const metric: BoardMetric = (["wp", "challenges", "attendance", "rr"] as const).includes(params.metric as BoardMetric) ? (params.metric as BoardMetric) : "wp";
  const period: Period = (PERIODS as string[]).includes(params.period ?? "") ? (params.period as Period) : "month";
  const today = getClubToday().dateKey;
  const current = periodRange(period, today);
  const range = periodFromKey(period, params.key) ?? current;
  const hasDb = Boolean(process.env.POSTGRES_URL);

  const isArena = metric === "wp" || metric === "challenges";
  const [rows, badges] = hasDb
    ? await Promise.all([
        isArena ? cachedArenaBoard(metric, period, range.key) : cachedBoard(metric, period, range.key),
        cachedBadges().catch(() => ({}) as RankBadges),
      ])
    : [[] as LeaderboardRow[], {} as RankBadges];

  // Highlight the signed-in player; a hidden player sees only their own rank.
  const store = await cookies();
  const player = hasDb && store.get(PLAYER_COOKIE) ? await getCurrentPlayer() : null;
  let hiddenRank: number | null = null;
  if (player && !player.leaderboardVisible) {
    const own = isArena ? await getArenaLeaderboard(metric, range, player.id) : await getLeaderboard(metric, range, player.id);
    hiddenRank = own.find((r) => r.playerId === player.id)?.rank ?? null;
  }

  const prev = period === "lifetime" ? null : periodRange(period, range.start!, -1);
  const next = period === "lifetime" ? null : periodRange(period, range.start!, 1);

  return (
    <>
      <Navigation />
      <LeaderboardView
        metric={metric}
        period={period}
        range={range}
        rows={rows}
        prevKey={prev?.key ?? null}
        nextKey={next && next.start! <= today ? next.key : null}
        isCurrent={range.key === current.key}
        meId={player?.id ?? null}
        meVisible={player?.leaderboardVisible ?? true}
        hiddenRank={hiddenRank}
        signedIn={Boolean(player)}
        justHidden={params.hidden === "1"}
        badges={badges}
      />
      <Footer />
    </>
  );
}
