import type { Metadata, Viewport } from "next";
import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { LeaderboardView, type MyLadder } from "@/components/leaderboard/LeaderboardView";
import { getPointsBoard, loadWorldCached, type PointsBoardRow, type PointsSource } from "@/lib/arena-db";
import { getClubToday } from "@/lib/dates";
import { PLAYER_COOKIE, getCurrentPlayer } from "@/lib/player-auth";
import { PERIODS, periodFromKey, periodRange, type Period } from "@/lib/stats-db";

export const metadata: Metadata = {
  title: "Leaderboard — Three Wolves Badminton Club",
  description: "Wolf Points at Three Wolves Badminton Club from play days, round robin and challenges, by month, quarter, year to date and all time.",
};

export const viewport: Viewport = { themeColor: "#0e2c3f", viewportFit: "cover" };

const SOURCES: PointsSource[] = ["all", "challenges", "play", "rr"];
// Old links (?metric=…) still land on the matching list.
const FROM_METRIC: Record<string, PointsSource> = { wp: "all", challenges: "challenges", attendance: "play", rr: "rr" };

// Cached and refreshed whenever attendance, scores or someone's leaderboard
// setting changes (revalidateTag("leaderboard")), and at least every 5 minutes.
const cachedBoard = unstable_cache(
  async (source: PointsSource, period: Period, key: string): Promise<PointsBoardRow[]> => {
    const range = periodFromKey(period, key) ?? periodRange(period, getClubToday().dateKey);
    return getPointsBoard(source, range);
  },
  [`points-board-${process.env.VERCEL_ENV ?? "local"}`],
  { tags: ["leaderboard"], revalidate: 300 },
);

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; metric?: string; period?: string; key?: string; hidden?: string }>;
}) {
  const params = await searchParams;
  const source: PointsSource = SOURCES.includes(params.source as PointsSource)
    ? (params.source as PointsSource)
    : (FROM_METRIC[params.metric ?? ""] ?? "all");
  const period: Period = (PERIODS as string[]).includes(params.period ?? "") ? (params.period as Period) : "month";
  const today = getClubToday().dateKey;
  const current = periodRange(period, today);
  const range = periodFromKey(period, params.key) ?? current;
  const hasDb = Boolean(process.env.POSTGRES_URL);

  const rows = hasDb ? await cachedBoard(source, period, range.key) : [];

  // Highlight the signed-in player; a hidden player sees only their own rank.
  const store = await cookies();
  const player = hasDb && store.get(PLAYER_COOKIE) ? await getCurrentPlayer() : null;
  let hiddenRank: number | null = null;
  let myLadder: MyLadder | null = null;
  if (player) {
    if (!player.leaderboardVisible) {
      const own = await getPointsBoard(source, range, player.id);
      hiddenRank = own.find((r) => r.playerId === player.id)?.rank ?? null;
    }
    const mine = (await loadWorldCached(10_000)).ranks.get(player.id);
    if (mine) myLadder = { index: mine.shown, wpTotal: mine.wpTotal };
  }

  const prev = period === "lifetime" ? null : periodRange(period, range.start!, -1);
  const next = period === "lifetime" ? null : periodRange(period, range.start!, 1);

  return (
    <>
      <Navigation />
      <LeaderboardView
        source={source}
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
        myLadder={myLadder}
      />
      <Footer />
    </>
  );
}
