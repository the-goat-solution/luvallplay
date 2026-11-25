import { clubClock } from "@/lib/club";
import { getClubToday } from "@/lib/dates";
import { LeaderboardView, type MyLadder } from "@/components/leaderboard/LeaderboardView";
import { getCurrentPlayer } from "@/lib/player-auth";
import { getPointsBoard, loadWorldCached } from "@/lib/arena-db";
import { cachedBoard, selectBoard, type BoardQuery } from "@/lib/leaderboard-data";

// The Leaderboard tab: the Wolf Points board (the public /leaderboard page
// redirects here for signed-in players). Rows open a player card with a
// "Challenge" button that goes to the Arena.

export default async function ProfileLeaderboardPage({ searchParams }: { searchParams: Promise<BoardQuery & { hidden?: string }> }) {
  const player = await getCurrentPlayer();
  if (!player) return null;
  const params = await searchParams;
  const sel = selectBoard(params, getClubToday(new Date(), await clubClock()).dateKey);
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const rows = hasDb ? await cachedBoard(sel.source, sel.period, sel.range.key) : [];
  // A hidden player sees only their own rank (the opt-out is respected).
  let hiddenRank: number | null = null;
  let myLadder: MyLadder | null = null;
  if (hasDb) {
    if (!player.leaderboardVisible) {
      const own = await getPointsBoard(sel.source, sel.range, player.id);
      hiddenRank = own.find((r) => r.playerId === player.id)?.rank ?? null;
    }
    const mine = (await loadWorldCached(10_000)).ranks.get(player.id);
    if (mine) myLadder = { index: mine.shown, wpTotal: mine.wpTotal };
  }
  return (
    <LeaderboardView
      source={sel.source}
      period={sel.period}
      range={sel.range}
      rows={rows}
      prevKey={sel.prevKey}
      nextKey={sel.nextKey}
      isCurrent={sel.range.key === sel.current.key}
      meId={player.id}
      meVisible={player.leaderboardVisible}
      hiddenRank={hiddenRank}
      signedIn
      justHidden={params.hidden === "1"}
      myLadder={myLadder}
    />
  );
}
