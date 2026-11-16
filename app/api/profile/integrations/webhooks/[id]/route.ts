import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { deleteWebhookEndpoint } from "@/lib/webhooks";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  await deleteWebhookEndpoint(player.id, Number((await params).id) || 0);
  return NextResponse.json({ ok: true });
}
