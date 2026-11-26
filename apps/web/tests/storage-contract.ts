// The storage contract: what every provider behind lib/storage.ts must do
// (test plan §3.16 "Storage and cron adapters pass the same contract tests").
// Not a test file itself: each provider's test calls storageContract.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { ObjectStorage } from "../lib/storage.ts";

/**
 * What every provider must do. A new provider (the S3-compatible one for
 * Hanoi) runs this with a real bucket in its own test
 * (tests/storage-s3.test.ts).
 */
export function storageContract(name: string, make: () => ObjectStorage, foreignUrl = "https://someone-else.example/a.jpg") {
  describe(`storage contract: ${name}`, () => {
    test("stores a file and returns where to read it", async () => {
      const s = make();
      assert.equal(s.configured(), true);
      const a = await s.put("avatars/7/avatar.jpg", Buffer.from("one"), { contentType: "image/jpeg" });
      assert.match(a.url, /^https:\/\//);
      assert.ok(a.pathname.startsWith("avatars/7/avatar"));
      assert.ok(a.pathname.endsWith(".jpg"), "the extension survives the unique suffix");
      assert.equal(s.owns(a.url), true);
    });
    test("two uploads of the same name never collide", async () => {
      const s = make();
      const a = await s.put("shop/photo.jpg", Buffer.from("one"), { contentType: "image/jpeg" });
      const b = await s.put("shop/photo.jpg", Buffer.from("two"), { contentType: "image/jpeg" });
      assert.notEqual(a.url, b.url);
    });
    test("deletes only what it issued", async () => {
      const s = make();
      const a = await s.put("shop/photo.jpg", Buffer.from("one"), { contentType: "image/jpeg" });
      assert.equal(s.owns(foreignUrl), false);
      await s.delete([foreignUrl, a.url]);
      await s.delete([a.url]); // deleting twice is fine
      await s.delete([]);
    });
  });
}

