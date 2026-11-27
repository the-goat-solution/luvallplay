// The store app's identity and safety settings: these are what Google Play
// (and later Apple) hold us to, and the id can never change once published.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import config from "../capacitor.config.ts";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

test("one identity everywhere: com.luvallplay.app, named Luvallplay", () => {
  assert.equal(config.appId, "com.luvallplay.app");
  assert.equal(config.appName, "Luvallplay");
  const gradle = read("../android/app/build.gradle");
  assert.match(gradle, /namespace = "com\.luvallplay\.app"/);
  assert.match(gradle, /applicationId "com\.luvallplay\.app"/);
  assert.match(read("../android/app/src/main/res/values/strings.xml"), /<string name="app_name">Luvallplay<\/string>/);
  // The same id the players' app links to in the store.
  assert.match(read("../../app/tests/e2e/app.mjs"), /play\.google\.com\/store\/apps\/details\?id=com\.luvallplay\.app/);
});

test("the app is bundled (not a remote website), https only, and release builds can't be inspected", () => {
  assert.equal(config.webDir, "www");
  assert.equal(config.server?.url, undefined, "no remote page: the app's own files are in the bundle");
  assert.equal(config.server?.androidScheme, "https");
  assert.equal(config.android?.allowMixedContent, false);
  assert.equal(config.android?.webContentsDebuggingEnabled, false);
});

test("Android: the newest target Play requires, the internet permission only, no backups of app data, no orientation lock", () => {
  const vars = read("../android/variables.gradle");
  assert.match(vars, /targetSdkVersion = 36/);
  assert.match(vars, /compileSdkVersion = 36/);
  const manifest = read("../android/app/src/main/AndroidManifest.xml");
  assert.deepEqual([...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1]), ["android.permission.INTERNET"]);
  assert.match(manifest, /android:allowBackup="false"/, "a restored copy on another phone couldn't read the Keystore anyway");
  assert.doesNotMatch(manifest, /screenOrientation|resizeableActivity="false"|usesCleartextTraffic="true"/);
});

// allowBackup="false" stops Google's cloud backup, but on Android 12 and later
// a phone-to-phone transfer ignores it. The rules file is what covers both
// there: every place the app keeps data is left out of each.
test("Android: app data is left out of cloud backup and of a transfer to a new phone", () => {
  const manifest = read("../android/app/src/main/AndroidManifest.xml");
  const application = manifest.match(/<application\b[^>]*>/)?.[0] ?? "";
  assert.match(application, /android:allowBackup="false"/);
  assert.match(application, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.doesNotMatch(application, /android:fullBackupContent=/, "nothing that would turn the older backup back on");

  const rules = read("../android/app/src/main/res/xml/data_extraction_rules.xml").replace(/<!--[\s\S]*?-->/g, "");
  assert.match(rules, /^\s*<\?xml[^>]*\?>\s*<data-extraction-rules>[\s\S]*<\/data-extraction-rules>\s*$/);
  // Every domain Android knows (developer.android.com, "Back up user data with Auto Backup"): the app's files,
  // databases, preferences, its external files, anything else under its folder, and the device-protected copies.
  const domains = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"];
  const sections = [...rules.matchAll(/<(cloud-backup|device-transfer)\b[^>]*>([\s\S]*?)<\/\1>/g)];
  assert.deepEqual(sections.map((m) => m[1]).sort(), ["cloud-backup", "device-transfer"], "one section for each, and no other");
  for (const [, section, body] of sections) {
    assert.doesNotMatch(body, /<include\b/, `${section}: nothing is put back in`);
    const excluded = [...body.matchAll(/<exclude\s+domain="([^"]+)"\s+path="([^"]+)"\s*\/>/g)];
    assert.equal(excluded.length, [...body.matchAll(/<exclude\b/g)].length, `${section}: every exclude is domain then path`);
    assert.deepEqual(excluded.map((m) => m[1]).sort(), [...domains].sort(), `${section}: every domain, once`);
    assert.ok(excluded.every((m) => m[2] === "."), `${section}: the whole of each domain`);
    assert.equal(body.replace(/<exclude\b[^>]*\/>/g, "").trim(), "", `${section}: nothing else`);
  }
});

test("the plugins the players' app expects are in the Android project", () => {
  const settings = read("../android/capacitor.settings.gradle");
  for (const name of ["capacitor-android", "capacitor-app", "capacitor-browser", "capacitor-filesystem", "capacitor-push-notifications", "capacitor-share", "capacitor-secure-storage-plugin"]) assert.match(settings, new RegExp(`include ':${name}'`));
  // The name the app looks the secure store up by (apps/app/src/lib/native/secure-storage.ts on its branch).
  assert.match(read("../../../node_modules/capacitor-secure-storage-plugin/dist/esm/index.js"), /registerPlugin\(['"]SecureStoragePlugin['"]/);
});
