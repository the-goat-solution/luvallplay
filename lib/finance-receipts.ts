import { del, get, put } from "@vercel/blob";

// Receipt / invoice images for manual finance entries, stored in Vercel
// Blob. Uploaded as PRIVATE blobs and only ever served back through the
// admin-authenticated route app/api/admin/finance/receipts/[id], so a
// receipt (which can carry names, addresses, card digits) is never reachable
// by URL alone. If the connected store was created as a public store, the
// upload falls back to public access with an unguessable random suffix — the
// app still only links to it through the admin route.

export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;

export const RECEIPT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
];

export function receiptsConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-80);
  return cleaned || "receipt";
}

export type StoredReceipt = { url: string; access: "private" | "public"; contentType: string };

export async function uploadReceipt(entryId: number, file: File): Promise<StoredReceipt> {
  if (!receiptsConfigured()) {
    throw new Error("Receipt storage isn't set up yet (BLOB_READ_WRITE_TOKEN is missing).");
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    throw new Error("Receipt is too large — please keep it under 4 MB.");
  }
  const contentType = file.type || "application/octet-stream";
  if (!RECEIPT_CONTENT_TYPES.includes(contentType)) {
    throw new Error("Receipt must be an image (JPG, PNG, WebP, HEIC) or a PDF.");
  }

  const pathname = `finance-receipts/${entryId}/${safeFileName(file.name)}`;
  const body = Buffer.from(await file.arrayBuffer());
  try {
    const blob = await put(pathname, body, {
      access: "private",
      addRandomSuffix: true,
      contentType,
    });
    return { url: blob.url, access: "private", contentType };
  } catch (privateErr) {
    try {
      const blob = await put(pathname, body, {
        access: "public",
        addRandomSuffix: true,
        contentType,
      });
      return { url: blob.url, access: "public", contentType };
    } catch {
      throw privateErr;
    }
  }
}

export async function deleteReceipt(url: string | null | undefined): Promise<void> {
  if (!url || !receiptsConfigured()) return;
  try {
    await del(url);
  } catch (err) {
    // An orphaned file in storage is harmless; failing the admin's delete
    // or replace over it would not be.
    console.error("Failed to delete receipt blob", url, err);
  }
}

export async function fetchReceipt(url: string, access: string) {
  return get(url, { access: access === "public" ? "public" : "private" });
}
