import { del, put } from "@vercel/blob";

// Public images (shop photos, size charts, player photos) live in their own
// PUBLIC Vercel Blob store: the existing store is private (receipts), and a
// store is either one or the other. PHOTO_BLOB_READ_WRITE_TOKEN connects it.

export function publicBlobToken(): string | null {
  return process.env.PHOTO_BLOB_READ_WRITE_TOKEN?.trim() || null;
}

export function publicBlobConfigured(): boolean {
  return Boolean(publicBlobToken());
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"];
export const ADMIN_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) || "image";
}

/** Server-side upload of an admin-chosen image (form file). */
export async function uploadPublicImage(file: File, prefix: string): Promise<string> {
  const token = publicBlobToken();
  if (!token) throw new Error("Image storage isn't set up yet (PHOTO_BLOB_READ_WRITE_TOKEN is missing).");
  if (file.size > ADMIN_IMAGE_MAX_BYTES) throw new Error("Image is too large: please keep it under 8 MB.");
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Please choose a JPG, PNG, WebP or HEIC image.");
  const blob = await put(`${prefix}/${safeName(file.name)}`, Buffer.from(await file.arrayBuffer()), {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type,
    token,
  });
  return blob.url;
}

/** Deletes public blobs we own (ignores anything that isn't a Blob URL). */
export async function deletePublicBlobs(urls: (string | null | undefined)[]): Promise<void> {
  const token = publicBlobToken();
  const ours = urls.filter((u): u is string => Boolean(u && /\.blob\.vercel-storage\.com\//.test(u)));
  if (!token || ours.length === 0) return;
  try {
    await del(ours, { token });
  } catch (err) {
    console.error("[blob] delete failed:", err);
  }
}
