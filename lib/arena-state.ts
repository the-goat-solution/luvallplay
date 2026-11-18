import { sql } from "@vercel/postgres";
import {
  ARENA_SANDBOX,
  MIN_GAME_MINUTES,
  T,
  acceptBlocker,
  achievementsOf,
  avgRank,
  bonusesOnOffer,
  headToHead,
  loadWorld,
  loadWorldCached,
  packLeader,
  pairRecord,
  seasonChampion,
  syncPlayerRank,
  type ChallengeRow,
  type PlayerRank,
  type World,
} from "./arena-db";
import type { AchievementKey, Seat } from "./ranks";

// One JSON snapshot of the Arena for a viewer (signed in or not). The page
// renders it on the server, then polls /api/arena for fresh copies.

export type PlayerChip = { id: number; name: string; initials: string; rank: number; seat: Seat | null; tarnishing: boolean; /** Profile picture (never for hidden players). */ avatarUrl: string | null };
export type PairView = { id: number; name: string | null; players: [PlayerChip, PlayerChip]; avgRank: number };
export type ChallengeView = {
  id: number;
  status: ChallengeRow["status"];
  posting: PairView;
  accepting: PairView | null;
  note: string | null;
  availableUntil: string;
  postedAt: string;
  acceptedAt: string | null;
  checkedInAt: string | null;
  scorePosting: number | null;
  scoreAccepting: number | null;
  retiredBy: "posting" | "accepting" | null;
  enteredByMySide: boolean | null;
  mySide: "posting" | "accepting" | null;
  blocker: string | null;
  h2h: { won: number; lost: number } | null;
  offer: { giantKiller: boolean; newRival: boolean; crown: boolean } | null;
  crownMatch: boolean;
  /** Match Analyzer stats were saved for this game. */
  hasStats: boolean;
  /** A phone is tracking this game with Wolf Vision right now (only games where one was set up). */
  tracking: { rallies: number; hits: number; quality: number } | null;
};
export type FeedItem =
  | { kind: "result"; id: number; at: string; winners: PairView; losers: PairView; scoreW: number | null; scoreL: number | null; retired: boolean; stickers: string[]; hasStats: boolean }
  | { kind: "rankup"; at: string; player: PlayerChip; rank: number };
export type AfterGame = {
  challengeId: number;
  won: boolean;
  total: number;
  base: number;
  giantKiller: number;
  newRival: number;
  hotStreak: number;
  crownBounty: number;
  scoreFor: number | null;
  scoreAgainst: number | null;
  retired: boolean;
  opponents: PairView;
  partner: PlayerChip;
};
export type MeView = {
  id: number;
  name: string;
  initials: string;
  rank: PlayerRank;
  rankUp: { from: number; to: number } | null;
  pair: (PairView & { record: { won: number; lost: number; streak: number } }) | null;
  incomingRequest: PlayerChip | null;
  outgoingRequest: PlayerChip | null;
  achievements: Partial<Record<AchievementKey, string>>;
  after: AfterGame[];
};
export type ArenaState = {
  now: string;
  signedIn: boolean;
  sandbox: boolean;
  minGameMinutes: number;
  me: MeView | null;
  counts: { up: number; live: number; week: number };
  crown: { pair: PairView; since: string; defences: number } | null;
  packLeader: { player: PlayerChip; games: number } | null;
  champion: { player: PlayerChip; wp: number; key: string } | null;
  hot: { player: PlayerChip; streak: number } | null;
  live: ChallengeView[];
  open: ChallengeView[];
  mine: ChallengeView[];
  feed: FeedItem[];
};

export async function buildArenaState(viewer: { id: number } | null, opts: { maxAgeMs?: number } = {}): Promise<ArenaState> {
  const world = opts.maxAgeMs ? await loadWorldCached(opts.maxAgeMs) : await loadWorld();
  const chip = (id: number): PlayerChip => {
    const p = world.players.get(id);
    const r = world.ranks.get(id);
    const hidden = !viewer && p && !p.visible;
    return {
      id,
      name: hidden || !p ? "Wolf" : p.name,
      initials: hidden || !p ? "W" : p.initials,
      avatarUrl: hidden || !p ? null : p.avatarUrl ?? null,
      rank: r?.shown ?? 0,
      seat: r?.seat ?? null,
      tarnishing: r?.tarnishing ?? false,
    };
  };
  const pairView = (pairId: number, players: [number, number]): PairView => ({
    id: pairId,
    name: world.pairs.get(pairId)?.name ?? null,
    players: [chip(players[0]), chip(players[1])],
    avgRank: avgRank(world, players),
  });

  const myPair = viewer ? world.activePairOf.get(viewer.id) ?? null : null;
  const crownPairId = world.crown?.pairId ?? null;

  const view = (c: ChallengeRow): ChallengeView => {
    const mySide = viewer ? (c.postingPlayers.includes(viewer.id) ? "posting" : c.acceptingPlayers?.includes(viewer.id) ? "accepting" : null) : null;
    const enteredSide = c.enteredBy ? (c.postingPlayers.includes(c.enteredBy) ? "posting" : "accepting") : null;
    const canCompare = c.status === "open" && myPair && !mySide;
    return {
      id: c.id,
      status: c.status,
      posting: pairView(c.postingPair, c.postingPlayers),
      accepting: c.acceptingPair && c.acceptingPlayers ? pairView(c.acceptingPair, c.acceptingPlayers) : null,
      note: c.note,
      availableUntil: c.availableUntil,
      postedAt: c.postedAt,
      acceptedAt: c.acceptedAt,
      checkedInAt: c.checkedInAt,
      scorePosting: c.scorePosting,
      scoreAccepting: c.scoreAccepting,
      retiredBy: c.retiredBy,
      enteredByMySide: mySide && enteredSide ? enteredSide === mySide : null,
      mySide,
      blocker: viewer && c.status === "open" ? acceptBlocker(world, c, viewer.id) : null,
      h2h: canCompare ? headToHead(world, myPair!.players, c.postingPlayers) : null,
      offer: canCompare ? { ...bonusesOnOffer(world, myPair!.players, c.postingPlayers), crown: c.postingPair === crownPairId } : null,
      crownMatch: crownPairId !== null && (c.postingPair === crownPairId || c.acceptingPair === crownPairId),
      hasStats: world.statsFor.has(c.id),
      tracking: world.trackingFor.get(c.id) ?? null,
    };
  };

  const open = world.challenges
    .filter((c) => c.status === "open")
    .sort((a, b) => Number(b.postingPair === crownPairId) - Number(a.postingPair === crownPairId) || b.postedAt.localeCompare(a.postedAt))
    .map(view);
  const live = world.challenges.filter((c) => c.status === "live").map(view);
  const mine = viewer
    ? world.challenges
        .filter((c) => ["open", "accepted", "live", "awaiting", "disputed"].includes(c.status))
        .filter((c) => c.postingPlayers.includes(viewer.id) || c.acceptingPlayers?.includes(viewer.id))
        .map(view)
    : [];

  // Feed: recent results and rank-ups.
  const completed = world.challenges
    .filter((c) => c.status === "completed" && c.acceptingPlayers)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 12);
  const feed: FeedItem[] = [];
  for (const c of completed) {
    const rs = world.results.filter((r) => r.challengeId === c.id);
    const w = rs.find((r) => r.won);
    if (!w) continue;
    const winnersPosting = c.postingPlayers.includes(w.playerId);
    const winners = winnersPosting ? pairView(c.postingPair, c.postingPlayers) : pairView(c.acceptingPair!, c.acceptingPlayers!);
    const losers = winnersPosting ? pairView(c.acceptingPair!, c.acceptingPlayers!) : pairView(c.postingPair, c.postingPlayers);
    const scoreW = winnersPosting ? c.scorePosting : c.scoreAccepting;
    const scoreL = winnersPosting ? c.scoreAccepting : c.scorePosting;
    const stickers: string[] = [];
    if (scoreW === 30 && scoreL === 29) stickers.push("golden_point");
    else if (scoreW !== null && scoreL !== null && scoreW >= 22 && scoreW - scoreL <= 2) stickers.push("nail_biter");
    if (w.giantKiller) stickers.push("giant_killer");
    const crownEvent = world.crownEvents.get(c.id);
    if (crownEvent) stickers.push(`crown_${crownEvent}`);
    feed.push({ kind: "result", id: c.id, at: c.completedAt!, winners, losers, scoreW, scoreL, retired: Boolean(c.retiredBy), stickers, hasStats: world.statsFor.has(c.id) });
    for (const r of rs) if (r.rankAfter > r.rankBefore) feed.push({ kind: "rankup", at: c.completedAt!, player: chip(r.playerId), rank: r.rankAfter });
  }
  feed.sort((a, b) => b.at.localeCompare(a.at));

  const weekAgo = Date.now() - 7 * 86_400_000;
  const counts = {
    up: open.length,
    live: live.length,
    week: world.challenges.filter((c) => c.status === "completed" && c.completedAt && Date.parse(c.completedAt) > weekAgo).length,
  };

  let hot: ArenaState["hot"] = null;
  for (const [id, streak] of world.streakOf) {
    if (streak >= 3 && (!hot || streak > hot.streak)) hot = { player: chip(id), streak };
  }
  const leader = packLeader(world);
  const champ = seasonChampion(world);
  const crownPair = world.crown;

  return {
    now: new Date().toISOString(),
    signedIn: Boolean(viewer),
    sandbox: ARENA_SANDBOX,
    minGameMinutes: MIN_GAME_MINUTES,
    me: viewer ? await meView(world, viewer.id, pairView, chip) : null,
    counts,
    crown: crownPair ? { pair: pairView(crownPair.pairId, crownPair.players), since: crownPair.since, defences: crownPair.defences } : null,
    packLeader: leader ? { player: chip(leader.playerId), games: leader.games } : null,
    champion: champ ? { player: chip(champ.playerId), wp: champ.wp, key: champ.key } : null,
    hot,
    live,
    open,
    mine,
    feed: feed.slice(0, 14),
  };
}

async function meView(
  world: World,
  id: number,
  pairView: (pairId: number, players: [number, number]) => PairView,
  chip: (id: number) => PlayerChip,
): Promise<MeView | null> {
  const p = world.players.get(id);
  const rank = world.ranks.get(id);
  if (!p || !rank) return null;
  const pair = world.activePairOf.get(id);

  const [{ seen, polishedAt }, incoming, outgoing, answered] = await Promise.all([
    syncPlayerRank(world, id),
    sql.query(
      `SELECT consumed_by FROM ${T.codes} WHERE purpose = 'pair' AND owner_id = $1 AND status = 'requested' AND expires_at > NOW() ORDER BY id DESC LIMIT 1;`,
      [id],
    ),
    sql.query(
      `SELECT owner_id FROM ${T.codes} WHERE purpose = 'pair' AND consumed_by = $1 AND status = 'requested' AND expires_at > NOW() ORDER BY id DESC LIMIT 1;`,
      [id],
    ),
    sql.query(`SELECT challenge_id FROM ${T.after} WHERE player_id = $1;`, [id]),
  ]);
  const answeredIds = new Set(answered.rows.map((r) => r.challenge_id as number));

  const after: AfterGame[] = [];
  const recentCut = Date.now() - 3 * 86_400_000;
  for (const r of world.results.filter((x) => x.playerId === id)) {
    const c = world.challenges.find((x) => x.id === r.challengeId)!;
    if (answeredIds.has(c.id) || !c.completedAt || Date.parse(c.completedAt) < recentCut) continue;
    const posting = c.postingPlayers.includes(id);
    const opp = posting ? pairView(c.acceptingPair!, c.acceptingPlayers!) : pairView(c.postingPair, c.postingPlayers);
    const mine = posting ? c.postingPlayers : c.acceptingPlayers!;
    after.push({
      challengeId: c.id,
      won: r.won,
      total: r.total,
      base: r.base,
      giantKiller: r.giantKiller,
      newRival: r.newRival,
      hotStreak: r.hotStreak,
      crownBounty: r.crownBounty,
      scoreFor: c.retiredBy ? null : r.pointsFor,
      scoreAgainst: c.retiredBy ? null : r.pointsAgainst,
      retired: Boolean(c.retiredBy),
      opponents: opp,
      partner: chip(mine.find((x) => x !== id) ?? id),
    });
  }

  return {
    id,
    name: p.name,
    initials: p.initials,
    rank,
    rankUp: rank.earned > seen ? { from: seen, to: rank.earned } : null,
    pair: pair ? { ...pairView(pair.id, pair.players), record: pairRecord(world, pair.id) } : null,
    incomingRequest: incoming.rows[0] ? chip(incoming.rows[0].consumed_by) : null,
    outgoingRequest: outgoing.rows[0] ? chip(outgoing.rows[0].owner_id) : null,
    achievements: achievementsOf(world, id, polishedAt),
    after,
  };
}
