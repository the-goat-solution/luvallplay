// Phase 5 step 6: the push sender (lib/push/fcm.ts). One setting holds the
// service account; without it nothing is sent; a notification leads only to
// a path inside the app; an address Firebase says is gone is reported for
// deletion. No network: the transport is replaced. Made-up keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { fcmConfigured, fcmMessage, fcmPushSender, parseServiceAccount, type FcmTransport } from "../lib/push/fcm.ts";
import { deploymentChannels, registerPushSender } from "../lib/messages/index.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const ACCOUNT = { type: "service_account", project_id: "luvallplay-test", client_email: "push@luvallplay-test.iam.gserviceaccount.com", private_key: privateKey };
const ENV = { FCM_SERVICE_ACCOUNT: JSON.stringify(ACCOUNT) };
const note = (tokens: string[], path?: string) => ({ tokens, title: "Three Wolves", body: "Friday is on", path });

test("the service account comes from one setting: the JSON as it is, or its base64; anything else is no sender", () => {
  assert.deepEqual(parseServiceAccount(ENV.FCM_SERVICE_ACCOUNT), { projectId: "luvallplay-test", clientEmail: ACCOUNT.client_email, privateKey });
  assert.equal(parseServiceAccount(Buffer.from(ENV.FCM_SERVICE_ACCOUNT).toString("base64"))?.projectId, "luvallplay-test");
  // A key pasted with its line breaks written out.
  assert.equal(parseServiceAccount(JSON.stringify({ ...ACCOUNT, private_key: privateKey.replace(/\n/g, "\\n") }))?.privateKey, privateKey);
  for (const bad of [undefined, "", "  ", "not json", "{}", JSON.stringify({ ...ACCOUNT, type: "authorized_user" }), JSON.stringify({ ...ACCOUNT, private_key: "nope" }), JSON.stringify({ ...ACCOUNT, project_id: "Bad Project/../x" }), JSON.stringify({ ...ACCOUNT, client_email: 5 })]) {
    assert.equal(parseServiceAccount(bad), null, String(bad).slice(0, 30));
  }
  assert.equal(fcmConfigured({}), false);
  assert.equal(fcmConfigured(ENV), true);
  assert.equal(fcmPushSender({}), null);
  assert.equal(fcmPushSender({ FCM_SERVICE_ACCOUNT: "{}" }), null);
});

test("without the setting the push channel is unavailable; a registered sender still wins", () => {
  registerPushSender(null);
  const before = process.env.FCM_SERVICE_ACCOUNT;
  delete process.env.FCM_SERVICE_ACCOUNT;
  try {
    assert.equal(deploymentChannels().find((c) => c.id === "push")?.available(), false);
    process.env.FCM_SERVICE_ACCOUNT = ENV.FCM_SERVICE_ACCOUNT;
    assert.equal(deploymentChannels().find((c) => c.id === "push")?.available(), true);
  } finally {
    if (before === undefined) delete process.env.FCM_SERVICE_ACCOUNT;
    else process.env.FCM_SERVICE_ACCOUNT = before;
  }
});

test("the message: the club's name, a short line, and only a path inside the app", () => {
  assert.deepEqual(fcmMessage(note([], "/inbox/12?club=three-wolves"), "tok"), {
    token: "tok",
    notification: { title: "Three Wolves", body: "Friday is on" },
    data: { path: "/inbox/12?club=three-wolves" },
    android: { priority: "high" },
  });
  for (const path of [undefined, "", "https://evil.example", "//evil.example", "inbox"]) assert.equal("data" in fcmMessage(note([], path), "tok"), false, String(path));
});

test("one notification goes to each device; it is sent when at least one took it", async () => {
  const calls: { projectId: string; token: unknown }[] = [];
  const transport: FcmTransport = async (projectId, message) => {
    calls.push({ projectId, token: message.token });
    return message.token === "b" ? { status: 503 } : { status: 200 };
  };
  const send = fcmPushSender(ENV, { transport })!;
  assert.deepEqual(await send(note(["a", "b", "c"], "/play")), { ok: true, providerId: "fcm:2/3" });
  assert.deepEqual(calls, [{ projectId: "luvallplay-test", token: "a" }, { projectId: "luvallplay-test", token: "b" }, { projectId: "luvallplay-test", token: "c" }]);
  assert.deepEqual(await send(note([])), { ok: false, reason: "no_device" });
});

test("an address Firebase says is gone is reported for deletion; other failures are not", async () => {
  const gone: string[][] = [];
  const transport: FcmTransport = async (_p, message) =>
    message.token === "old" ? { status: 404, errorCode: "UNREGISTERED" } : message.token === "other-project" ? { status: 403, errorCode: "SENDER_ID_MISMATCH" } : message.token === "busy" ? { status: 429, errorCode: "QUOTA_EXCEEDED" } : { status: 200 };
  const send = fcmPushSender(ENV, { transport, onGone: (tokens) => void gone.push(tokens) })!;
  assert.deepEqual(await send(note(["ok", "old", "busy", "other-project"])), { ok: true, providerId: "fcm:1/4" });
  assert.deepEqual(gone, [["old", "other-project"]]);
  assert.deepEqual(await send(note(["old"])), { ok: false, reason: "device_gone" });
  assert.deepEqual(await send(note(["busy"])), { ok: false, reason: "fcm_failed" });
});

test("a failure never throws, and never carries the key or an address", async () => {
  const boom: FcmTransport = async () => {
    throw new Error(`could not sign with ${privateKey} for device-address-123`);
  };
  const failing = fcmPushSender(ENV, { transport: boom, onGone: () => Promise.reject(new Error("db down")) })!;
  const result = await failing(note(["device-address-123"]));
  assert.deepEqual(result, { ok: false, reason: "fcm_failed" });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY|device-address/);
  // Cleaning up may fail too; the send's own answer stands.
  const cleanupFails = fcmPushSender(ENV, { transport: async () => ({ status: 404 }), onGone: () => Promise.reject(new Error("db down")) })!;
  assert.deepEqual(await cleanupFails(note(["x"])), { ok: false, reason: "device_gone" });
});
