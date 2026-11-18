import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import {
  WolfVisionError,
  beat,
  confirmPaid,
  failureSchema,
  finishSchema,
  finishSession,
  reportFailure,
  startSchema,
  startSession,
} from "@/lib/wolf-vision-db";

// Wolf Vision sessions (see lib/wolf-vision-db.ts). One POST endpoint, by action:
//   start   → { sessionId, status: "active" } or a card payment to make first
//   confirm → the card payment went through: the session can start
//   beat    → a live session is still running (every 15 s)
//   fail    → a technical failure (camera, AI model, engine, tracking): a paid session is refunded
//   finish  → the final stats: stored, and each registered player gets their copy

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  startSchema.extend({ action: z.literal("start") }),
  z.object({ action: z.literal("confirm"), sessionId: z.number().int().positive() }),
  z.object({ action: z.literal("beat"), sessionId: z.number().int().positive(), quality: z.number().min(0).max(1) }),
  failureSchema.extend({ action: z.literal("fail") }),
  finishSchema.extend({ action: z.literal("finish") }),
]);

export async function POST(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: "no_database" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!checkRateLimit(`wolf-vision:${player.id}`, 40, 60_000)) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;
  try {
    switch (b.action) {
      case "start":
        return NextResponse.json(await startSession(player, b));
      case "confirm":
        await confirmPaid(player.id, b.sessionId);
        return NextResponse.json({ ok: true });
      case "beat":
        await beat(player.id, b.sessionId, b.quality);
        return NextResponse.json({ ok: true });
      case "fail":
        return NextResponse.json(await reportFailure(player.id, b.sessionId, b.reason, b.detail));
      case "finish":
        return NextResponse.json(await finishSession(player, b));
    }
  } catch (err) {
    if (err instanceof WolfVisionError) return NextResponse.json({ error: err.code }, { status: err.code === "not_found" ? 404 : 409 });
    console.error("[wolf-vision]", b.action, err);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
