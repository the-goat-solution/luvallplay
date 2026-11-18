import { sql } from "@vercel/postgres";
import { z } from "zod";
import { ArenaError, T, ensureArenaTables, loadWorld, type World } from "./arena-db";

// Match Analyzer stats saved against an Arena challenge. A court assistant
// (any signed-in player) films the doubles game with /match-analyzer, tags
// the four players and taps the hits; the totals land here. The video stays
// on their phone: only these numbers are stored.

/** A player in the analyzer's order: posting pair first, then the accepting pair. */
export type MatchPlayer = { id: number; name: string };
export type MatchSetup = {
  challengeId: number;
  status: string;
  teams: [{ name: string; players: [MatchPlayer, MatchPlayer] }, { name: string; players: [MatchPlayer, MatchPlayer] }];
  score: { posting: number | null; accepting: number | null } | null;
};

const playerStats = z.object({
  playerId: z.number().int().positive(),
  hits: z.number().int().min(0).max(5000),
  distance: z.number().min(0).max(50_000),
  topSpeed: z.number().min(0).max(15),
});

export const saveStatsSchema = z.object({
  challengeId: z.number().int().positive(),
  mode: z.enum(["live", "upload"]),
  duration: z.number().min(0).max(4 * 3600),
  rallies: z.number().int().min(0).max(2000),
  longestRally: z.number().int().min(0).max(1000),
  avgRallyShots: z.number().min(0).max(1000),
  fastestShotKmh: z.number().min(0).max(500).nullable(),
  players: z.array(playerStats).length(4),
});
export type SaveStatsInput = z.infer<typeof saveStatsSchema>;
export type SavedMatchStats = SaveStatsInput & { recordedBy: { id: number; name: string }; recordedAt: string };

/** Games that can still get stats: in play, waiting for a score, or finished within this window. */
const RECORD_WINDOW_HOURS = 36;
const RECORDABLE = new Set(["live", "awaiting", "disputed", "completed"]);

function setupFrom(world: World, challengeId: number): MatchSetup {
  const c = world.challenges.find((x) => x.id === challengeId);
  if (!c || !c.acceptingPlayers || !c.acceptingPair) throw new ArenaError("not_found");
  const player = (id: number): MatchPlayer => ({ id, name: world.players.get(id)?.name ?? "Wolf" });
  const pairName = (pairId: number, ids: [number, number]) =>
    world.pairs.get(pairId)?.name || ids.map((id) => world.players.get(id)?.firstName ?? "Wolf").join(" & ");
  return {
    challengeId: c.id,
    status: c.status,
    teams: [
      { name: pairName(c.postingPair, c.postingPlayers), players: [player(c.postingPlayers[0]), player(c.postingPlayers[1])] },
      { name: pairName(c.acceptingPair, c.acceptingPlayers), players: [player(c.acceptingPlayers[0]), player(c.acceptingPlayers[1])] },
    ],
    score: c.scorePosting != null || c.scoreAccepting != null ? { posting: c.scorePosting, accepting: c.scoreAccepting } : null,
  };
}

export async function loadMatchSetup(challengeId: number): Promise<{ setup: MatchSetup; stats: SavedMatchStats | null }> {
  const world = await loadWorld({ skipSync: true });
  const setup = setupFrom(world, challengeId);
  return { setup, stats: await loadMatchStats(challengeId) };
}

export async function loadMatchStats(challengeId: number): Promise<SavedMatchStats | null> {
  await ensureArenaTables();
  const { rows } = await sql.query(`SELECT stats FROM ${T.matchStats} WHERE challenge_id = $1;`, [challengeId]);
  return (rows[0]?.stats as SavedMatchStats | undefined) ?? null;
}

export async function saveMatchStats(recorder: { id: number }, input: SaveStatsInput): Promise<SavedMatchStats> {
  const world = await loadWorld({ skipSync: true });
  const c = world.challenges.find((x) => x.id === input.challengeId);
  if (!c || !c.acceptingPlayers) throw new ArenaError("not_found");
  if (!RECORDABLE.has(c.status)) throw new ArenaError("not_recordable");
  if (!c.checkedInAt || Date.now() - Date.parse(c.checkedInAt) > RECORD_WINDOW_HOURS * 3_600_000) throw new ArenaError("too_late");
  // The four players must be exactly this game's players, in analyzer order.
  const expected = [...c.postingPlayers, ...c.acceptingPlayers];
  if (input.players.some((p, i) => p.playerId !== expected[i])) throw new ArenaError("wrong_players");

  const saved: SavedMatchStats = {
    ...input,
    recordedBy: { id: recorder.id, name: world.players.get(recorder.id)?.name ?? "Wolf" },
    recordedAt: new Date().toISOString(),
  };
  await sql.query(
    `INSERT INTO ${T.matchStats} (challenge_id, recorded_by, stats) VALUES ($1, $2, $3)
     ON CONFLICT (challenge_id) DO UPDATE SET recorded_by = EXCLUDED.recorded_by, stats = EXCLUDED.stats, updated_at = NOW();`,
    [input.challengeId, recorder.id, JSON.stringify(saved)],
  );
  return saved;
}
