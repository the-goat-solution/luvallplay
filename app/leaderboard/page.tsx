import type { Metadata, Viewport } from "next";
import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { LeaderboardView } from "@/components/leaderboard/LeaderboardView";
import { getClubToday } from "@/lib/dates";
import { PLAYER_COOKIE, getCurrentPlayer } from "@/lib/player-auth";
import {
  PERIODS,
  getLeaderboard,
  syncRosterAttendance,
  periodFromKey,
  periodRange,
  type LeaderboardRow,
  type Metric,
  type Period,
} from "@/lib/stats-db";

export const metadata: Metadata = {
  title: "Leaderboard — Three Wolves Badminton Club",
  description: "Play days attended and round robin points at Three Wolves Badminton Club, by month, quarter, year and all time.",
};

export const viewport: Viewport = { themeColor: "#0e2c3f", viewportFit: "cover" };

// The public board is cached and refreshed whenever attendance, scores or
// someone's leaderboard setting changes (revalidateTag("leaderboard")), and
// at least every 10 minutes.
const cachedBoard = unstable_cache(
  async (metric: Metric, period: Period, key: string): Promise<LeaderboardRow[]> => {
    const range = periodFromKey(period, key) ?? periodRange(period, getClubToday().dateKey);
    await syncRosterAttendance();
    return getLeaderboard(metric, range);
  },
  ["leaderboard-v1"],
  { tags: ["leaderboard"], revalidate: 600 },
);

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ metric?: string; period?: string; key?: string; hidden?: string }>;
}) {
  const params = await searchParams;
  const metric: Metric = params.metric === "rr" ? "rr" : "attendance";
  const period: Period = (PERIODS as string[]).includes(params.period ?? "") ? (params.period as Period) : "month";
  const today = getClubToday().dateKey;
  const current = periodRange(period, today);
  const range = periodFromKey(period, params.key) ?? current;
  const hasDb = Boolean(process.env.POSTGRES_URL);

  const rows = hasDb ? await cachedBoard(metric, period, range.key) : [];

  // Highlight the signed-in player; a hidden player sees only their own rank.
  const store = await cookies();
  const player = hasDb && store.get(PLAYER_COOKIE) ? await getCurrentPlayer() : null;
  let hiddenRank: number | null = null;
  if (player && !player.leaderboardVisible) {
    const own = await getLeaderboard(metric, range, player.id);
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
      />
      <Footer />
    </>
  );
}
