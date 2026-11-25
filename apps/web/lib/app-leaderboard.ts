// The players' app Leaderboard (/api/v1/app/clubs/{club}/leaderboard and
// /players/{id}): the website's points board and player card, from the same
// functions as app/profile/leaderboard and /api/arena/player/[id].
import type { QueryOf } from "@luvallplay/api/contract";
import { getPointsBoard, loadWorldCached } from "./arena-db";
import { clubClock } from "./club";
import { getClubToday } from "./dates";
import { cachedBoard, selectBoard } from "./leaderboard-data";
import { playerCardFor } from "./player-card";
import type { Player } from "./player-db";

export async function pointsBoard(player: Player, q: QueryOf<"leaderboard.board">) {
  const sel = selectBoard(q, getClubToday(new Date(), await clubClock()).dateKey);
  const rows = await cachedBoard(sel.source, sel.period, sel.range.key);
  // Someone who hides sees only their own rank (the opt-out is respected).
  let hiddenRank: number | null = null;
  if (!player.leaderboardVisible) {
    const own = await getPointsBoard(sel.source, sel.range, player.id);
    hiddenRank = own.find((r) => r.playerId === player.id)?.rank ?? null;
  }
  const mine = (await loadWorldCached(10_000)).ranks.get(player.id);
  return {
    source: sel.source,
    period: sel.period,
    range: sel.range,
    prevKey: sel.prevKey,
    nextKey: sel.nextKey,
    isCurrent: sel.range.key === sel.current.key,
    rows,
    me: { id: player.id, visible: player.leaderboardVisible, hiddenRank, ladder: mine ? { index: mine.shown, wpTotal: mine.wpTotal } : null },
  };
}

export async function playerCard(viewerId: number, id: number) {
  return playerCardFor(await loadWorldCached(5000), id, viewerId);
}
