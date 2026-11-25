import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { photoUploadAnswer } from "@/lib/photos-service";
import { publicBlobAuth } from "@/lib/public-blob";

// Lets the browser upload photos straight to the public Blob store (no
// 4.5 MB Vercel request limit). Only a signed-in player, only into their own
// folder, only images, at most 20 a day (lib/photos-service.ts). The photo
// is registered (and checked) by POST /api/profile/photos afterwards.
export async function POST(request: Request) {
  if (!publicBlobAuth()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const r = await photoUploadAnswer(request, player.id, body);
  return NextResponse.json(r.json, { status: r.status });
}
