import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { markStatsSeen } from "@/lib/wolf-vision-db";

// The player has seen their new Wolf Vision stats (Player tab): clears the "New" badges.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ ok: true });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  await markStatsSeen(player.id).catch((err) => console.error("[wolf-vision] seen", err));
  return NextResponse.json({ ok: true });
}
