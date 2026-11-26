// Push in the store app (Phase 5): off in a browser and in a build without
// the Firebase file; the phone is asked only when the person turns it on; a
// notification leads only to a screen of the app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onPushTap, pathFromPush, pushPlugin, pushState, turnOnPush, type PushPlugin } from "../src/lib/native/push.ts";

type Listener = (payload: never) => void;
function fake(receive: "prompt" | "granted" | "denied", answer: "granted" | "denied" = "granted", outcome: "token" | "error" | "silent" = "token") {
  const listeners = new Map<string, Listener>();
  const calls: string[] = [];
  let removed = 0;
  const native = {
    checkPermissions: async () => (calls.push("check"), { receive }),
    requestPermissions: async () => (calls.push("request"), { receive: answer }),
    register: async () => {
      calls.push("register");
      if (outcome === "token") (listeners.get("registration") as (t: { value: string }) => void)({ value: "device-1" });
      if (outcome === "error") (listeners.get("registrationError") as (e: { error: string }) => void)({ error: "no_play_services" });
    },
    unregister: async () => void calls.push("unregister"),
    addListener: (event: string, listener: Listener) => (listeners.set(event, listener), { remove: async () => void removed++ }),
  } as unknown as PushPlugin;
  return { native, calls, listeners, removed: () => removed };
}

test("off in a browser and in a store build made without the Firebase file", async () => {
  const { native, calls } = fake("granted");
  assert.equal(pushPlugin(native, false), undefined);
  assert.equal(pushPlugin(undefined, true), undefined);
  assert.equal(pushPlugin(native, true), native);
  assert.equal(await pushState(undefined), "unavailable");
  assert.deepEqual(await turnOnPush(undefined), { state: "unavailable", token: null });
  assert.deepEqual(calls, [], "the phone is never asked");
});

test("the state is read without asking the phone anything", async () => {
  for (const [receive, state] of [["prompt", "ask"], ["granted", "on"], ["denied", "blocked"]] as const) {
    const { native, calls } = fake(receive);
    assert.equal(await pushState(native), state);
    assert.deepEqual(calls, ["check"]);
  }
});

test("turning it on: asks once, then gets this device's address", async () => {
  const first = fake("prompt", "granted");
  assert.deepEqual(await turnOnPush(first.native), { state: "on", token: "device-1" });
  assert.deepEqual(first.calls, ["check", "request", "register"]);
  await Promise.resolve();
  assert.equal(first.removed(), 2, "its listeners are taken off again");

  const already = fake("granted");
  await turnOnPush(already.native);
  assert.deepEqual(already.calls, ["check", "register"], "allowed before: not asked again");
});

test("a no is a no: nothing is registered, and a blocked phone isn't asked again", async () => {
  const said = fake("prompt", "denied");
  assert.deepEqual(await turnOnPush(said.native), { state: "blocked", token: null });
  assert.deepEqual(said.calls, ["check", "request"]);
  const blocked = fake("denied");
  assert.deepEqual(await turnOnPush(blocked.native), { state: "blocked", token: null });
  assert.deepEqual(blocked.calls, ["check"]);
});

test("a phone that can't get an address fails plainly, and so does one that never answers", async () => {
  await assert.rejects(turnOnPush(fake("granted", "granted", "error").native), /no_play_services/);
  await assert.rejects(turnOnPush(fake("granted", "granted", "silent").native, 5), /push_timeout/);
});

test("a notification leads to a screen of the app, and nowhere else", () => {
  assert.equal(pathFromPush({ path: "/arena?club=three-wolves" }), "/arena?club=three-wolves");
  assert.equal(pathFromPush({ path: "/inbox/12#top" }), "/inbox/12#top");
  for (const bad of [undefined, {}, { path: 12 }, { path: "https://evil.example/" }, { path: "//evil.example" }, { path: "/\\evil.example" }, { path: "arena" }, { path: "javascript:alert(1)" }]) {
    assert.equal(pathFromPush(bad as Record<string, unknown> | undefined), null, JSON.stringify(bad));
  }
  const { native, listeners } = fake("granted");
  const went: string[] = [];
  onPushTap((p) => went.push(p), native);
  const tap = listeners.get("pushNotificationActionPerformed") as (t: { notification: { data?: Record<string, unknown> } }) => void;
  tap({ notification: { data: { path: "/play" } } });
  tap({ notification: { data: { path: "https://evil.example" } } });
  tap({ notification: {} });
  assert.deepEqual(went, ["/play"]);
});
