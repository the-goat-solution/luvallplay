// The Firebase file for the iOS build comes from one setting and must be this
// app's; nothing of it is ever printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error a plain script, no types
import { APP_ID, readGoogleServiceInfo } from "../scripts/write-google-service-info.mjs";

const file = (bundle: string, extra = "") => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>API_KEY</key><string>made-up-key</string>
  <key>BUNDLE_ID</key>
  <string>${bundle}</string>
  <key>PROJECT_ID</key><string>luvallplay-test</string>
  <key>GOOGLE_APP_ID</key><string>1:1:ios:abc</string>${extra}
</dict></plist>`;

test("this app's file is accepted, as it is or as base64", () => {
  assert.equal(APP_ID, "com.luvallplay.app");
  const plain = readGoogleServiceInfo(file("com.luvallplay.app"));
  assert.equal(plain.ok, true);
  assert.match(plain.text, /luvallplay-test/);
  assert.equal(readGoogleServiceInfo(Buffer.from(file("com.luvallplay.app")).toString("base64")).ok, true);
});

test("no setting is not an error (push stays off); a wrong file is, and its contents are never echoed", () => {
  assert.deepEqual([readGoogleServiceInfo(undefined).empty, readGoogleServiceInfo("  ").empty], [true, true]);
  const noProject = file("com.luvallplay.app").replace("PROJECT_ID", "OTHER");
  for (const bad of [file("com.example.other"), "not a plist", "{}", noProject]) {
    const r = readGoogleServiceInfo(bad);
    assert.equal(r.ok, false);
    assert.equal(r.empty, undefined);
    assert.doesNotMatch(r.problem, /made-up-key|com\.example\.other/);
  }
});

test("the file stays out of the repository, and the iOS project wires Firebase without requiring the file", () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  assert.match(read("../ios/.gitignore"), /^App\/App\/GoogleService-Info\.plist$/m);
  const project = read("../ios/App/App.xcodeproj/project.pbxproj");
  assert.match(project, /firebase-ios-sdk/);
  assert.match(project, /productName = FirebaseMessaging;/);
  assert.doesNotMatch(project, /GoogleService-Info\.plist in Resources/); // copied by a script only when present
  const delegate = read("../ios/App/App/AppDelegate.swift");
  assert.match(delegate, /Bundle\.main\.path\(forResource: "GoogleService-Info"[\s\S]*FirebaseApp\.configure\(\)/);
  assert.match(delegate, /Messaging\.messaging\(\)\.apnsToken = deviceToken/);
  assert.match(delegate, /capacitorDidRegisterForRemoteNotifications, object: token/);
});
