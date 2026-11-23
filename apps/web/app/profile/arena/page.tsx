import { clubClock } from "@/lib/club";
import { getClubToday } from "@/lib/dates";
import { ArenaView } from "@/components/arena/ArenaView";
import { ArenaSegments, type ArenaSegment } from "@/components/arena/ArenaSegments";
import { RanksView } from "@/components/arena/RanksView";
import { LeaderboardView, type MyLadder } from "@/components/leaderboard/LeaderboardView";
import { getCurrentPlayer } from "@/lib/player-auth";
import { buildArenaState } from "@/lib/arena-state";
import { getPointsBoard, loadWorldCached } from "@/lib/arena-db";
import { cachedBoard, selectBoard, type BoardQuery } from "@/lib/leaderboard-data";

// The Arena tab, in three segments (build plan §2.1, §2.3):
// - Challenges: pair challenges, codes, scores and the feed (?tab absent).
// - Leaderboard: the Wolf Points board (moved here from the public
//   /leaderboard page, which redirects here for signed-in players). Rows
//   open a player card with a "Challenge" button.
// - Ranks: your rank card and the whole ladder.

const SEGMENTS: ArenaSegment[] = ["challenges", "leaderboard", "ranks"];

export default async function ProfileArenaPage({ searchParams }: { searchParams: Promise<BoardQuery & { tab?: string; hidden?: string }> }) {
  const player = await getCurrentPlayer();
  if (!player) return null;
  const params = await searchParams;
  const tab: ArenaSegment = SEGMENTS.includes(params.tab as ArenaSegment) ? (params.tab as ArenaSegment) : "challenges";

  if (tab === "leaderboard") {
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
      <>
        <ArenaSegments active="leaderboard" />
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
      </>
    );
  }

  const state = await buildArenaState({ id: player.id });
  if (tab === "ranks") {
    return (
      <>
        <ArenaSegments active="ranks" />
        <RanksView me={state.me} />
      </>
    );
  }
  return (
    <>
      <ArenaSegments active="challenges" />
      <ArenaView initial={state} embedded />
    </>
  );
}
