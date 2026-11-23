import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { cancelOrder } from "@/lib/shop-db";

// A player cancels their own cash reservation (or abandons a card checkout).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !(await cancelOrder(id, player.id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
