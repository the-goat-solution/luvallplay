// One storage interface, several providers (build plan §6.9; Phase 3 step 6).
//
// Photos and uploads go through this, so a region that isn't on Vercel
// (Hanoi: S3-compatible storage at the provider) changes a setting, not the
// code that stores a file.
//
// STORAGE_DRIVER chooses the provider:
//
//   vercel-blob  (default) Vercel Blob. For regions on Vercel.
//   memory       in-process, for tests. Refused in production.
//
// Any other value throws: a region must never guess where its files go. The
// S3-compatible provider arrives with the Hanoi stack and must pass the same
// contract tests (tests/storage.test.ts → storageContract).
//
// Still provider-specific, on purpose, until that provider exists:
//   - browser-direct photo uploads (app/api/profile/photos/upload): the
//     upload handshake is the provider's own protocol;
//   - finance receipts (lib/finance-receipts.ts): a private store with its
//     own signed reads.
// tests/storage.test.ts keeps the list of files allowed to import the
// provider's library, so a new direct use can't slip in.
import { del, put } from "@vercel/blob";

export type StoredObject = { url: string; pathname: string };

export type PutOptions = {
  contentType: string;
  /** Adds a random suffix so two uploads of "photo.jpg" never collide. Default true. */
  uniqueName?: boolean;
};

export interface ObjectStorage {
  readonly name: string;
  /** Whether the provider has what it needs (credentials, a bucket). */
  configured(): boolean;
  /** Stores a public object and returns where it can be read. */
  put(pathname: string, body: Buffer, options: PutOptions): Promise<StoredObject>;
  /** True for a URL this provider issued (so a delete never touches someone else's file). */
  owns(url: string): boolean;
  /** Deletes objects by URL. URLs the provider doesn't own are ignored. */
  delete(urls: string[]): Promise<void>;
}

// ── Vercel Blob ─────────────────────────────────────────────────────────────

type VercelAuth = { token: string } | { storeId: string };

/** The public store's credentials: a read-write token, or the store connected with the PHOTO prefix. */
export function vercelPublicAuth(): VercelAuth | null {
  const token = process.env.PHOTO_BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return { token };
  const storeId = process.env.PHOTO_STORE_ID?.trim();
  if (storeId) return { storeId };
  return null;
}

export function vercelBlobStorage(auth: () => VercelAuth | null = vercelPublicAuth): ObjectStorage {
  const owns = (url: string) => /\.blob\.vercel-storage\.com\//.test(url);
  return {
    name: "vercel-blob",
    configured: () => auth() !== null,
    async put(pathname, body, options) {
      const a = auth();
      if (!a) throw new Error("Image storage isn't set up yet (no public Blob store connected).");
      const blob = await put(pathname, body, { access: "public", addRandomSuffix: options.uniqueName ?? true, contentType: options.contentType, ...a });
      return { url: blob.url, pathname: blob.pathname };
    },
    owns,
    async delete(urls) {
      const a = auth();
      const ours = urls.filter(owns);
      if (!a || ours.length === 0) return;
      await del(ours, a);
    },
  };
}

// ── Memory (tests) ──────────────────────────────────────────────────────────

export type MemoryStorage = ObjectStorage & { objects: Map<string, { body: Buffer; contentType: string }> };

export function memoryStorage(origin = "https://files.test"): MemoryStorage {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  let n = 0;
  const owns = (url: string) => url.startsWith(`${origin}/`);
  return {
    name: "memory",
    objects,
    configured: () => true,
    async put(pathname, body, options) {
      const clean = pathname.replace(/^\/+/, "");
      const dot = clean.lastIndexOf(".");
      const unique = (options.uniqueName ?? true) ? `${dot > 0 ? clean.slice(0, dot) : clean}-${(++n).toString(36).padStart(6, "0")}${dot > 0 ? clean.slice(dot) : ""}` : clean;
      objects.set(unique, { body, contentType: options.contentType });
      return { url: `${origin}/${unique}`, pathname: unique };
    },
    owns,
    async delete(urls) {
      for (const url of urls) if (owns(url)) objects.delete(url.slice(origin.length + 1));
    },
  };
}

// ── The provider this deployment uses ───────────────────────────────────────

let current: ObjectStorage | null = null;

/** The public-file storage for this deployment. Throws on a STORAGE_DRIVER it doesn't know. */
export function publicStorage(): ObjectStorage {
  if (current) return current;
  const v = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  if (!v || v === "vercel-blob") current = vercelBlobStorage();
  else if (v === "memory" && process.env.VERCEL_ENV !== "production") current = memoryStorage();
  else throw new Error(`STORAGE_DRIVER is "${process.env.STORAGE_DRIVER}": expected "vercel-blob".`);
  return current;
}

/** For tests: use this storage (or pass null to choose from the environment again). */
export function setPublicStorage(storage: ObjectStorage | null): void {
  current = storage;
}
