import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import { MESSAGE_MAX, addPlayerMessage, getThreadForPlayer } from "@/lib/messages-db";
import { notifyAdminsOfPlayerMessage } from "@/lib/message-notify";

const bodySchema = z.object({ body: z.string().trim().min(1).max(MESSAGE_MAX) });

function threadId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const id = threadId((await params).id);
  const thread = id ? await getThreadForPlayer(player.id, id) : null;
  if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ thread }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!checkRateLimit(`msg:${player.id}`, 30, 60 * 60_000)) {
    return NextResponse.json({ error: "too_many" }, { status: 429 });
  }
  const id = threadId((await params).id);
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const message = id ? await addPlayerMessage(player.id, id, body.body) : null;
  if (!message || !id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const thread = await getThreadForPlayer(player.id, id);
  await notifyAdminsOfPlayerMessage({
    threadId: id,
    playerName: `${player.firstName} ${player.lastName}`.trim() || player.email,
    playerEmail: player.email,
    subject: thread?.subject ?? "Message",
    body: body.body,
  });
  return NextResponse.json({ ok: true, message });
}
