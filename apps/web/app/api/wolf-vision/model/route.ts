import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import { SHUTTLE_CHECKER } from "@luvallplay/vision/checker-model";
import { checkerUpdateSchema, latestModel, submitCheckerUpdate } from "@/lib/wolf-vision-db";

// Wolf Vision auto-training. GET: the current shared weights of the AI shuttle
// checker (null = use the ones bundled with the app). POST: a session's
// fine-tuned weights (numbers only: no video, no images), folded into the
// shared model every few sessions.

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ model: null });
  try {
    const m = await latestModel("checker");
    return NextResponse.json({ model: m }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (err) {
    console.error("[wolf-vision] model load failed", err);
    return NextResponse.json({ model: null });
  }
}

export async function POST(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: "no_database" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!checkRateLimit(`wv-train:${player.id}`, 6, 3_600_000)) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const parsed = checkerUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!SHUTTLE_CHECKER) return NextResponse.json({ error: "no_base_model" }, { status: 409 });
  try {
    const base = (await latestModel("checker"))?.weights ?? SHUTTLE_CHECKER;
    const r = await submitCheckerUpdate(player.id, base, parsed.data);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("[wolf-vision] update failed", err);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
