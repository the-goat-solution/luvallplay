// The Firebase file for the Android build comes from one setting and must be
// this app's; nothing of it is ever printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error a plain script, no types
import { APP_ID, readGoogleServices } from "../scripts/write-google-services.mjs";

const file = (pkg: string) => JSON.stringify({ project_info: { project_id: "luvallplay-test", project_number: "1" }, client: [{ client_info: { android_client_info: { package_name: pkg } }, api_key: [{ current_key: "made-up-key" }] }] });

test("this app's file is accepted, as it is or as base64", () => {
  assert.equal(APP_ID, "com.luvallplay.app");
  const plain = readGoogleServices(file("com.luvallplay.app"));
  assert.equal(plain.ok, true);
  assert.equal(JSON.parse(plain.text).project_info.project_id, "luvallplay-test");
  assert.equal(readGoogleServices(Buffer.from(file("com.luvallplay.app")).toString("base64")).ok, true);
});

test("no setting is not an error (push stays off); a wrong file is, and its contents are never echoed", () => {
  assert.deepEqual([readGoogleServices(undefined).empty, readGoogleServices("  ").empty], [true, true]);
  for (const bad of [file("com.example.other"), "not json", "{}", JSON.stringify({ project_info: { project_id: "x" }, client: [] })]) {
    const r = readGoogleServices(bad);
    assert.equal(r.ok, false);
    assert.equal(r.empty, undefined);
    assert.doesNotMatch(r.problem, /made-up-key|com\.example\.other/);
  }
});

test("the file stays out of the repository, and the build applies Google's plugin only when it is there", () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  assert.match(read("../android/.gitignore"), /^google-services\.json$/m);
  assert.match(read("../android/app/build.gradle"), /file\('google-services\.json'\)[\s\S]*apply plugin: 'com\.google\.gms\.google-services'/);
  assert.match(read("../android/build.gradle"), /com\.google\.gms:google-services/);
});
