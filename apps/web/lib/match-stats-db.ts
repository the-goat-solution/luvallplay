import { sql } from "./database";
import { z } from "zod";
import { ArenaError, T, loadWorld, type World } from "./arena-db";

// Match Analyzer stats saved against an Arena challenge. One of the game's
// four players films it with Wolf Vision (/profile/wolf-vision), tags the
// players and taps the hits; the totals land here. The video stays on their
// phone: only these numbers are stored.
//
// Who may write (audit H4): only a player in the game. Anyone signed in used
// to be able to save stats for any game, replace a game's saved stats, and
// mark any game as tracked live. Saved (final) stats are kept: a second
// save doesn't replace them, and a heartbeat doesn't touch them.

/** A player in the analyzer's order: posting pair first, then the accepting pair. */
export type MatchPlayer = { id: number; name: string; avatarUrl?: string | null };
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
  /** Automatic tracking details (Wolf Vision): quality and how hits were found. */
  auto: z
    .object({
      quality: z.number().min(0).max(1),
      accepted: z.number().int().min(0).max(5000),
      inferred: z.number().int().min(0).max(5000),
      predicted: z.number().int().min(0).max(5000),
      estimated: z.number().int().min(0).max(10000),
      plusMinus: z.number().int().min(0).max(10000),
    })
    .optional(),
});

export const heartbeatSchema = z.object({
  challengeId: z.number().int().positive(),
  kind: z.enum(["start", "beat", "end"]),
  rallies: z.number().int().min(0).max(5000),
  hits: z.number().int().min(0).max(20000),
  quality: z.number().min(0).max(1),
});
export type SaveStatsInput = z.infer<typeof saveStatsSchema>;
export type SavedMatchStats = SaveStatsInput & { recordedBy: { id: number; name: string }; recordedAt: string };

/** Games that can still get stats: in play, waiting for a score, or finished within this window. */
const RECORD_WINDOW_HOURS = 36;
const RECORDABLE = new Set(["live", "awaiting", "disputed", "completed"]);

function setupFrom(world: World, challengeId: number): MatchSetup {
  const c = world.challenges.find((x) => x.id === challengeId);
  if (!c || !c.acceptingPlayers || !c.acceptingPair) throw new ArenaError("not_found");
  const player = (id: number): MatchPlayer => ({ id, name: world.players.get(id)?.name ?? "Wolf", avatarUrl: world.players.get(id)?.avatarUrl ?? null });
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
  const { rows } = await sql.query(`SELECT stats FROM ${T.matchStats} WHERE challenge_id = $1 AND status = 'final';`, [challengeId]);
  return (rows[0]?.stats as SavedMatchStats | undefined) ?? null;
}

export async function saveMatchStats(recorder: { id: number }, input: SaveStatsInput): Promise<SavedMatchStats> {
  const world = await loadWorld({ skipSync: true });
  const c = world.challenges.find((x) => x.id === input.challengeId);
  if (!c || !c.acceptingPlayers) throw new ArenaError("not_found");
  // The four players of this game, in analyzer order; the recorder is one of them.
  const expected = [...c.postingPlayers, ...c.acceptingPlayers];
  if (!expected.includes(recorder.id)) throw new ArenaError("not_your_game");
  if (!RECORDABLE.has(c.status)) throw new ArenaError("not_recordable");
  if (!c.checkedInAt || Date.now() - Date.parse(c.checkedInAt) > RECORD_WINDOW_HOURS * 3_600_000) throw new ArenaError("too_late");
  if (input.players.some((p, i) => p.playerId !== expected[i])) throw new ArenaError("wrong_players");

  const saved: SavedMatchStats = {
    ...input,
    recordedBy: { id: recorder.id, name: world.players.get(recorder.id)?.name ?? "Wolf" },
    recordedAt: new Date().toISOString(),
  };
  // A tracking row (heartbeats) becomes final; a final row is never replaced.
  const { rows } = await sql.query(
    `INSERT INTO ${T.matchStats} (challenge_id, recorded_by, stats, status) VALUES ($1, $2, $3, 'final')
     ON CONFLICT (challenge_id) DO UPDATE SET recorded_by = EXCLUDED.recorded_by, stats = EXCLUDED.stats, status = 'final', updated_at = NOW()
       WHERE ${T.matchStats}.status <> 'final'
     RETURNING challenge_id;`,
    [input.challengeId, recorder.id, JSON.stringify(saved)],
  );
  if (rows.length) return saved;
  // Already saved. The same person sending it again (a retry after a lost
  // answer) gets what was kept; anyone else is told it is taken.
  const kept = await loadMatchStats(input.challengeId);
  if (kept && kept.recordedBy.id === recorder.id) return kept;
  throw new ArenaError("already_recorded");
}

/**
 * Wolf Vision heartbeat: a phone set up for this game is tracking it. Only
 * games with a recent heartbeat show "Wolf Vision · live" on the Arena; games
 * without a phone are untouched. Only a player in the game can send one, and
 * a game whose stats are saved is left exactly as it is.
 */
export async function heartbeatTracking(recorder: { id: number }, input: z.infer<typeof heartbeatSchema>): Promise<void> {
  const world = await loadWorld({ skipSync: true });
  const c = world.challenges.find((x) => x.id === input.challengeId);
  if (!c || !c.acceptingPlayers) throw new ArenaError("not_found");
  if (![...c.postingPlayers, ...c.acceptingPlayers].includes(recorder.id)) throw new ArenaError("not_your_game");
  if (!RECORDABLE.has(c.status)) throw new ArenaError("not_recordable");
  const live = { rallies: input.rallies, hits: input.hits, quality: input.quality, ended: input.kind === "end" };
  await sql.query(
    `INSERT INTO ${T.matchStats} (challenge_id, recorded_by, stats, status, live, live_at) VALUES ($1, $2, '{}'::jsonb, 'tracking', $3, NOW())
     ON CONFLICT (challenge_id) DO UPDATE SET live = EXCLUDED.live, live_at = NOW(), updated_at = NOW()
       WHERE ${T.matchStats}.status <> 'final';`,
    [input.challengeId, recorder.id, JSON.stringify(live)],
  );
}
