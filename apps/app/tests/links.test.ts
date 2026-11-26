// The store app's links (Phase 5): links the app makes start with its public
// address there; a link that opens the app leads only to a screen of the
// app; Android's back button closes a sheet before it goes back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PUBLIC_APP_URL, pathFromLink, publicOrigin } from "../src/lib/native/public-url.ts";
import { onBack, startShell } from "../src/lib/native/shell.ts";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

test("links the app makes: the page's origin in a browser, the public address in the store app", () => {
  assert.equal(PUBLIC_APP_URL, "https://app.luvallplay.com");
  assert.equal(publicOrigin(false, "https://preview.example"), "https://preview.example");
  assert.equal(publicOrigin(true, "https://localhost"), "https://app.luvallplay.com");
});

test("a link that opens the app leads to a screen of the app, and nowhere else", () => {
  assert.equal(pathFromLink("https://app.luvallplay.com/arena?join=AB12"), "/arena?join=AB12");
  assert.equal(pathFromLink("https://app.luvallplay.com/inbox/12?club=three-wolves#top"), "/inbox/12?club=three-wolves#top");
  assert.equal(pathFromLink("https://app.luvallplay.com"), "/");
  for (const bad of [
    "http://app.luvallplay.com/arena",
    "https://evil.example/arena",
    "https://app.luvallplay.com.evil.example/arena",
    "https://user:pw@app.luvallplay.com/arena",
    "https://app.luvallplay.com//evil.example",
    "com.luvallplay.app://arena",
    "javascript:alert(1)",
    "not a link",
  ]) {
    assert.equal(pathFromLink(bad), null, bad);
  }
});

test("back on Android: a sheet closes first, then one screen back, then the app steps aside", () => {
  const log: string[] = [];
  const host = { go: (p: string) => void log.push(`go ${p}`), back: () => void log.push("back") };
  const exit = () => void log.push("exit");
  onBack({ canGoBack: true }, host, exit, () => true);
  assert.deepEqual(log, [], "the sheet took it");
  onBack({ canGoBack: true }, host, exit, () => false);
  onBack({ canGoBack: false }, host, exit, () => false);
  assert.deepEqual(log, ["back", "exit"]);
});

test("the shell listens for links and back; without the plugin (a browser) nothing happens", () => {
  const went: string[] = [];
  const host = { go: (p: string) => void went.push(p), back: () => {} };
  startShell(host, undefined);
  const listeners = new Map<string, (data: never) => void>();
  const app = {
    addListener: (event: string, listener: (data: never) => void) => {
      listeners.set(event, listener);
      return { remove: async () => {} };
    },
    exitApp: async () => {},
  };
  startShell(host, app as never);
  assert.deepEqual([...listeners.keys()].sort(), ["appUrlOpen", "backButton"]);
  (listeners.get("appUrlOpen") as (d: { url: string }) => void)({ url: "https://app.luvallplay.com/arena?join=AB12" });
  (listeners.get("appUrlOpen") as (d: { url: string }) => void)({ url: "https://evil.example/arena" });
  assert.deepEqual(went, ["/arena?join=AB12"]);
});

test("Android is told which addresses are the app's, and the public address says which app may open them", () => {
  const manifest = read("../../native/android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /<intent-filter android:autoVerify="true">[\s\S]*?android:scheme="https" android:host="app\.luvallplay\.com"/);
  const links = JSON.parse(read("../public/.well-known/assetlinks.json"));
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(links[0].target.namespace, "android_app");
  assert.equal(links[0].target.package_name, "com.luvallplay.app");
  // Either the placeholder (until the owner copies it from Play Console) or a real SHA-256 fingerprint; never anything else.
  for (const f of links[0].target.sha256_cert_fingerprints) assert.match(f, /^(REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT|([0-9A-F]{2}:){31}[0-9A-F]{2})$/);
  assert.match(read("../vercel.json"), /"\/\.well-known\/assetlinks\.json", "headers": \[\{ "key": "Content-Type", "value": "application\/json" \}/);
});
