// Vision (the club's match tracker).
import { z } from "zod";
import { clubParams } from "./clubs.ts";
import { challengeId } from "./arena.ts";

const visionKind = z.enum(["live", "upload"]);
const visionPass = z.object({ id: z.number().int(), kind: visionKind, status: z.enum(["pending", "paid", "used"]), test: z.boolean(), usedAt: z.string().nullable() });
export const visionStatusQuery = z.object({ kind: visionKind.optional() });
export const visionStatusResponse = z.object({
  /** Free for everyone until trialEnds. */
  trial: z.boolean(),
  trialEnds: z.string(),
  /** A pass ready to use for this kind (after the trial). */
  pass: visionPass.nullable(),
  /** Minor units: what a live match and a video cost after the trial. */
  prices: z.object({ live: z.number().int(), upload: z.number().int() }),
  testMode: z.boolean(),
});
const matchPlayer = z.object({ id: z.number().int(), name: z.string(), avatarUrl: z.string().nullable().optional() });
const team = z.object({ name: z.string(), players: z.tuple([matchPlayer, matchPlayer]) });
const statsPlayer = z.object({ playerId: z.number().int(), hits: z.number(), distance: z.number(), topSpeed: z.number() });
const savedStats = z.object({
  mode: visionKind,
  duration: z.number(),
  rallies: z.number().int(),
  longestRally: z.number().int(),
  avgRallyShots: z.number(),
  fastestShotKmh: z.number().nullable(),
  players: z.array(statsPlayer),
  recordedBy: z.object({ id: z.number().int(), name: z.string() }),
  recordedAt: z.string(),
}).passthrough();
export const visionChallengeResponse = z.object({
  setup: z.object({
    challengeId: z.number().int(),
    status: z.string(),
    teams: z.tuple([team, team]),
    score: z.object({ posting: z.number().int().nullable(), accepting: z.number().int().nullable() }).nullable(),
  }),
  /** Stats already saved for this game, if any. */
  stats: savedStats.nullable(),
});
export const visionChallengeParams = clubParams.extend({ id: z.coerce.number().int().positive().max(2147483647) });
export const visionPlayersResponse = z.object({
  players: z.array(z.object({ id: z.number().int(), name: z.string(), avatarUrl: z.string().nullable(), me: z.boolean() })),
});
/** Hits marked by hand on a match video (time and who hit, as the camera sees them: 0 near-left … 3 far-right). */
export const visionLabelsRequest = z.object({
  videoName: z.string().min(1).max(200),
  duration: z.number().min(0).max(4 * 3600),
  hits: z.array(z.object({ t: z.number().min(0), player: z.number().int().min(0).max(3), rally: z.number().int().min(0) })).max(10000),
});
export const visionLabelsResponse = z.object({ ok: z.literal(true), id: z.number().int() });

// The tracker's own calls, as the website's /api/wolf-vision/* and
// /api/arena/match-stats (same bodies, answers and error codes).
export const visionPassQuery = z.object({ kind: visionKind, session_id: z.string().max(300).optional() });
export const visionPassResponse = z.object({
  trial: z.boolean().optional(),
  pass: visionPass.nullable(),
  priceCents: z.number().int().nullable(),
  testMode: z.boolean(),
});
export const visionBuyRequest = z.object({
  kind: visionKind,
  challengeId: z.number().int().positive().nullable().optional(),
  /** Where the checkout comes back to in the app (a path under /vision). */
  returnTo: z.string().max(300).optional(),
});
/** Checkout to pay at (`url`), or a free test pass outside production. */
export const visionBuyResponse = z.object({ url: z.string().url().optional(), pass: visionPass.optional(), testMode: z.boolean().optional() });
export const visionUseRequest = z.object({ passId: z.number().int().positive() });
export const visionUseResponse = z.object({ trial: z.boolean().optional(), pass: visionPass.nullable() });

const trackedPlayer = z.object({
  playerId: z.number().int().positive(),
  hits: z.number().int().min(0).max(5000),
  distance: z.number().min(0).max(50_000),
  topSpeed: z.number().min(0).max(15),
});
export const visionStatsRequest = z.object({
  challengeId: z.number().int().positive(),
  mode: visionKind,
  duration: z.number().min(0).max(4 * 3600),
  rallies: z.number().int().min(0).max(2000),
  longestRally: z.number().int().min(0).max(1000),
  avgRallyShots: z.number().min(0).max(1000),
  fastestShotKmh: z.number().min(0).max(500).nullable(),
  players: z.array(trackedPlayer).length(4),
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
export const visionStatsResponse = z.object({ ok: z.literal(true), stats: savedStats });
/** A tracking phone's heartbeat: the board shows the game as tracked live. */
export const visionBeatRequest = z.object({
  challengeId: z.number().int().positive(),
  kind: z.enum(["start", "beat", "end"]),
  rallies: z.number().int().min(0).max(5000),
  hits: z.number().int().min(0).max(20000),
  quality: z.number().min(0).max(1),
});

const checkerWeights = z.object({
  v: z.literal(1),
  w1: z.array(z.number().finite()),
  b1: z.array(z.number().finite()).length(16),
  w2: z.array(z.number().finite()).length(16),
  b2: z.number().finite(),
  n: z.number().int().min(0),
});
/** The shared hit checker everyone's sessions improve (null: use the bundled one). */
export const visionModelResponse = z.object({
  model: z.object({ weights: checkerWeights, sessions: z.number().int(), createdAt: z.string() }).nullable(),
});
/** A session's fine-tuned checker weights: numbers only, never video. */
export const visionTrainRequest = z.object({
  kind: z.literal("checker"),
  weights: checkerWeights,
  trained: z.number().int().min(0).max(1_000_000),
  meta: z.object({ mode: visionKind, quality: z.number().min(0).max(1), pos: z.number().int().min(0), neg: z.number().int().min(0) }),
});
export const visionTrainResponse = z.object({ ok: z.literal(true), stored: z.boolean(), merged: z.boolean() });

const sharedName = z.string().trim().min(1).max(60);
/** A session that isn't a challenge: its stats, emailed to the players added by email (at most 3). */
export const visionShareRequest = z.object({
  teams: z.tuple([sharedName, sharedName]),
  duration: z.number().min(0).max(4 * 3600),
  rallies: z.number().int().min(0).max(2000),
  longestRally: z.number().int().min(0).max(1000),
  avgRallyShots: z.number().min(0).max(1000),
  fastestShotKmh: z.number().min(0).max(500).nullable(),
  players: z
    .array(
      z.object({
        name: sharedName,
        team: z.union([z.literal(0), z.literal(1)]),
        hits: z.number().int().min(0).max(5000),
        distance: z.number().min(0).max(50_000),
        topSpeed: z.number().min(0).max(15),
        email: z.string().trim().toLowerCase().email().max(200).optional(),
      }),
    )
    .length(4),
});
export const visionShareResponse = z.object({ ok: z.boolean(), sent: z.array(z.string()), failed: z.array(z.string()) });
