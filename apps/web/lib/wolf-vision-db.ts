import { sql } from "./database";
import { z } from "zod";
import { averageWeights, N_FEATURES, type CheckerWeights } from "./ma/checker";

// Wolf Vision server data:
//   • passes: the paywall ($2 NZD to analyse an upload, $5 NZD for a live
//     match). One paid pass unlocks one session (resuming that session within
//     6 hours is allowed).
//   • models / updates: auto-training. Every session fine-tunes the AI shuttle
//     checker on the phone and sends back only the weights (never video or
//     images). New shared weights are a sample-weighted average of the current
//     ones and recent session updates, with guards against outliers.
//   • labels: the labelling set (hits marked by hand on a video), for training
//     and measuring the engine.
// Previews use "pv_" tables, like the Arena.

const PREFIX = process.env.ARENA_TABLE_PREFIX ?? (process.env.VERCEL_ENV === "preview" ? "pv_" : "");
export const WV = {
  passes: `${PREFIX}wv_passes`,
  models: `${PREFIX}wv_models`,
  updates: `${PREFIX}wv_updates`,
  labels: `${PREFIX}wv_labels`,
};

export const PASS_PRICE_CENTS = { upload: 200, live: 500 } as const;
export type PassKind = keyof typeof PASS_PRICE_CENTS;
/** A used pass still opens the same session again within this window (resume after a crash). */
const RESUME_HOURS = 6;

// ── Passes ────────────────────────────────────────────────────────────────

export type Pass = { id: number; kind: PassKind; status: "pending" | "paid" | "used"; test: boolean; usedAt: string | null };

function rowToPass(r: Record<string, unknown>): Pass {
  return { id: Number(r.id), kind: r.kind as PassKind, status: r.status as Pass["status"], test: Boolean(r.test), usedAt: r.used_at ? new Date(r.used_at as string).toISOString() : null };
}

export async function createPass(playerId: number, kind: PassKind, opts: { test: boolean; challengeId?: number | null }): Promise<Pass> {
  const { rows } = await sql.query(
    `INSERT INTO ${WV.passes} (player_id, kind, status, amount_cents, test, challenge_id, paid_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;`,
    [playerId, kind, opts.test ? "paid" : "pending", opts.test ? 0 : PASS_PRICE_CENTS[kind], opts.test, opts.challengeId ?? null, opts.test ? new Date().toISOString() : null],
  );
  return rowToPass(rows[0]);
}

export async function attachStripeSession(passId: number, sessionId: string) {
  await sql.query(`UPDATE ${WV.passes} SET stripe_session = $2 WHERE id = $1;`, [passId, sessionId]);
}

/** Marks a pass paid (Stripe confirmed the payment). Idempotent. */
export async function markPassPaid(sessionId: string): Promise<Pass | null> {
  const { rows } = await sql.query(
    `UPDATE ${WV.passes} SET status = CASE WHEN status = 'pending' THEN 'paid' ELSE status END, paid_at = COALESCE(paid_at, NOW()) WHERE stripe_session = $1 RETURNING *;`,
    [sessionId],
  );
  return rows[0] ? rowToPass(rows[0]) : null;
}

/** A pass the player can start a session with: an unused paid one, or one used recently (resume). */
export async function usablePass(playerId: number, kind: PassKind): Promise<Pass | null> {
  const { rows } = await sql.query(
    `SELECT * FROM ${WV.passes} WHERE player_id = $1 AND kind = $2 AND (status = 'paid' OR (status = 'used' AND used_at > NOW() - INTERVAL '${RESUME_HOURS} hours'))
     ORDER BY (status = 'used') DESC, created_at DESC LIMIT 1;`,
    [playerId, kind],
  );
  return rows[0] ? rowToPass(rows[0]) : null;
}

/** Starts a session on a pass (first use stamps it; a resume within the window is allowed). */
export async function consumePass(playerId: number, passId: number): Promise<Pass | null> {
  const { rows } = await sql.query(
    `UPDATE ${WV.passes} SET status = 'used', used_at = COALESCE(used_at, NOW())
     WHERE id = $1 AND player_id = $2 AND (status = 'paid' OR (status = 'used' AND used_at > NOW() - INTERVAL '${RESUME_HOURS} hours')) RETURNING *;`,
    [passId, playerId],
  );
  return rows[0] ? rowToPass(rows[0]) : null;
}

// ── Auto-training ─────────────────────────────────────────────────────────

export const checkerUpdateSchema = z.object({
  kind: z.literal("checker"),
  weights: z.object({
    v: z.literal(1),
    w1: z.array(z.number().finite()).length(16 * N_FEATURES),
    b1: z.array(z.number().finite()).length(16),
    w2: z.array(z.number().finite()).length(16),
    b2: z.number().finite(),
    n: z.number().int().min(0),
  }),
  /** Samples this session trained on. */
  trained: z.number().int().min(0).max(1_000_000),
  meta: z.object({ mode: z.enum(["live", "upload"]), quality: z.number().min(0).max(1), pos: z.number().int().min(0), neg: z.number().int().min(0) }),
});

/** The shared model for a kind, or null (clients then use the weights bundled with the app). */
export async function latestModel(kind: "checker"): Promise<{ weights: CheckerWeights; sessions: number; createdAt: string } | null> {
  const { rows } = await sql.query(`SELECT weights, sessions, created_at FROM ${WV.models} WHERE kind = $1 ORDER BY id DESC LIMIT 1;`, [kind]);
  return rows[0] ? { weights: rows[0].weights as CheckerWeights, sessions: Number(rows[0].sessions), createdAt: new Date(rows[0].created_at).toISOString() } : null;
}

/** Below this many trained samples a session update is not worth merging. */
const MIN_SESSION_SAMPLES = 200;
/** One session never counts for more than this many samples (no single phone steers the shared model). */
const MAX_SESSION_WEIGHT = 3000;
/** Merge once this many updates are waiting. */
const MERGE_EVERY = 3;

function distance(a: CheckerWeights, b: CheckerWeights): number {
  let d = 0, n = 0;
  for (let i = 0; i < a.w1.length; i++) {
    d += (a.w1[i] - b.w1[i]) ** 2;
    n += b.w1[i] ** 2;
  }
  return Math.sqrt(d / Math.max(1e-9, n));
}

/**
 * Stores a session's fine-tuned weights and, every few sessions, folds the
 * waiting ones into new shared weights (federated averaging): base weighted
 * by its sample count, each session by its own (capped). Updates that moved
 * implausibly far from the shared model (relative change over 50 %) are
 * kept for inspection but not merged.
 */
export async function submitCheckerUpdate(playerId: number | null, base: CheckerWeights, u: z.infer<typeof checkerUpdateSchema>): Promise<{ stored: boolean; merged: boolean }> {
  if (u.trained < MIN_SESSION_SAMPLES) return { stored: false, merged: false };
  const outlier = distance(u.weights, base) > 0.5;
  await sql.query(`INSERT INTO ${WV.updates} (kind, weights, n, player_id, meta, merged) VALUES ('checker', $1, $2, $3, $4, $5);`, [
    JSON.stringify(u.weights),
    Math.min(MAX_SESSION_WEIGHT, u.trained),
    playerId,
    JSON.stringify({ ...u.meta, outlier }),
    outlier, // outliers are marked merged so they never enter an average
  ]);
  const { rows } = await sql.query(`SELECT id, weights, n FROM ${WV.updates} WHERE kind = 'checker' AND merged = FALSE ORDER BY id;`);
  if (rows.length < MERGE_EVERY) return { stored: true, merged: false };
  const current = (await latestModel("checker"))?.weights ?? base;
  const sets: CheckerWeights[] = [current, ...rows.map((r) => ({ ...(r.weights as CheckerWeights), n: Number(r.n) }))];
  const merged = averageWeights(sets);
  if (!merged) return { stored: true, merged: false };
  const prevSessions = (await sql.query(`SELECT sessions FROM ${WV.models} WHERE kind = 'checker' ORDER BY id DESC LIMIT 1;`)).rows[0]?.sessions ?? 0;
  await sql.query(`INSERT INTO ${WV.models} (kind, weights, n, sessions) VALUES ('checker', $1, $2, $3);`, [JSON.stringify(merged), merged.n, Number(prevSessions) + rows.length]);
  await sql.query(`UPDATE ${WV.updates} SET merged = TRUE WHERE id = ANY($1::int[]);`, [rows.map((r) => Number(r.id))]);
  return { stored: true, merged: true };
}

// ── Labelling set ─────────────────────────────────────────────────────────

export const labelSchema = z.object({
  videoName: z.string().min(1).max(200),
  duration: z.number().min(0).max(4 * 3600),
  hits: z.array(z.object({ t: z.number().min(0), player: z.number().int().min(0).max(3), rally: z.number().int().min(0) })).max(10000),
});

export async function saveLabels(playerId: number, l: z.infer<typeof labelSchema>): Promise<number> {
  const { rows } = await sql.query(`INSERT INTO ${WV.labels} (player_id, video_name, duration, hits) VALUES ($1, $2, $3, $4) RETURNING id;`, [
    playerId,
    l.videoName,
    l.duration,
    JSON.stringify(l.hits),
  ]);
  return Number(rows[0].id);
}
