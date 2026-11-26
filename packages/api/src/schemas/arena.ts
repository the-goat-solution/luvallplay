// The Arena (the website's /api/arena snapshot and actions).
import { z } from "zod";

export const seat = z.enum(["alpha", "silver"]);
export const playerChipSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  initials: z.string(),
  rank: z.number().int(),
  seat: seat.nullable(),
  tarnishing: z.boolean(),
});
export const pairViewSchema = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  players: z.tuple([playerChipSchema, playerChipSchema]),
  avgRank: z.number(),
});
export const CHALLENGE_STATUSES = ["open", "accepted", "live", "awaiting", "completed", "disputed", "void", "expired", "cancelled", "lapsed"] as const;
const side = z.enum(["posting", "accepting"]);
export const challengeViewSchema = z.object({
  id: z.number().int(),
  status: z.enum(CHALLENGE_STATUSES),
  posting: pairViewSchema,
  accepting: pairViewSchema.nullable(),
  note: z.string().nullable(),
  availableUntil: z.string(),
  postedAt: z.string(),
  acceptedAt: z.string().nullable(),
  checkedInAt: z.string().nullable(),
  scorePosting: z.number().int().nullable(),
  scoreAccepting: z.number().int().nullable(),
  retiredBy: side.nullable(),
  enteredByMySide: z.boolean().nullable(),
  mySide: side.nullable(),
  /** Why this viewer can't accept (a code), or null. */
  blocker: z.string().nullable(),
  h2h: z.object({ won: z.number().int(), lost: z.number().int() }).nullable(),
  offer: z.object({ giantKiller: z.boolean(), newRival: z.boolean(), crown: z.boolean() }).nullable(),
  crownMatch: z.boolean(),
  hasStats: z.boolean(),
  tracking: z.object({ rallies: z.number(), hits: z.number(), quality: z.number() }).nullable(),
});
export const feedItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("result"), id: z.number().int(), at: z.string(), winners: pairViewSchema, losers: pairViewSchema,
    scoreW: z.number().int().nullable(), scoreL: z.number().int().nullable(), retired: z.boolean(), stickers: z.array(z.string()), hasStats: z.boolean(),
  }),
  z.object({ kind: z.literal("rankup"), at: z.string(), player: playerChipSchema, rank: z.number().int() }),
]);
export const playerRankSchema = z.object({
  wpTotal: z.number(), wpPlayDays: z.number(), wpRoundRobin: z.number(), wpChallenges: z.number(), wpBonuses: z.number(),
  wp90: z.number(), wp60: z.number(), earned: z.number(), shown: z.number(),
  tarnishing: z.boolean(), daysToSlip: z.number().nullable(), progress: z.number(), seat: seat.nullable(),
});
export const afterGameSchema = z.object({
  challengeId: z.number().int(), won: z.boolean(), total: z.number(), base: z.number(),
  giantKiller: z.number(), newRival: z.number(), hotStreak: z.number(), crownBounty: z.number(),
  scoreFor: z.number().int().nullable(), scoreAgainst: z.number().int().nullable(), retired: z.boolean(),
  opponents: pairViewSchema, partner: playerChipSchema,
});
export const arenaMeSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  initials: z.string(),
  rank: playerRankSchema,
  rankUp: z.object({ from: z.number().int(), to: z.number().int() }).nullable(),
  pair: pairViewSchema.extend({ record: z.object({ won: z.number().int(), lost: z.number().int(), streak: z.number().int() }) }).nullable(),
  incomingRequest: playerChipSchema.nullable(),
  outgoingRequest: playerChipSchema.nullable(),
  /** Achievement key → when it was earned. */
  achievements: z.record(z.string()),
  after: z.array(afterGameSchema),
});
export const arenaStateSchema = z.object({
  now: z.string(),
  signedIn: z.boolean(),
  sandbox: z.boolean(),
  minGameMinutes: z.number(),
  me: arenaMeSchema.nullable(),
  counts: z.object({ up: z.number().int(), live: z.number().int(), week: z.number().int() }),
  crown: z.object({ pair: pairViewSchema, since: z.string(), defences: z.number().int() }).nullable(),
  packLeader: z.object({ player: playerChipSchema, games: z.number().int() }).nullable(),
  champion: z.object({ player: playerChipSchema, wp: z.number(), key: z.string() }).nullable(),
  hot: z.object({ player: playerChipSchema, streak: z.number().int() }).nullable(),
  live: z.array(challengeViewSchema),
  open: z.array(challengeViewSchema),
  mine: z.array(challengeViewSchema),
  feed: z.array(feedItemSchema),
});
export const challengeId = z.number().int().positive().max(2147483647);
/** One Arena action, as the website's POST /api/arena. */
export const arenaActionRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pair_code") }),
  z.object({ action: z.literal("pair_enter"), code: z.string().max(12) }),
  z.object({ action: z.literal("pair_invite") }),
  z.object({ action: z.literal("pair_join"), code: z.string().max(20) }),
  z.object({ action: z.literal("checkin_now"), id: challengeId }),
  z.object({ action: z.literal("pair_respond"), accept: z.boolean() }),
  z.object({ action: z.literal("pair_cancel") }),
  z.object({ action: z.literal("pair_leave") }),
  z.object({ action: z.literal("pair_rename"), name: z.string().max(60) }),
  z.object({ action: z.literal("post"), days: z.number().int().min(0).max(7), note: z.string().max(200).default("") }),
  z.object({ action: z.literal("cancel"), id: challengeId }),
  z.object({ action: z.literal("accept"), id: challengeId }),
  z.object({ action: z.literal("call_off"), id: challengeId }),
  z.object({ action: z.literal("score"), id: challengeId, posting: z.number().int().min(0).max(30), accepting: z.number().int().min(0).max(30) }),
  z.object({ action: z.literal("retired"), id: challengeId, retiredBy: side }),
  z.object({ action: z.literal("confirm"), id: challengeId }),
  z.object({ action: z.literal("dispute"), id: challengeId, note: z.string().max(400).default("") }),
  z.object({ action: z.literal("after"), id: challengeId, keep: z.boolean(), again: z.boolean() }),
  z.object({ action: z.literal("rank_seen") }),
]);
export const arenaActionResponse = z.object({
  ok: z.literal(true),
  /** A pair code or invite to show, when the action made one. */
  code: z.object({ code: z.string(), expiresAt: z.string() }).nullable(),
  state: arenaStateSchema,
});
