// The Play upload: reads the service account safely, signs a real RS256
// assertion, walks the Play Developer API's edit steps in order, and never
// prints the key or a token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
// @ts-expect-error plain JS module
import { PACKAGE, readServiceAccount, signAssertion, upload } from "../scripts/play-upload.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const keyFile = JSON.stringify({ type: "service_account", client_email: "ci@luvallplay.iam.gserviceaccount.com", private_key: pem, token_uri: "https://oauth2.googleapis.com/token" });

test("the service account is read from its JSON or base64, and a wrong file is named without being echoed", () => {
  assert.equal(readServiceAccount(keyFile).ok, true);
  assert.equal(readServiceAccount(Buffer.from(keyFile).toString("base64")).ok, true);
  assert.match(readServiceAccount("").problem, /isn't set/);
  assert.match(readServiceAccount("not json at all").problem, /isn't JSON/);
  const wrong = readServiceAccount(JSON.stringify({ type: "authorized_user", secret: "do-not-echo-me" }));
  assert.equal(wrong.ok, false);
  assert.doesNotMatch(wrong.problem, /do-not-echo-me/);
});

test("the assertion is a valid RS256 JWT for the Play scope, good for under an hour", () => {
  const { account } = readServiceAccount(keyFile);
  const jwt = signAssertion(account, 1_000);
  const [head, body, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(head, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  assert.deepEqual([claims.iss, claims.scope, claims.aud, claims.exp - claims.iat], [account.email, "https://www.googleapis.com/auth/androidpublisher", account.tokenUri, 3300]);
  assert.equal(createVerify("RSA-SHA256").update(`${head}.${body}`).verify(publicKey, Buffer.from(sig, "base64url")), true);
});

function fakeGoogle(failAt?: string) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchFn = async (url: string, init: { method: string; body?: unknown; headers?: Record<string, string> }) => {
    calls.push({ url, method: init.method, body: init.body });
    const step = url.includes("/token") ? "token" : url.endsWith(":commit") ? "commit" : url.includes("/bundles") ? "bundle" : url.includes("/tracks/") ? "track" : "edit";
    if (step === failAt) return new Response(JSON.stringify({ error: { message: "The caller does not have permission" } }), { status: 403 });
    if (step !== "token") assert.equal(init.headers?.authorization, "Bearer tok-1");
    const body = { token: { access_token: "tok-1" }, edit: { id: "e1" }, bundle: { versionCode: 7 }, track: {}, commit: {} }[step];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, fetchFn };
}

test("an upload goes token → edit → bundle → track → commit, as a draft on the internal track by default", async () => {
  const { account } = readServiceAccount(keyFile);
  const g = fakeGoogle();
  const out = await upload({ account, bundle: Buffer.from("aab"), fetchFn: g.fetchFn as never });
  assert.deepEqual(out, { versionCode: 7, track: "internal", status: "draft" });
  assert.deepEqual(
    g.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
    [
      "POST /token",
      `POST /androidpublisher/v3/applications/${PACKAGE}/edits`,
      `POST /upload/androidpublisher/v3/applications/${PACKAGE}/edits/e1/bundles`,
      `PUT /androidpublisher/v3/applications/${PACKAGE}/edits/e1/tracks/internal`,
      `POST /androidpublisher/v3/applications/${PACKAGE}/edits/e1:commit`,
    ],
  );
  assert.deepEqual(JSON.parse(g.calls[3].body as string), { track: "internal", releases: [{ name: "7", versionCodes: ["7"], status: "draft" }] });
});

test("a refusal stops the upload before it commits and says Google's reason, not the key", async () => {
  const { account } = readServiceAccount(keyFile);
  const g = fakeGoogle("bundle");
  await assert.rejects(upload({ account, bundle: Buffer.from("aab"), fetchFn: g.fetchFn as never }), (e: Error) => /Uploading the bundle failed \(HTTP 403\): The caller does not have permission/.test(e.message) && !e.message.includes("PRIVATE KEY"));
  assert.ok(!g.calls.some((c) => c.url.endsWith(":commit")), "nothing is committed after a failure");
  await assert.rejects(upload({ account, bundle: Buffer.from("x"), status: "inProgress", fetchFn: g.fetchFn as never }), /draft or completed/);
});
