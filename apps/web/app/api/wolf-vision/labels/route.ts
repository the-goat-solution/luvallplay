import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import { labelSchema, saveLabels } from "@/lib/wolf-vision-db";

// Wolf Vision labelling set: hits marked by hand on a match video (time and
// hitter only), for training and measuring the engine.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: "no_database" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!checkRateLimit(`wv-labels:${player.id}`, 20, 3_600_000)) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const parsed = labelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const id = await saveLabels(player.id, parsed.data);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[wolf-vision] labels save failed", err);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
