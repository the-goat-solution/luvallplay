import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { deleteOwnPhoto } from "@/lib/photos-service";

// A player deletes their own photo: it leaves the Gallery and the files go.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!(await deleteOwnPhoto(player.id, Number((await params).id)))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
