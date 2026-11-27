// A player's own photos, as the website's /api/profile/photos routes and
// the players' app share them: the upload token (straight to the public
// Blob store, only into the player's own folder, only images, at most 20 a
// day), registering an uploaded photo (SafeSearch, then the Gallery, an
// admin's review or hidden, with the admins emailed), and deleting one.
//
// These are the Gallery's photos. Photos for Social posts and Marketplace
// listings (lib/social/photos.ts) use the same upload answer and the same
// own-folder check with their own folder and their own daily count, and are
// never registered here.
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

/** The store's top folder for Gallery photos: photos/<player id>/… */
export const GALLERY_FOLDER = "photos";
const FOLDER = /^[a-z][a-z0-9-]*$/;

/**
 * Where an upload may go and whether it may go at all. `folder` is a top
 * folder of the store, a plain name from the code. `refuse` answers the
 * reason to say no (a daily limit), or null.
 */
export type UploadRules = { folder: string; refuse: () => Promise<string | null> };

/**
 * Answers the Blob client's upload call, in the flavour the store is set up
 * for (lib/public-blob.ts): a client token signed with the read-write
 * token, or a presigned upload URL. Without `rules` it is a Gallery upload:
 * the player's own photos/ folder, at most 20 a day.
 */
export async function photoUploadAnswer(request: Request, playerId: number, body: unknown, rules?: UploadRules): Promise<Answer> {
  const auth = publicBlobAuth();
  if (!auth) return { status: 503, json: { error: "not_configured" } };
  const folder = rules?.folder ?? GALLERY_FOLDER;
  if (!FOLDER.test(folder)) throw new Error(`photoUploadAnswer: "${folder}" is not a folder name.`);
  const refuse = rules?.refuse ?? (async () => ((await countPhotosToday(playerId)) >= PHOTOS_PER_DAY ? "Daily photo limit reached" : null));
  const guard = async (pathname: string) => {
    if (!pathname.startsWith(`${folder}/${playerId}/`) || pathname.includes("..")) throw new Error("Wrong folder");
    const no = await refuse();
    if (no) throw new Error(no);
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

/**
 * The host our own public Blob store serves files from
 * (<store id>.public.blob.vercel-storage.com), from the store's token or its
 * id, as the Blob library itself builds it. Null when no store is connected
 * or the id can't be read: a caller that pins to it then accepts nothing.
 */
export function ownStoreHost(): string | null {
  const auth = publicBlobAuth();
  if (!auth) return null;
  // The read-write token is vercel_blob_rw_<store id>_<secret>; a connected store's id is store_<store id>.
  const storeId = "token" in auth ? (auth.token.split("_")[3] ?? "") : auth.storeId.replace(/^store_/, "");
  return /^[A-Za-z0-9]+$/.test(storeId) ? `${storeId.toLowerCase()}.public.blob.vercel-storage.com` : null;
}

/**
 * Only files in this player's own folder of a public Blob store (the
 * Gallery's folder unless another is named).
 *
 * Without `pin` any Vercel public store's host passes, which is how the
 * Gallery has always checked it: a file in somebody else's store, under the
 * same folder name, is accepted, and its owner could change it after the
 * image check. With `pin` the host must be exactly `pin.host` (ownStoreHost());
 * a null host accepts nothing. Photos for posts and listings pin. The
 * Gallery's own check is left as it was for lane H to tighten, once the
 * derived host has been compared with the live store's real URLs.
 */
export function ownBlob(raw: string, playerId: number, folder: string = GALLERY_FOLDER, pin?: { host: string | null }): boolean {
  if (!FOLDER.test(folder) || !Number.isSafeInteger(playerId) || playerId < 1) return false;
  if (pin && !pin.host) return false;
  try {
    const u = new URL(raw);
    const host = pin ? u.hostname === pin.host && !u.port && !u.username && !u.password : u.hostname.endsWith(".public.blob.vercel-storage.com");
    return u.protocol === "https:" && host && u.pathname.startsWith(`/${folder}/${playerId}/`) && !u.pathname.includes("..");
  } catch {
    return false;
  }
}

/**
 * Registers an uploaded Gallery photo, runs the SafeSearch check and files
 * it. Only Gallery photos come through here (insertPhoto stores no other
 * purpose), so the Gallery pages are the ones to refresh; a photo for a post
 * or a listing is registered by lib/social/photos.ts and refreshes none.
 */
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

/** A player deletes their own Gallery photo: it leaves the Gallery and the files go. False when it isn't theirs, or isn't a Gallery photo. */
export async function deleteOwnPhoto(playerId: number, id: number): Promise<boolean> {
  const photo = Number.isInteger(id) ? await deletePlayerPhoto(playerId, id) : null;
  if (!photo) return false;
  await deletePublicBlobs([photo.originalUrl, photo.displayUrl, photo.thumbUrl]);
  revalidatePath("/");
  revalidatePath("/gallery");
  return true;
}
