// A player's own photos, as the website's /api/profile/photos routes and
// the players' app share them: the upload token (straight to the public
// Blob store, only into the player's own folder, only images, at most 20 a
// day), registering an uploaded photo (SafeSearch, then the Gallery, an
// admin's review or hidden, with the admins emailed), and deleting one.
import { revalidatePath } from "next/cache";
import { issueSignedToken } from "@vercel/blob";
import { handleUpload, handleUploadPresigned, type HandleUploadBody, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { z } from "zod";
import { PHOTOS_PER_DAY, countPhotosToday, deletePlayerPhoto, insertPhoto, setPhotoModeration } from "./photos-db";
import { moderateImage } from "./photo-moderation";
import { sendAdminAlertEmail } from "./player-email";
import { deletePublicBlobs, publicBlobAuth } from "./public-blob";
import { emitToPlayers } from "./webhooks";

type Who = { id: number; email: string; firstName: string; lastName: string };
type Answer = { status: number; json: Record<string, unknown> };

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 25 * 1024 * 1024;
const VALID_MS = 10 * 60 * 1000;

/**
 * Answers the Blob client's upload call, in the flavour the store is set up
 * for (lib/public-blob.ts): a client token signed with the read-write
 * token, or a presigned upload URL.
 */
export async function photoUploadAnswer(request: Request, playerId: number, body: unknown): Promise<Answer> {
  const auth = publicBlobAuth();
  if (!auth) return { status: 503, json: { error: "not_configured" } };
  const guard = async (pathname: string) => {
    if (!pathname.startsWith(`photos/${playerId}/`) || pathname.includes("..")) throw new Error("Wrong folder");
    if ((await countPhotosToday(playerId)) >= PHOTOS_PER_DAY) throw new Error("Daily photo limit reached");
  };
  try {
    if ("token" in auth) {
      const result = await handleUpload({
        token: auth.token,
        request,
        body: body as HandleUploadBody,
        onBeforeGenerateToken: async (pathname) => {
          await guard(pathname);
          return { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true, validUntil: Date.now() + VALID_MS };
        },
      });
      return { status: 200, json: result as unknown as Record<string, unknown> };
    }
    const result = await handleUploadPresigned({
      request,
      body: body as HandleUploadPresignedBody,
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
    return { status: 200, json: result as unknown as Record<string, unknown> };
  } catch (err) {
    return { status: 400, json: { error: (err as Error).message } };
  }
}

const url = z.string().url().max(500);
export const photoRegisterSchema = z.object({
  originalUrl: url,
  displayUrl: url,
  thumbUrl: url,
  width: z.number().int().positive().max(20000).nullable(),
  height: z.number().int().positive().max(20000).nullable(),
  bytes: z.number().int().nonnegative().max(100 * 1024 * 1024),
  caption: z.string().trim().max(140).nullable().optional(),
  consent: z.literal(true),
});

/** Only files in this player's own folder of our public Blob store. */
function ownBlob(raw: string, playerId: number): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com") && u.pathname.startsWith(`/photos/${playerId}/`);
  } catch {
    return false;
  }
}

/** Registers an uploaded photo, runs the SafeSearch check and files it. */
export async function registerPhoto(player: Who, body: z.infer<typeof photoRegisterSchema>): Promise<Answer> {
  if (![body.originalUrl, body.displayUrl, body.thumbUrl].every((u) => ownBlob(u, player.id))) {
    return { status: 400, json: { error: "invalid" } };
  }
  if ((await countPhotosToday(player.id)) >= PHOTOS_PER_DAY) return { status: 429, json: { error: "daily_limit" } };
  const id = await insertPhoto({
    playerId: player.id,
    originalUrl: body.originalUrl,
    displayUrl: body.displayUrl,
    thumbUrl: body.thumbUrl,
    width: body.width,
    height: body.height,
    bytes: body.bytes,
    caption: body.caption || null,
  });
  const result = await moderateImage(body.displayUrl, body.originalUrl);
  await setPhotoModeration(id, result.status, result.safesearch);
  const who = `${player.firstName} ${player.lastName}`.trim() || player.email;
  if (result.status === "rejected") {
    await sendAdminAlertEmail({
      subject: `Photo blocked: uploaded by ${who}`,
      heading: "A photo was blocked by the safety check",
      lines: [
        `${who} (${player.email}) uploaded a photo that Google's SafeSearch rated as inappropriate. It's hidden everywhere and was not shared.`,
        `Ratings: ${Object.entries(result.safesearch ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")}`,
      ],
      cta: { label: "Review in Admin → Photos", path: "/admin/photos?tab=blocked" },
    }).catch((err) => console.error("[photos] alert failed:", err));
  } else if (result.status === "needs_review") {
    await sendAdminAlertEmail({
      subject: `Photo to review from ${who}`,
      heading: "A shared photo is waiting for review",
      lines: [result.reason === "checked" ? "SafeSearch wasn't sure about it, so it's held until an admin approves it." : "The automatic check isn't available right now, so it's held until an admin approves it."],
      cta: { label: "Review in Admin → Photos", path: "/admin/photos" },
    }).catch((err) => console.error("[photos] alert failed:", err));
  } else {
    revalidatePath("/");
    revalidatePath("/gallery");
    await emitToPlayers([player.email], "photo.approved", () => ({ photoId: id, url: body.displayUrl }));
  }
  revalidatePath("/profile/player");
  return { status: 200, json: { ok: true, id, status: result.status } };
}

/** A player deletes their own photo: it leaves the Gallery and the files go. False when it isn't theirs. */
export async function deleteOwnPhoto(playerId: number, id: number): Promise<boolean> {
  const photo = Number.isInteger(id) ? await deletePlayerPhoto(playerId, id) : null;
  if (!photo) return false;
  await deletePublicBlobs([photo.originalUrl, photo.displayUrl, photo.thumbUrl]);
  revalidatePath("/");
  revalidatePath("/gallery");
  return true;
}
