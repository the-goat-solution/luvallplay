import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { setPlayerAvatar } from "@/lib/player-db";
import { deletePublicBlobs } from "@/lib/public-blob";
import { publicStorage } from "@/lib/storage";
import { countUpload } from "@/lib/usage-hooks";
import { checkRateLimit } from "@/lib/security";
import { revalidateTag } from "next/cache";

// Profile picture. The browser crops and shrinks the photo to a 512 px square
// JPEG/WebP first (well under the 4.5 MB request limit), so the server only
// stores it in the public Blob store and swaps the URL. DELETE removes it.

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" };

export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!publicStorage().configured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (!checkRateLimit(`avatar:${player.id}`, 10, 60 * 60_000)) return NextResponse.json({ error: "too_many" }, { status: 429 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });

  const blob = await publicStorage().put(`avatars/${player.id}/avatar.${ext}`, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  await countUpload(file.size);
  const old = await setPlayerAvatar(player.id, blob.url);
  await deletePublicBlobs([old]);
  refresh();
  return NextResponse.json({ ok: true, url: blob.url });
}

export async function DELETE(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const old = await setPlayerAvatar(player.id, null);
  await deletePublicBlobs([old]);
  refresh();
  return NextResponse.json({ ok: true });
}

function refresh() {
  try {
    revalidateTag("leaderboard", { expire: 0 });
  } catch {
    // outside a request
  }
}
