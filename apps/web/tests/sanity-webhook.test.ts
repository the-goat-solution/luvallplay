// /api/revalidate (Sanity's publish webhook) checks the signature with
// @sanity/webhook since next-sanity left the web app (Phase 2, Studio move).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIGNATURE_HEADER_NAME, encodeSignatureHeader } from "@sanity/webhook";
import { NextRequest } from "next/server";

const SECRET = "test-revalidate-secret";
process.env.SANITY_REVALIDATE_SECRET = SECRET;

async function post(body: string, headers: Record<string, string> = {}, query = "") {
  const { POST } = await import("../app/api/revalidate/route.ts");
  const req = new NextRequest(`http://localhost/api/revalidate${query}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
  const res = await POST(req);
  return { status: res.status, json: await res.json() };
}

test("a correctly signed Sanity webhook is accepted", async () => {
  const body = JSON.stringify({ _type: "siteSettings", _id: "x" });
  const signature = await encodeSignatureHeader(body, Date.now(), SECRET);
  const r = await post(body, { [SIGNATURE_HEADER_NAME]: signature });
  // revalidatePath needs a Next request scope; outside Next it throws, which the
  // route reports as 500 only after the signature has passed.
  assert.notEqual(r.status, 401);
});

test("a tampered body, a wrong secret or no signature is refused", async () => {
  const body = JSON.stringify({ _type: "siteSettings" });
  const good = await encodeSignatureHeader(body, Date.now(), SECRET);
  assert.equal((await post(JSON.stringify({ _type: "other" }), { [SIGNATURE_HEADER_NAME]: good })).status, 401);
  const wrong = await encodeSignatureHeader(body, Date.now(), "not-the-secret");
  assert.equal((await post(body, { [SIGNATURE_HEADER_NAME]: wrong })).status, 401);
  assert.equal((await post(body)).status, 401);
});
