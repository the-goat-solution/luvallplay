import { sql } from "@vercel/postgres";
import {
  TEAM_LOCK_DAYS,
  buildSchedule,
  isValidScore,
  type Match,
  type MiniGameState,
  type Score,
  type Team,
} from "./mini-game";
import { PLAYER_NAMES, drawTeams } from "./mini-game-roster";

// Same memoised, idempotent DDL approach as ensureTables() in lib/db.ts.
let ensurePromise: Promise<void> | null = null;

export function ensureMiniGameTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = ensureImpl().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function ensureImpl() {
  await sql`
    CREATE TABLE IF NOT EXISTS mini_game_draws (
      id SERIAL PRIMARY KEY,
      teams JSONB NOT NULL,
      matches JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_until TIMESTAMPTZ NOT NULL,
      archived_at TIMESTAMPTZ
    );
  `;
  // At most one live draw at a time, so two people pressing "Draw" at once
  // can't both win: the second insert hits this index and gets the first draw.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mini_game_draws_one_active
      ON mini_game_draws ((true)) WHERE archived_at IS NULL;
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS mini_game_scores (
      draw_id INT NOT NULL REFERENCES mini_game_draws(id),
      match_id TEXT NOT NULL,
      score_a INT NOT NULL,
      score_b INT NOT NULL,
      locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (draw_id, match_id)
    );
  `;
}

type DrawRow = {
  id: number;
  teams: Team[];
  matches: Match[];
  created_at: Date;
  locked_until: Date;
};

async function activeDraw(): Promise<DrawRow | null> {
  const { rows } = await sql<DrawRow>`
    SELECT id, teams, matches, created_at, locked_until
    FROM mini_game_draws
    WHERE archived_at IS NULL
    LIMIT 1;
  `;
  return rows[0] ?? null;
}

export async function getMiniGameState(): Promise<MiniGameState> {
  const draw = await activeDraw();
  if (!draw) return { players: PLAYER_NAMES, draw: null };

  const { rows } = await sql<{ match_id: string; score_a: number; score_b: number }>`
    SELECT match_id, score_a, score_b FROM mini_game_scores WHERE draw_id = ${draw.id};
  `;
  const scores: Record<string, Score> = {};
  for (const r of rows) scores[r.match_id] = { a: r.score_a, b: r.score_b };

  return {
    players: PLAYER_NAMES,
    draw: {
      id: draw.id,
      teams: draw.teams,
      matches: draw.matches,
      scores,
      createdAt: new Date(draw.created_at).toISOString(),
      lockedUntil: new Date(draw.locked_until).toISOString(),
    },
  };
}

/** Draws teams unless a live draw already exists (then it is left alone). */
export async function createDraw(): Promise<void> {
  const teams = drawTeams();
  const matches = buildSchedule(teams);
  try {
    await sql`
      INSERT INTO mini_game_draws (teams, matches, locked_until)
      VALUES (
        ${JSON.stringify(teams)}::jsonb,
        ${JSON.stringify(matches)}::jsonb,
        NOW() + make_interval(days => ${TEAM_LOCK_DAYS})
      );
    `;
  } catch (err) {
    if ((err as { code?: string }).code !== "23505") throw err;
  }
}

export type LockScoreResult = "ok" | "already-locked" | "stale-draw" | "invalid";

/** Records a final score. Once stored it can never be changed. */
export async function lockScore(
  drawId: number,
  matchId: string,
  a: number,
  b: number,
): Promise<LockScoreResult> {
  if (!isValidScore(a, b)) return "invalid";
  const draw = await activeDraw();
  if (!draw || draw.id !== drawId) return "stale-draw";
  if (!draw.matches.some((m) => m.id === matchId)) return "invalid";

  const { rows } = await sql`
    INSERT INTO mini_game_scores (draw_id, match_id, score_a, score_b)
    VALUES (${drawId}, ${matchId}, ${a}, ${b})
    ON CONFLICT (draw_id, match_id) DO NOTHING
    RETURNING match_id;
  `;
  return rows.length ? "ok" : "already-locked";
}

/** Retires the live draw, but only once its one-week team lock has run out. */
export async function resetDraw(): Promise<boolean> {
  const { rows } = await sql`
    UPDATE mini_game_draws
    SET archived_at = NOW()
    WHERE archived_at IS NULL AND locked_until <= NOW()
    RETURNING id;
  `;
  return rows.length > 0;
}
