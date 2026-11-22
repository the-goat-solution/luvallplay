import { historyFor, type World } from "./arena-db";
import type { Seat } from "./ranks";

// The player card in the Arena's Leaderboard (build plan §2.3): rank art,
// Wolf Points, recent form, and what "Challenge" can do right now.

export type PlayerCard = {
  id: number;
  name: string;
  initials: string;
  avatarUrl: string | null;
  rankIndex: number;
  seat: Seat | null;
  tarnishing: boolean;
  wpTotal: number;
  wp90: number;
  /** Last five challenge results, newest first. */
  form: ("W" | "L")[];
  isMe: boolean;
  /** An open challenge posted by this player's pair: "Challenge" accepts it. */
  openChallengeId: number | null;
  /** Shares a pair with the viewer (no challenging your own partner). */
  partner: boolean;
};

/** null when the player doesn't exist or hides from the leaderboard (and isn't the viewer). */
export function playerCardFor(world: World, playerId: number, viewerId: number | null): PlayerCard | null {
  const p = world.players.get(playerId);
  if (!p) return null;
  const isMe = viewerId === playerId;
  if (!p.visible && !isMe) return null;
  const r = world.ranks.get(playerId);
  const form = historyFor(world, playerId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.challengeId - a.challengeId))
    .slice(0, 5)
    .map((g) => (g.won ? ("W" as const) : ("L" as const)));
  const theirPair = world.activePairOf.get(playerId) ?? null;
  const myPair = viewerId ? (world.activePairOf.get(viewerId) ?? null) : null;
  const open = theirPair ? world.challenges.find((c) => c.status === "open" && c.postingPair === theirPair.id) : undefined;
  return {
    id: p.id,
    name: p.name,
    initials: p.initials,
    avatarUrl: p.avatarUrl ?? null,
    rankIndex: r?.shown ?? 0,
    seat: r?.seat ?? null,
    tarnishing: r?.tarnishing ?? false,
    wpTotal: r?.wpTotal ?? 0,
    wp90: r?.wp90 ?? 0,
    form,
    isMe,
    openChallengeId: open && (!myPair || myPair.id !== open.postingPair) ? open.id : null,
    partner: Boolean(myPair && theirPair && myPair.id === theirPair.id),
  };
}
