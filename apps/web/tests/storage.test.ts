// One storage interface, several providers (Phase 3 step 6; test plan §3.16
// "Storage and cron adapters pass the same contract tests").

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { memoryStorage, publicStorage, setPublicStorage, vercelBlobStorage } from "../lib/storage.ts";
import { storageContract } from "./storage-contract.ts";
import { deletePublicBlobs, uploadPublicImage } from "../lib/public-blob.ts";

storageContract("memory", () => memoryStorage());

test("memory storage keeps and removes the bytes", async () => {
  const s = memoryStorage();
  const a = await s.put("x/a.png", Buffer.from("png"), { contentType: "image/png", uniqueName: false });
  assert.equal(a.pathname, "x/a.png");
  assert.equal(s.objects.get("x/a.png")?.body.toString(), "png");
  await s.delete(["https://someone-else.example/x/a.png"]);
  assert.equal(s.objects.size, 1);
  await s.delete([a.url]);
  assert.equal(s.objects.size, 0);
});

test("Vercel Blob: not configured without credentials, and it never deletes a URL it didn't issue", async () => {
  const none = vercelBlobStorage(() => null);
  assert.equal(none.configured(), false);
  await assert.rejects(none.put("a.jpg", Buffer.from("x"), { contentType: "image/jpeg" }), /isn't set up/);
  const s = vercelBlobStorage(() => ({ token: "vercel_blob_rw_test" }));
  assert.equal(s.configured(), true);
  assert.equal(s.owns("https://abc123.public.blob.vercel-storage.com/avatars/1/a.jpg"), true);
  assert.equal(s.owns("https://evil.example/x.blob.vercel-storage.com"), false);
  await s.delete(["https://someone-else.example/a.jpg"]); // nothing of ours: no network call, no error
});

test("the provider is chosen by STORAGE_DRIVER, and an unknown one stops", () => {
  const was = { driver: process.env.STORAGE_DRIVER, vercel: process.env.VERCEL_ENV };
  const set = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  try {
    setPublicStorage(null);
    set("STORAGE_DRIVER", undefined);
    assert.equal(publicStorage().name, "vercel-blob");
    setPublicStorage(null);
    set("STORAGE_DRIVER", "memory");
    set("VERCEL_ENV", undefined);
    assert.equal(publicStorage().name, "memory");
    setPublicStorage(null);
    set("VERCEL_ENV", "production");
    assert.throws(() => publicStorage(), /STORAGE_DRIVER/);
    setPublicStorage(null);
    set("STORAGE_DRIVER", "s3");
    assert.equal(publicStorage().name, "s3", "the S3-compatible provider, in production too");
    setPublicStorage(null);
    set("STORAGE_DRIVER", "gcs");
    assert.throws(() => publicStorage(), /STORAGE_DRIVER/);
  } finally {
    set("STORAGE_DRIVER", was.driver);
    set("VERCEL_ENV", was.vercel);
    setPublicStorage(null);
  }
});

test("admin image uploads and deletes go through the interface", async () => {
  const s = memoryStorage();
  setPublicStorage(s);
  try {
    const url = await uploadPublicImage(new File([Buffer.from("img")], "Team Photo (1).JPG", { type: "image/jpeg" }), "shop");
    assert.match(url, /^https:\/\/files\.test\/shop\/team-photo-1-[a-z0-9-]+\.jpg$/);
    assert.equal(s.objects.size, 1);
    await assert.rejects(uploadPublicImage(new File(["x"], "a.txt", { type: "text/plain" }), "shop"), /JPG, PNG/);
    await deletePublicBlobs([null, undefined, "https://someone-else.example/a.jpg", url]);
    assert.equal(s.objects.size, 0);
  } finally {
    setPublicStorage(null);
  }
});

test("only the listed files talk to the storage provider's library directly", () => {
  const root = path.resolve(import.meta.dirname, "..");
  // Why each is allowed is written in lib/storage.ts.
  const ALLOWED = new Set([
    "lib/storage.ts",
    "lib/finance-receipts.ts",
    "lib/setup-check.ts",
    "lib/photos-service.ts",
    "components/profile/player/PhotosPanel.tsx",
  ]);
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|mjs)$/.test(e.name) && /from "@vercel\/blob|import\("@vercel\/blob/.test(fs.readFileSync(path.join(root, rel), "utf8"))) found.push(rel);
    }
  };
  for (const dir of ["app", "lib", "components", "context", "hooks"]) if (fs.existsSync(path.join(root, dir))) walk(dir);
  assert.deepEqual(found.filter((f) => !ALLOWED.has(f)), [], "a new direct use of the provider's library: use lib/storage.ts");
  assert.deepEqual([...ALLOWED].filter((f) => !found.includes(f)), [], "no longer uses the library: remove it from the list");
});
