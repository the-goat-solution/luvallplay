import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { deletePlayerPhoto } from "@/lib/photos-db";
import { deletePublicBlobs } from "@/lib/public-blob";

// A player deletes their own photo: it leaves the Gallery and the files go.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const id = Number((await params).id);
  const photo = Number.isInteger(id) ? await deletePlayerPhoto(player.id, id) : null;
  if (!photo) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await deletePublicBlobs([photo.originalUrl, photo.displayUrl, photo.thumbUrl]);
  revalidatePath("/");
  revalidatePath("/gallery");
  return NextResponse.json({ ok: true });
}
