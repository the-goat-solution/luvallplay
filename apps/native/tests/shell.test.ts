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

test("Android: the newest target Play requires, the internet and camera permissions only (camera hardware not required), no backups of app data, no orientation lock", () => {
  const vars = read("../android/variables.gradle");
  assert.match(vars, /targetSdkVersion = 36/);
  assert.match(vars, /compileSdkVersion = 36/);
  const manifest = read("../android/app/src/main/AndroidManifest.xml");
  assert.deepEqual([...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1]), ["android.permission.INTERNET", "android.permission.CAMERA"]);
  assert.match(manifest, /<uses-feature android:name="android.hardware.camera" android:required="false" \/>/, "a phone without a camera must still be able to install");
  assert.deepEqual([...manifest.matchAll(/<uses-feature android:name="([^"]+)" android:required="true"/g)], []);
  assert.match(manifest, /android:allowBackup="false"/, "a restored copy on another phone couldn't read the Keystore anyway");
  assert.doesNotMatch(manifest, /screenOrientation|resizeableActivity="false"|usesCleartextTraffic="true"/);
});

test("the plugins the players' app expects are in the Android project", () => {
  const settings = read("../android/capacitor.settings.gradle");
  for (const name of ["capacitor-android", "capacitor-app", "capacitor-browser", "capacitor-filesystem", "capacitor-push-notifications", "capacitor-share", "capacitor-secure-storage-plugin"]) assert.match(settings, new RegExp(`include ':${name}'`));
  // The name the app looks the secure store up by (apps/app/src/lib/native/secure-storage.ts on its branch).
  assert.match(read("../../../node_modules/capacitor-secure-storage-plugin/dist/esm/index.js"), /registerPlugin\(['"]SecureStoragePlugin['"]/);
});

test("release signing: the upload key comes from the environment only, and the release workflow never runs for a pull request", () => {
  const gradle = read("../android/app/build.gradle");
  for (const name of ["ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD", "ANDROID_VERSION_CODE"]) assert.match(gradle, new RegExp(`System\\.getenv\\("${name}"\\)`));
  assert.doesNotMatch(gradle, /(storePassword|keyPassword)\s+["'][^"']/, "no password in the repository");
  assert.doesNotMatch(gradle, /signingConfig signingConfigs\.debug/, "a release is never signed with the debug key");
  const flow = read("../../../.github/workflows/android-release.yml");
  assert.doesNotMatch(flow, /pull_request/, "secrets never reach a pull request's code");
  // Only GitHub's own actions and pnpm's see the build; the Play key goes to our script, not a third-party action.
  const uses = [...flow.matchAll(/uses:\s*([^\s@]+)@/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(uses)].filter((u) => !/^(actions|pnpm)\//.test(u)), []);
  assert.match(flow, /PLAY_SERVICE_ACCOUNT_JSON: \$\{\{ secrets\.PLAY_SERVICE_ACCOUNT_JSON \}\}/);
});
