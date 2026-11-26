// The store app (Phase 5): the session token lives in the phone's secret
// store, which answers asynchronously, so the app waits for it at start; in
// a browser nothing changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isNative, platform, plugin } from "../src/lib/native/platform.ts";
import { nativeSecrets } from "../src/lib/native/secure-storage.ts";
import { memoryStorage, type SecretStore } from "../src/lib/storage.ts";
import { createStore } from "../src/lib/store.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A secret store that answers after a moment, as the Keychain does, and records what it was asked. */
function slowSecrets(initial: Record<string, string> = {}, delay = 5) {
  const kept = new Map(Object.entries(initial));
  const calls: string[] = [];
  const store: SecretStore = {
    async get(k) {
      await wait(delay);
      return kept.get(k) ?? null;
    },
    async set(k, v) {
      calls.push(`set ${k}`);
      await wait(delay);
      kept.set(k, v);
    },
    async remove(k) {
      calls.push(`remove ${k}`);
      await wait(delay);
      kept.delete(k);
    },
  };
  return { store, kept, calls };
}

test("in a browser: not native, no plugins, and the store is ready at once with the token from the page's storage", async () => {
  assert.deepEqual([isNative(), platform(), plugin("SecureStoragePlugin"), nativeSecrets()], [false, "web", undefined, undefined]);
  const storage = memoryStorage();
  storage.set("token", "t-web");
  const s = createStore(storage);
  assert.equal(s.get().token, "t-web");
  await s.ready();
  s.set({ token: "t2" });
  assert.equal(storage.get("token"), "t2");
});

test("in the store app: the token comes from the secret store once ready, and is never written to plain storage", async () => {
  const storage = memoryStorage();
  storage.set("lang", "vi");
  const secrets = slowSecrets({ token: "t-kept" });
  const s = createStore(storage, secrets.store);
  let told = 0;
  s.subscribe(() => told++);
  assert.equal(s.get().token, null, "not known yet");
  assert.equal(s.get().lang, "vi", "the plain choices are there at once");
  await s.ready();
  assert.equal(s.get().token, "t-kept");
  assert.equal(told, 1);

  s.set({ token: "t-new", club: "three-wolves" });
  s.signOut();
  s.set({ token: "t-last" });
  await wait(40);
  assert.equal(storage.get("token"), null);
  assert.equal(storage.get("club"), null);
  assert.equal(secrets.kept.get("token"), "t-last", "writes land in the order they were made");
  assert.deepEqual(secrets.calls, ["set token", "remove token", "set token"]);
});

test("in the store app: a token left in plain storage is moved to the secret store once; signing in while it loads stands", async () => {
  const storage = memoryStorage();
  storage.set("token", "t-plain");
  const secrets = slowSecrets();
  const s = createStore(storage, secrets.store);
  await s.ready();
  assert.equal(s.get().token, "t-plain");
  assert.equal(storage.get("token"), null);
  assert.equal(secrets.kept.get("token"), "t-plain");

  const late = slowSecrets({ token: "t-old" }, 20);
  const s2 = createStore(memoryStorage(), late.store);
  s2.set({ token: "t-fresh" });
  await s2.ready();
  await wait(60);
  assert.equal(s2.get().token, "t-fresh");
  assert.equal(late.kept.get("token"), "t-fresh");
});

test("the secret store's plugin: a missing key is null, keys carry the app's prefix, a failing store degrades to signed out", async () => {
  const kept = new Map<string, string>();
  const native = {
    get: async ({ key }: { key: string }) => {
      if (!kept.has(key)) throw new Error("Item with given key does not exist");
      return { value: kept.get(key) as string };
    },
    set: async ({ key, value }: { key: string; value: string }) => void kept.set(key, value),
    remove: async ({ key }: { key: string }) => {
      if (!kept.delete(key)) throw new Error("not found");
    },
  };
  const secrets = nativeSecrets("lp.", native) as SecretStore;
  assert.equal(await secrets.get("token"), null);
  await secrets.set("token", "abc");
  assert.deepEqual([...kept], [["lp.token", "abc"]]);
  assert.equal(await secrets.get("token"), "abc");
  await secrets.remove("token");
  await secrets.remove("token");
  assert.equal(await secrets.get("token"), null);

  const broken: SecretStore = { get: () => Promise.reject(new Error("locked")), set: () => Promise.reject(new Error("locked")), remove: () => Promise.reject(new Error("locked")) };
  const s = createStore(memoryStorage(), broken);
  await s.ready();
  assert.equal(s.get().token, null);
  s.set({ token: "t" });
  await wait(5);
  assert.equal(s.get().token, "t", "kept for this run");
});
