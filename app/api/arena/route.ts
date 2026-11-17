import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import {
  ArenaError,
  acceptChallenge,
  answerAfterGame,
  callOffChallenge,
  cancelChallenge,
  cancelPairRequest,
  checkIn,
  checkinCode,
  confirmScore,
  createPairCode,
  disputeScore,
  enterPairCode,
  enterScore,
  leavePair,
  markRankSeen,
  postChallenge,
  renamePair,
  respondPairRequest,
} from "@/lib/arena-db";
import { buildArenaState } from "@/lib/arena-state";

// The Arena: GET is the board snapshot the page polls; POST runs one action
// for the signed-in player and returns the fresh snapshot (plus a code when
// the action shows one).

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: "no_database" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  const state = await buildArenaState(player ? { id: player.id } : null);
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}

const id = z.number().int().positive();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pair_code") }),
  z.object({ action: z.literal("pair_enter"), code: z.string().max(12) }),
  z.object({ action: z.literal("pair_respond"), accept: z.boolean() }),
  z.object({ action: z.literal("pair_cancel") }),
  z.object({ action: z.literal("pair_leave") }),
  z.object({ action: z.literal("pair_rename"), name: z.string().max(60) }),
  z.object({ action: z.literal("post"), days: z.number().int().min(0).max(7), note: z.string().max(200).default("") }),
  z.object({ action: z.literal("cancel"), id }),
  z.object({ action: z.literal("accept"), id }),
  z.object({ action: z.literal("call_off"), id }),
  z.object({ action: z.literal("checkin_code"), id }),
  z.object({ action: z.literal("checkin"), id, code: z.string().max(12) }),
  z.object({ action: z.literal("score"), id, posting: z.number().int().min(0).max(30), accepting: z.number().int().min(0).max(30) }),
  z.object({ action: z.literal("retired"), id, retiredBy: z.enum(["posting", "accepting"]) }),
  z.object({ action: z.literal("confirm"), id }),
  z.object({ action: z.literal("dispute"), id, note: z.string().max(400).default("") }),
  z.object({ action: z.literal("after"), id, keep: z.boolean(), again: z.boolean() }),
  z.object({ action: z.literal("rank_seen") }),
]);

export async function POST(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: "no_database" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!checkRateLimit(`arena:${player.id}`, 60, 60_000)) return NextResponse.json({ error: "too_many" }, { status: 429 });
  let body: z.infer<typeof actionSchema>;
  try {
    body = actionSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  let code: { code: string; expiresAt: string } | null = null;
  try {
    switch (body.action) {
      case "pair_code":
        code = await createPairCode(player.id);
        break;
      case "pair_enter":
        await enterPairCode(player.id, body.code);
        break;
      case "pair_respond":
        await respondPairRequest(player.id, body.accept);
        break;
      case "pair_cancel":
        await cancelPairRequest(player.id);
        break;
      case "pair_leave":
        await leavePair(player.id);
        break;
      case "pair_rename":
        await renamePair(player.id, body.name);
        break;
      case "post":
        await postChallenge(player.id, body.days, body.note);
        break;
      case "cancel":
        await cancelChallenge(player.id, body.id);
        break;
      case "accept":
        await acceptChallenge(player.id, body.id);
        break;
      case "call_off":
        await callOffChallenge(player.id, body.id);
        break;
      case "checkin_code":
        code = await checkinCode(player.id, body.id);
        break;
      case "checkin":
        await checkIn(player.id, body.id, body.code);
        break;
      case "score":
        await enterScore(player.id, body.id, { posting: body.posting, accepting: body.accepting });
        break;
      case "retired":
        await enterScore(player.id, body.id, { retiredBy: body.retiredBy });
        break;
      case "confirm":
        await confirmScore(player.id, body.id);
        break;
      case "dispute":
        await disputeScore(player.id, body.id, body.note);
        break;
      case "after":
        await answerAfterGame(player.id, body.id, body.keep, body.again);
        break;
      case "rank_seen":
        await markRankSeen(player.id);
        break;
    }
  } catch (err) {
    if (err instanceof ArenaError) {
      const state = await buildArenaState({ id: player.id });
      return NextResponse.json({ error: err.code, state }, { status: 409 });
    }
    console.error("[arena] action failed:", body.action, err);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
  const state = await buildArenaState({ id: player.id });
  return NextResponse.json({ ok: true, code, state }, { headers: { "Cache-Control": "no-store" } });
}
