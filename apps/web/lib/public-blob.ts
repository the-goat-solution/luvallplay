import { del, put } from "@vercel/blob";

// Public images (shop photos, size charts, player photos) live in their own
// PUBLIC Vercel Blob store: receipts use a private one, and a store is either
// one or the other. Two ways to connect it:
//
// - Store connected to the project with the custom prefix "PHOTO" (how
//   Vercel connects new stores): Vercel adds PHOTO_STORE_ID and
//   PHOTO_WEBHOOK_PUBLIC_KEY, and the deployment signs in with its own
//   short-lived OIDC token. No token to copy.
// - Or a read-write token in PHOTO_BLOB_READ_WRITE_TOKEN (older stores, and
//   local development, where there's no OIDC token). Wins if both are set.

export type PublicBlobAuth = { token: string } | { storeId: string };

export function publicBlobAuth(): PublicBlobAuth | null {
  const token = process.env.PHOTO_BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return { token };
  const storeId = process.env.PHOTO_STORE_ID?.trim();
  if (storeId) return { storeId };
  return null;
}

export function publicBlobConfigured(): boolean {
  return publicBlobAuth() !== null;
}

/** How the browser uploads player photos: a client token, or a presigned URL (store ID setup). */
export function publicBlobUploadMode(): "token" | "presigned" | null {
  const auth = publicBlobAuth();
  return !auth ? null : "token" in auth ? "token" : "presigned";
}

export const PUBLIC_BLOB_SETUP_HINT =
  "Connect a PUBLIC Blob store to the project with the custom prefix PHOTO (adds PHOTO_STORE_ID), or set PHOTO_BLOB_READ_WRITE_TOKEN. Setup guide, step 3.";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"];
export const ADMIN_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) || "image";
}

/** Server-side upload of an admin-chosen image (form file). */
export async function uploadPublicImage(file: File, prefix: string): Promise<string> {
  const auth = publicBlobAuth();
  if (!auth) throw new Error("Image storage isn't set up yet (no public Blob store connected).");
  if (file.size > ADMIN_IMAGE_MAX_BYTES) throw new Error("Image is too large: please keep it under 8 MB.");
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Please choose a JPG, PNG, WebP or HEIC image.");
  const blob = await put(`${prefix}/${safeName(file.name)}`, Buffer.from(await file.arrayBuffer()), {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type,
    ...auth,
  });
  return blob.url;
}

/** Deletes public blobs we own (ignores anything that isn't a Blob URL). */
export async function deletePublicBlobs(urls: (string | null | undefined)[]): Promise<void> {
  const auth = publicBlobAuth();
  const ours = urls.filter((u): u is string => Boolean(u && /\.blob\.vercel-storage\.com\//.test(u)));
  if (!auth || ours.length === 0) return;
  try {
    await del(ours, auth);
  } catch (err) {
    console.error("[blob] delete failed:", err);
  }
}
