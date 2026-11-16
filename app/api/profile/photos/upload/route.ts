import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { PHOTOS_PER_DAY, countPhotosToday } from "@/lib/photos-db";
import { publicBlobToken } from "@/lib/public-blob";

// Issues short-lived tokens so the browser uploads photos straight to the
// public Blob store (no 4.5 MB Vercel request limit). Only a signed-in
// player, only into their own folder, only images, at most 20 a day. The
// photo is registered (and checked) by POST /api/profile/photos afterwards.
export async function POST(request: Request) {
  const token = publicBlobToken();
  if (!token) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      token,
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`photos/${player.id}/`)) throw new Error("Wrong folder");
        if ((await countPhotosToday(player.id)) >= PHOTOS_PER_DAY) throw new Error("Daily photo limit reached");
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
          maximumSizeInBytes: 25 * 1024 * 1024,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
