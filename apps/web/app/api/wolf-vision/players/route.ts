import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { listPlayersForPicker } from "@/lib/repos/players";

// Wolf Vision set-up: the registered players ("wolves") a signed-in player can
// put on court. Display name and picture only, never an email.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ players: [] });
  const me = await getPlayerFromRequest(request);
  if (!me) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const players = await listPlayersForPicker();
  return NextResponse.json(
    { players: players.map((p) => ({ ...p, me: p.id === me.id })) },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
