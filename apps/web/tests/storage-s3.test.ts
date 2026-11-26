// Track V: the S3-compatible storage provider (build plan §6.9; test plan
// §3.16 "Storage and cron adapters pass the same contract tests as the
// Sydney ones").
//
// The contract and the round trip run against a real S3-compatible server
// (in CI: S3_TEST_ENDPOINT, with STORAGE_REQUIRE_S3=1 so they can't be
// skipped silently). The signing and the request shapes are also tested
// without a server.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeKey, s3ConfigFromEnv, s3Storage, signS3Request, type S3Config } from "../lib/storage-s3.ts";
import { storageContract } from "./storage-contract.ts";

const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

test("signing reproduces AWS's published example (GET Object, Signature Version 4)", () => {
  // From the Amazon S3 API reference, "Signature Calculations for the Authorization Header".
  const headers = signS3Request({
    method: "GET",
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    headers: { range: "bytes=0-9" },
    payloadHash: EMPTY_SHA,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    now: new Date("2013-05-24T00:00:00Z"),
  });
  assert.equal(
    headers.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
  assert.equal(headers["x-amz-date"], "20130524T000000Z");
  assert.equal("host" in headers, false, "fetch sets Host itself");
});

test("signing reproduces AWS's published example (PUT Object, with a body and extra headers)", () => {
  const body = "Welcome to Amazon S3.";
  const headers = signS3Request({
    method: "PUT",
    url: `https://examplebucket.s3.amazonaws.com/${encodeKey("test$file.text")}`,
    headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
    payloadHash: createHash("sha256").update(body).digest("hex"),
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    now: new Date("2013-05-24T00:00:00Z"),
  });
  assert.match(headers.authorization, /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
});

test("object keys are encoded the way the signature needs", () => {
  assert.equal(encodeKey("avatars/7/avatar.jpg"), "avatars/7/avatar.jpg");
  assert.equal(encodeKey("shop/ảnh đội (1).jpg"), "shop/%E1%BA%A3nh%20%C4%91%E1%BB%99i%20%281%29.jpg");
  assert.equal(encodeKey("a/b*c'd!e~f"), "a/b%2Ac%27d%21e~f");
});

test("settings: complete or not configured; never plain http in production", () => {
  const base = { S3_ENDPOINT: "https://s3.example.vn/", S3_BUCKET: "club-files", S3_ACCESS_KEY_ID: "key", S3_SECRET_ACCESS_KEY: "secret" };
  assert.deepEqual(s3ConfigFromEnv(base), { endpoint: "https://s3.example.vn", bucket: "club-files", accessKeyId: "key", secretAccessKey: "secret", region: "us-east-1", publicUrl: "https://s3.example.vn/club-files", objectAcl: undefined });
  assert.equal(s3ConfigFromEnv({ ...base, S3_PUBLIC_URL: "https://files.example.vn/", S3_REGION: "hn-1", S3_OBJECT_ACL: "public-read" })?.publicUrl, "https://files.example.vn");
  assert.equal(s3ConfigFromEnv({ ...base, S3_REGION: "hn-1" })?.region, "hn-1");
  for (const missing of Object.keys(base)) assert.equal(s3ConfigFromEnv({ ...base, [missing]: " " }), null, missing);
  assert.equal(s3ConfigFromEnv({}), null);
  assert.equal(s3ConfigFromEnv({ ...base, S3_ENDPOINT: "not a url" }), null);
  assert.equal(s3ConfigFromEnv({ ...base, S3_ENDPOINT: "ftp://s3.example.vn" }), null);
  assert.equal(s3ConfigFromEnv({ ...base, S3_BUCKET: "Bad_Bucket" }), null);
  assert.ok(s3ConfigFromEnv({ ...base, S3_ENDPOINT: "http://127.0.0.1:9000" }), "http is for a local test server");
  assert.equal(s3ConfigFromEnv({ ...base, S3_ENDPOINT: "http://127.0.0.1:9000", VERCEL_ENV: "production" }), null);
  assert.equal(s3ConfigFromEnv({ ...base, S3_ENDPOINT: "http://127.0.0.1:9000", NODE_ENV: "production" }), null);
});

// ── Without a server: the requests it makes ─────────────────────────────────

const CONFIG: S3Config = { endpoint: "https://s3.example.vn", bucket: "club-files", accessKeyId: "key", secretAccessKey: "secret", region: "us-east-1", publicUrl: "https://files.example.vn" };

function recorded(status = 200) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: Buffer | null }[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, body: init?.body ? Buffer.from(init.body as Uint8Array) : null });
    return new Response(status === 204 ? null : "<Error><Message>The message</Message></Error>", { status });
  }) as typeof fetch;
  return { calls, fakeFetch };
}

test("not configured: says so, uploads nothing, deletes nothing", async () => {
  const { calls, fakeFetch } = recorded();
  const s = s3Storage({ config: () => null, fetch: fakeFetch });
  assert.equal(s.name, "s3");
  assert.equal(s.configured(), false);
  assert.equal(s.owns("https://files.example.vn/a.jpg"), false);
  await assert.rejects(s.put("a.jpg", Buffer.from("x"), { contentType: "image/jpeg" }), /isn't set up/);
  await s.delete(["https://files.example.vn/a.jpg"]);
  assert.equal(calls.length, 0);
});

test("upload: a signed PUT to endpoint/bucket/key, and a public URL under S3_PUBLIC_URL", async () => {
  const { calls, fakeFetch } = recorded();
  const s = s3Storage({ config: () => ({ ...CONFIG, objectAcl: "public-read" }), fetch: fakeFetch, now: () => new Date("2027-01-15T03:04:05Z") });
  const a = await s.put("//shop/./../Ảnh đội.jpg", Buffer.from("bytes"), { contentType: "image/jpeg" });
  assert.match(a.pathname, /^shop\/Ảnh đội-[A-Za-z0-9_-]{16}\.jpg$/);
  assert.equal(a.url, `https://files.example.vn/${encodeKey(a.pathname)}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].url, `https://s3.example.vn/club-files/${encodeKey(a.pathname)}`);
  assert.equal(calls[0].body?.toString(), "bytes");
  assert.equal(calls[0].headers["content-type"], "image/jpeg");
  assert.equal(calls[0].headers["x-amz-acl"], "public-read");
  assert.equal(calls[0].headers["x-amz-date"], "20270115T030405Z");
  assert.equal(calls[0].headers["x-amz-content-sha256"], createHash("sha256").update("bytes").digest("hex"));
  assert.match(calls[0].headers.authorization, /^AWS4-HMAC-SHA256 Credential=key\/20270115\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-acl;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(calls).includes("secret"), "the secret key never travels");

  const fixed = await s.put("x/a.png", Buffer.from("p"), { contentType: "image/png", uniqueName: false });
  assert.equal(fixed.pathname, "x/a.png");
  const noExtension = await s.put("x/readme", Buffer.from("p"), { contentType: "text/plain" });
  assert.match(noExtension.pathname, /^x\/readme-[A-Za-z0-9_-]{16}$/);
  await assert.rejects(s.put("/../", Buffer.from("p"), { contentType: "text/plain" }), /needs a name/);
});

test("delete: only our own URLs, each as a signed DELETE; already gone is fine", async () => {
  const { calls, fakeFetch } = recorded(204);
  const s = s3Storage({ config: () => CONFIG, fetch: fakeFetch });
  assert.equal(s.owns("https://files.example.vn/shop/a.jpg"), true);
  assert.equal(s.owns("https://files.example.vn/"), false);
  assert.equal(s.owns("https://files.example.vn.evil.example/shop/a.jpg"), false);
  assert.equal(s.owns("https://abc.public.blob.vercel-storage.com/shop/a.jpg"), false);
  await s.delete(["https://someone-else.example/a.jpg", `https://files.example.vn/${encodeKey("shop/Ảnh đội.jpg")}`, "https://files.example.vn/shop/b.jpg?v=2"]);
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [
    ["DELETE", `https://s3.example.vn/club-files/${encodeKey("shop/Ảnh đội.jpg")}`],
    ["DELETE", "https://s3.example.vn/club-files/shop/b.jpg"],
  ]);
  const gone = recorded(404);
  await s3Storage({ config: () => CONFIG, fetch: gone.fakeFetch }).delete(["https://files.example.vn/shop/a.jpg"]);
  assert.equal(gone.calls.length, 1);
});

test("a refusal from the store is an error that names the status, not a silent success", async () => {
  const denied = recorded(403);
  const s = s3Storage({ config: () => CONFIG, fetch: denied.fakeFetch });
  await assert.rejects(s.put("a.jpg", Buffer.from("x"), { contentType: "image/jpeg" }), /upload failed \(403\)/);
  await assert.rejects(s.delete(["https://files.example.vn/a.jpg"]), /delete failed \(403\)/);
  await assert.rejects(s.read("a.jpg"), /read failed \(403\)/);
});

// ── Against a real S3-compatible server ─────────────────────────────────────

const ENDPOINT = process.env.S3_TEST_ENDPOINT?.replace(/\/+$/, "");
const REQUIRE = process.env.STORAGE_REQUIRE_S3 === "1";
const skip = !ENDPOINT && !REQUIRE ? "set S3_TEST_ENDPOINT (an S3-compatible server)" : false;
const live: S3Config = {
  endpoint: ENDPOINT ?? "http://127.0.0.1:9000",
  bucket: `contract-${process.pid}`,
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "testaccess",
  secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "testsecret",
  region: "us-east-1",
  // What the public would use: a CDN name in front of the bucket.
  publicUrl: "https://files.luvallplay.test",
};

describe("S3-compatible server", { skip }, () => {
  before(async () => {
    assert.ok(ENDPOINT, "S3_TEST_ENDPOINT must be set (STORAGE_REQUIRE_S3=1)");
    const url = `${live.endpoint}/${live.bucket}`;
    const headers = signS3Request({ method: "PUT", url, payloadHash: EMPTY_SHA, accessKeyId: live.accessKeyId, secretAccessKey: live.secretAccessKey, region: live.region, now: new Date() });
    const res = await fetch(url, { method: "PUT", headers });
    assert.ok(res.ok || res.status === 409, `creating the test bucket: ${res.status} ${await res.text()}`);
  });

  storageContract("s3 (real server)", () => s3Storage({ config: () => live }));

  test("the bytes and the content type arrive, and a delete removes them", async () => {
    const s = s3Storage({ config: () => live });
    const body = Buffer.from([0, 1, 2, 253, 254, 255, ...Buffer.from("ảnh")]);
    const a = await s.put("photos/2027/ảnh đội (1).jpg", body, { contentType: "image/jpeg" });
    const back = await s.read(a.pathname);
    assert.ok(back);
    assert.deepEqual(back.body, body);
    assert.equal(back.contentType, "image/jpeg");
    await s.delete([a.url]);
    assert.equal(await s.read(a.pathname), null);
    await s.delete([a.url]); // twice is fine
  });

  test("a fixed name overwrites; unique names don't", async () => {
    const s = s3Storage({ config: () => live });
    const one = await s.put("fixed/a.txt", Buffer.from("one"), { contentType: "text/plain", uniqueName: false });
    const two = await s.put("fixed/a.txt", Buffer.from("two"), { contentType: "text/plain", uniqueName: false });
    assert.equal(one.url, two.url);
    assert.equal((await s.read("fixed/a.txt"))?.body.toString(), "two");
    const u1 = await s.put("fixed/a.txt", Buffer.from("three"), { contentType: "text/plain" });
    assert.notEqual(u1.pathname, "fixed/a.txt");
    assert.equal((await s.read("fixed/a.txt"))?.body.toString(), "two");
    await s.delete([one.url, u1.url]);
  });

  test("the server checks the signature: a wrong secret stores nothing", async () => {
    const wrong = s3Storage({ config: () => ({ ...live, secretAccessKey: "not-the-secret" }) });
    await assert.rejects(wrong.put("denied/a.txt", Buffer.from("x"), { contentType: "text/plain", uniqueName: false }), /upload failed \(403\)/);
    assert.equal(await s3Storage({ config: () => live }).read("denied/a.txt"), null);
  });
});
