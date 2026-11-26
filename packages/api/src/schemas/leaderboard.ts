// The Leaderboard (the website's points board and player cards).
import { z } from "zod";
import { clubParams } from "./clubs.ts";
import { seat } from "./arena.ts";

export const BOARD_SOURCES = ["all", "challenges", "play", "rr"] as const;
export const BOARD_PERIODS = ["month", "quarter", "year", "lifetime"] as const;
export const boardQuery = z.object({
  source: z.enum(BOARD_SOURCES).optional(),
  period: z.enum(BOARD_PERIODS).optional(),
  /** A past period ("2026-10", "2026-Q3", "2025"); the current one when left out. */
  key: z.string().max(20).optional(),
});
export const boardRowSchema = z.object({
  rank: z.number().int(),
  playerId: z.number().int(),
  name: z.string(),
  initials: z.string(),
  avatarUrl: z.string().nullable(),
  /** Points from the chosen source(s) in the period. */
  value: z.number(),
  play: z.number(),
  rr: z.number(),
  challenges: z.number(),
  /** Ladder position (from all-time points). */
  index: z.number().int(),
  seat: z.enum(["alpha", "silver"]).nullable(),
  tarnishing: z.boolean(),
});
export const boardResponse = z.object({
  source: z.enum(BOARD_SOURCES),
  period: z.enum(BOARD_PERIODS),
  range: z.object({ period: z.enum(BOARD_PERIODS), key: z.string(), start: z.string().nullable(), end: z.string().nullable() }),
  prevKey: z.string().nullable(),
  nextKey: z.string().nullable(),
  isCurrent: z.boolean(),
  /** Up to 200 rows; people who hide from the leaderboard are left out. */
  rows: z.array(boardRowSchema),
  me: z.object({
    id: z.number().int(),
    visible: z.boolean(),
    /** Your own rank when you hide from the board (only you see it). */
    hiddenRank: z.number().int().nullable(),
    ladder: z.object({ index: z.number().int(), wpTotal: z.number() }).nullable(),
  }),
});
export const playerParams = clubParams.extend({ id: z.coerce.number().int().positive().max(2147483647) });
export const playerCardResponse = z.object({
  card: z.object({
    id: z.number().int(),
    name: z.string(),
    initials: z.string(),
    avatarUrl: z.string().nullable(),
    rankIndex: z.number().int(),
    seat: z.enum(["alpha", "silver"]).nullable(),
    tarnishing: z.boolean(),
    wpTotal: z.number(),
    wp90: z.number(),
    /** Last five challenge results, newest first. */
    form: z.array(z.enum(["W", "L"])),
    isMe: z.boolean(),
    /** Their pair's open challenge: "Challenge" accepts it. */
    openChallengeId: z.number().int().nullable(),
    partner: z.boolean(),
  }),
});
