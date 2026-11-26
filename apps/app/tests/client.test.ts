// The API transport (packages/api/src/client.ts) as the app uses it: an
// answer that isn't the API's is an error, never data; a call that gets no
// answer in time fails; a 401 names the token it was for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createTransport } from "@luvallplay/api/client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const transport = (fetch: typeof globalThis.fetch, extra: Partial<Parameters<typeof createTransport>[0]> = {}) => createTransport({ baseUrl: "https://api.example", fetch, ...extra });
const failure = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof ApiError, String(err));
    return err;
  }
  throw new Error("expected the call to fail");
};

test("the API's own answer comes back as data", async () => {
  assert.deepEqual(await transport(async () => json({ clubs: [] })).call("clubs.list"), { clubs: [] });
});

test("a 200 that isn't the API's JSON (a Wi-Fi sign-in page, an empty body) is bad_response, and worth trying again", async () => {
  const html = await failure(transport(async () => new Response("<html>Sign in to Wi-Fi</html>", { status: 200, headers: { "content-type": "text/html" } })).call("clubs.list"));
  assert.deepEqual([html.code, html.status, html.transient, html.offline], ["bad_response", 200, true, false]);
  const empty = await failure(transport(async () => new Response("", { status: 200 })).call("clubs.list"));
  assert.equal(empty.code, "bad_response");
  const nothing = await failure(transport(async () => json(null)).call("clubs.list"));
  assert.equal(nothing.code, "bad_response");
});

test("errors keep the server's code; which are worth sending again", async () => {
  const refused = await failure(transport(async () => json({ error: "too_late" }, 409)).call("clubs.list"));
  assert.deepEqual([refused.code, refused.status, refused.transient], ["too_late", 409, false]);
  for (const status of [408, 429, 500, 503]) assert.equal((await failure(transport(async () => new Response("busy", { status })).call("clubs.list"))).transient, true, String(status));
  const offline = await failure(transport(async () => Promise.reject(new TypeError("Failed to fetch"))).call("clubs.list"));
  assert.deepEqual([offline.code, offline.status, offline.transient, offline.offline], ["network", 0, true, true]);
});

test("a call that gets no answer in time fails with timeout; the caller's own cancel stays a cancel", async () => {
  const never: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const stop = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (init?.signal?.aborted) stop();
      else init?.signal?.addEventListener("abort", stop);
    });
  const slow = await failure(transport(never, { timeoutMs: 20 }).call("clubs.list"));
  assert.deepEqual([slow.code, slow.status, slow.transient], ["timeout", 0, true]);

  // A body that never finishes counts too.
  const stalled: typeof fetch = async (_url, init) =>
    new Response(new ReadableStream({ start: (c) => init?.signal?.addEventListener("abort", () => c.error(Object.assign(new Error("aborted"), { name: "AbortError" }))) }), { status: 200 });
  assert.equal((await failure(transport(stalled, { timeoutMs: 20 }).call("clubs.list"))).code, "timeout");

  const controller = new AbortController();
  const pending = transport(never, { timeoutMs: 5000 }).call("clubs.list", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (err: Error) => err.name === "AbortError" && !(err instanceof ApiError));
});

test("a 401 tells which token it was for, and only the API's own 401 counts", async () => {
  let token = "old";
  const seen: (string | null)[] = [];
  const t = transport(async () => json({ error: "unauthorized" }, 401), { getToken: () => token, onUnauthorized: (used) => void seen.push(used) });
  const call = t.call("auth.session");
  token = "new"; // signed in again while the old call was on its way
  await failure(call);
  assert.deepEqual([...seen], ["old"]);

  // A proxy's or a sign-in page's 401 says nothing about the session.
  const proxy = transport(async () => new Response("<html>401</html>", { status: 401 }), { getToken: () => "t", onUnauthorized: (used) => void seen.push(used) });
  assert.equal((await failure(proxy.call("auth.session"))).status, 401);
  assert.deepEqual([...seen], ["old"]);
});
