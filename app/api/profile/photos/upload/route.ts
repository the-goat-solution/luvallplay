import { NextResponse } from "next/server";
import { issueSignedToken } from "@vercel/blob";
import { handleUpload, handleUploadPresigned, type HandleUploadBody, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { PHOTOS_PER_DAY, countPhotosToday } from "@/lib/photos-db";
import { publicBlobAuth } from "@/lib/public-blob";

// Lets the browser upload photos straight to the public Blob store (no
// 4.5 MB Vercel request limit). Only a signed-in player, only into their own
// folder, only images, at most 20 a day. The photo is registered (and
// checked) by POST /api/profile/photos afterwards.
//
// Two flavours, matching how the store is connected (lib/public-blob.ts):
// a client token signed with PHOTO_BLOB_READ_WRITE_TOKEN, or a presigned
// upload URL issued with the deployment's OIDC token and PHOTO_STORE_ID.

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 25 * 1024 * 1024;
const VALID_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  const auth = publicBlobAuth();
  if (!auth) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });

  const guard = async (pathname: string) => {
    if (!pathname.startsWith(`photos/${player.id}/`) || pathname.includes("..")) throw new Error("Wrong folder");
    if ((await countPhotosToday(player.id)) >= PHOTOS_PER_DAY) throw new Error("Daily photo limit reached");
  };

  try {
    if ("token" in auth) {
      const result = await handleUpload({
        token: auth.token,
        request,
        body: (await request.json()) as HandleUploadBody,
        onBeforeGenerateToken: async (pathname) => {
          await guard(pathname);
          return { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true, validUntil: Date.now() + VALID_MS };
        },
      });
      return NextResponse.json(result);
    }

    const result = await handleUploadPresigned({
      request,
      body: (await request.json()) as HandleUploadPresignedBody,
      // Only needed to verify upload-completed callbacks, which we don't ask for.
      webhookPublicKey: process.env.PHOTO_WEBHOOK_PUBLIC_KEY || "unused",
      getSignedToken: async (pathname) => {
        await guard(pathname);
        const token = await issueSignedToken({
          storeId: auth.storeId,
          pathname,
          operations: ["put"],
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          validUntil: Date.now() + VALID_MS,
        });
        return { token, urlOptions: { addRandomSuffix: true } };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
