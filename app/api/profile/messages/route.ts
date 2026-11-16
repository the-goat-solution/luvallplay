import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import { MESSAGE_MAX, SUBJECT_MAX, createThread, listThreadsForPlayer } from "@/lib/messages-db";
import { notifyAdminsOfPlayerMessage } from "@/lib/message-notify";

const bodySchema = z.object({
  subject: z.string().trim().min(1).max(SUBJECT_MAX),
  body: z.string().trim().min(1).max(MESSAGE_MAX),
});

export async function GET(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  return NextResponse.json({ threads: await listThreadsForPlayer(player.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!checkRateLimit(`msg-new:${player.id}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: "too_many" }, { status: 429 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const id = await createThread({ playerId: player.id, subject: body.subject, body: body.body, startedBy: "player" });
  await notifyAdminsOfPlayerMessage({
    threadId: id,
    playerName: `${player.firstName} ${player.lastName}`.trim() || player.email,
    playerEmail: player.email,
    subject: body.subject,
    body: body.body,
  });
  return NextResponse.json({ ok: true, id });
}
