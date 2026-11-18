import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import { ArenaError, invalidateWorld } from "@/lib/arena-db";
import { loadMatchSetup, saveMatchStats, saveStatsSchema } from "@/lib/match-stats-db";

// Match Analyzer ↔ Arena. GET ?challenge=ID: the four players (for tagging)
// and any stats already saved. POST: save the totals for that challenge.
// Both need a signed-in player; the court assistant does not have to be one
// of the four.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: "no_database" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("challenge"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const data = await loadMatchSetup(id);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ArenaError) return NextResponse.json({ error: err.code }, { status: 404 });
    console.error("[match-stats] load failed:", err);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: "no_database" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!checkRateLimit(`match-stats:${player.id}`, 20, 60_000)) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const parsed = saveStatsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const stats = await saveMatchStats({ id: player.id }, parsed.data);
    invalidateWorld();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    if (err instanceof ArenaError) return NextResponse.json({ error: err.code }, { status: 409 });
    console.error("[match-stats] save failed:", err);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
