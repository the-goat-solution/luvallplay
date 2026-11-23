import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { loadWorldCached } from "@/lib/arena-db";
import { playerCardFor } from "@/lib/player-card";

// One player's card for the Arena's Leaderboard. Signed-in players only;
// players who hide from the leaderboard are not found (except by themselves).

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: "no_database" }, { status: 503 });
  const viewer = await getPlayerFromRequest(request);
  if (!viewer) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const card = playerCardFor(await loadWorldCached(5000), id, viewer.id);
  if (!card) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ card }, { headers: { "Cache-Control": "no-store" } });
}
