// Handing the person a file (src/lib/native/files.ts): a download in a
// browser; written to the app's cache and offered through the share sheet in
// the store app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isShareCancel, safeFileName, saveFile } from "../src/lib/native/files.ts";

test("file names stay plain: nothing walks out of the cache folder", () => {
  assert.equal(safeFileName("my-club-data.json"), "my-club-data.json");
  assert.equal(safeFileName("../../etc/passwd"), "etc-passwd");
  assert.equal(safeFileName(".hidden name.json"), "hidden-name.json");
  assert.equal(safeFileName("///"), "file");
});

test("in a browser: a download with the same name and text", async () => {
  const got: string[][] = [];
  await saveFile("my-club-data.json", '{"a":1}', "application/json", undefined, (...args) => void got.push(args));
  assert.deepEqual(got, [["my-club-data.json", '{"a":1}', "application/json"]]);
});

test("in the store app: written to the cache, then the share sheet; closing the sheet is fine, a real failure is not", async () => {
  const written: unknown[] = [];
  const shared: unknown[] = [];
  const filesystem = {
    writeFile: async (o: { path: string; data: string; directory: "CACHE"; encoding: "utf8" }) => {
      written.push(o);
      return { uri: `file:///cache/${o.path}` };
    },
  };
  const never = () => assert.fail("no download in the store app");
  await saveFile("my-club-data.json", '{"a":1}', "application/json", { filesystem, share: { share: async (o) => void shared.push(o) } }, never);
  assert.deepEqual(written, [{ path: "my-club-data.json", data: '{"a":1}', directory: "CACHE", encoding: "utf8" }]);
  assert.deepEqual(shared, [{ title: "my-club-data.json", files: ["file:///cache/my-club-data.json"] }]);

  await saveFile("x.json", "{}", "application/json", { filesystem, share: { share: () => Promise.reject(new Error("Share canceled")) } }, never);
  await assert.rejects(saveFile("x.json", "{}", "application/json", { filesystem, share: { share: () => Promise.reject(new Error("No app can handle this")) } }, never));
  await assert.rejects(saveFile("x.json", "{}", "application/json", { filesystem: { writeFile: () => Promise.reject(new Error("disk full")) }, share: { share: async () => {} } }, never));
  assert.equal(isShareCancel(new Error("Share canceled")), true);
  assert.equal(isShareCancel(new Error("disk full")), false);
});
