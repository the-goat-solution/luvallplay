// This phone and the person's notifications (Settings → Notifications, the
// store app): on registers the phone's address, off and signing out take it
// away, and a replaced address is passed on after a restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { disablePush, enablePush, refreshPush, rememberedPushToken, takePushToken, type PushDeps } from "../src/lib/native/push-device.ts";
import type { PushPlugin } from "../src/lib/native/push.ts";
import { memoryStorage } from "../src/lib/storage.ts";

function phone(receive: "prompt" | "granted" | "denied", token = "address-1", answer: "granted" | "denied" = "granted") {
  const listeners = new Map<string, (v: never) => void>();
  const calls: string[] = [];
  const native = {
    checkPermissions: async () => ({ receive }),
    requestPermissions: async () => (calls.push("asked"), { receive: answer }),
    register: async () => (listeners.get("registration") as (t: { value: string }) => void)({ value: token }),
    unregister: async () => void calls.push("unregistered"),
    addListener: (event: string, l: (v: never) => void) => (listeners.set(event, l), { remove: async () => {} }),
  } as unknown as PushPlugin;
  return { native, calls };
}
function setup(native: PushPlugin | undefined, platform: "android" | "ios" | "web" = "android") {
  const sent: string[] = [];
  const storage = memoryStorage();
  const deps: PushDeps = {
    storage,
    native,
    platform,
    server: { register: async (v) => void sent.push(`register ${v.platform} ${v.token}`), remove: async (v) => void sent.push(`remove ${v.token}`) },
  };
  return { deps, sent, storage };
}

test("turning on: the phone is asked, the address goes to the server and is remembered", async () => {
  const { native, calls } = phone("prompt");
  const { deps, sent, storage } = setup(native);
  assert.equal(await enablePush(deps), "on");
  assert.deepEqual(calls, ["asked"]);
  assert.deepEqual(sent, ["register android address-1"]);
  assert.equal(rememberedPushToken(storage), "address-1");
});

test("a no from the phone, or a browser: nothing reaches the server and nothing is remembered", async () => {
  const said = setup(phone("prompt", "x", "denied").native);
  assert.equal(await enablePush(said.deps), "blocked");
  const web = setup(phone("granted").native, "web");
  assert.equal(await enablePush(web.deps), "unavailable");
  const none = setup(undefined);
  assert.equal(await enablePush(none.deps), "unavailable");
  for (const s of [said, web, none]) {
    assert.deepEqual(s.sent, []);
    assert.equal(rememberedPushToken(s.storage), null);
  }
});

test("the server refuses: the phone is not marked as registered", async () => {
  const { deps, storage } = setup(phone("granted").native);
  deps.server.register = async () => Promise.reject(new Error("unavailable"));
  await assert.rejects(enablePush(deps), /unavailable/);
  assert.equal(rememberedPushToken(storage), null);
});

test("turning off: the server forgets the address and so does the phone, even offline", async () => {
  const { native, calls } = phone("granted");
  const { deps, sent, storage } = setup(native);
  await enablePush(deps);
  await disablePush(deps);
  assert.deepEqual(sent, ["register android address-1", "remove address-1"]);
  assert.deepEqual(calls, ["unregistered"]);
  assert.equal(rememberedPushToken(storage), null);

  const offline = setup(phone("granted").native);
  await enablePush(offline.deps);
  offline.deps.server.remove = async () => Promise.reject(new Error("offline"));
  await assert.rejects(disablePush(offline.deps), /offline/);
  assert.equal(rememberedPushToken(offline.storage), null, "forgotten here all the same");
});

test("signing out hands the address over once", async () => {
  const { deps, storage } = setup(phone("granted").native);
  await enablePush(deps);
  assert.equal(takePushToken(storage), "address-1");
  assert.equal(takePushToken(storage), null);
});

test("after a restart: a replaced address is registered and the old one removed; nothing happens otherwise, and the phone is never asked", async () => {
  const same = phone("granted", "address-1");
  const a = setup(same.native);
  await enablePush(a.deps);
  a.sent.length = 0;
  await refreshPush(a.deps);
  assert.deepEqual(a.sent, [], "same address: nothing");

  const b = setup(phone("granted", "address-2").native, "ios");
  b.storage.set("push.token", "address-1");
  await refreshPush(b.deps);
  assert.deepEqual(b.sent, ["register ios address-2", "remove address-1"]);
  assert.equal(rememberedPushToken(b.storage), "address-2");

  // Never turned on here: nothing, even when the phone would allow it.
  const never = phone("granted");
  const c = setup(never.native);
  await refreshPush(c.deps);
  assert.deepEqual([c.sent, never.calls], [[], []]);

  // Permission taken away in the phone's settings since: nothing, and no question.
  const revoked = phone("prompt", "address-9");
  const d = setup(revoked.native);
  d.storage.set("push.token", "address-1");
  await refreshPush(d.deps);
  assert.deepEqual([d.sent, revoked.calls], [[], []]);
});
