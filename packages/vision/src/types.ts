// The shapes the tracker reads from its server (the same on the website and
// in the players' app): a challenge's set-up and stats already saved.
export type MatchPlayer = { id: number; name: string; avatarUrl?: string | null };
export type MatchSetup = {
  challengeId: number;
  status: string;
  teams: [{ name: string; players: [MatchPlayer, MatchPlayer] }, { name: string; players: [MatchPlayer, MatchPlayer] }];
  score: { posting: number | null; accepting: number | null } | null;
};
export type SavedPlayerStats = { playerId: number; hits: number; distance: number; topSpeed: number };
export type SavedMatchStats = {
  challengeId: number;
  mode: "live" | "upload";
  duration: number;
  rallies: number;
  longestRally: number;
  avgRallyShots: number;
  fastestShotKmh: number | null;
  players: SavedPlayerStats[];
  auto?: { quality: number; accepted: number; inferred: number; predicted: number; estimated: number; plusMinus: number };
  recordedBy: { id: number; name: string };
  recordedAt: string;
};
