import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { photoRegisterSchema, registerPhoto } from "@/lib/photos-service";

// Registers an uploaded photo, runs the SafeSearch check and files it:
// approved → Gallery; doubtful → waits for an admin; inappropriate →
// hidden everywhere and the admins are emailed (lib/photos-service.ts,
// shared with the players' app).
export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const parsed = photoRegisterSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const r = await registerPhoto(player, parsed.data);
  return NextResponse.json(r.json, { status: r.status });
}
