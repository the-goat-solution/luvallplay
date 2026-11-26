// Leaving the app for another site (src/lib/native/open.ts): a navigation in
// a browser; the in-app browser in the store app, for real web addresses only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeOutside, isOutsideLink, openOutside } from "../src/lib/native/open.ts";

test("only https addresses count as another site", () => {
  assert.equal(isOutsideLink("https://billing.stripe.com/p/session/abc"), true);
  for (const bad of ["http://example.com", "javascript:alert(1)", "intent://x#Intent;end", "file:///etc/hosts", "/membership", "nonsense"]) assert.equal(isOutsideLink(bad), false, bad);
});

test("in a browser: an ordinary navigation", () => {
  const went: string[] = [];
  openOutside("https://billing.stripe.com/p/session/abc", undefined, (u) => void went.push(u));
  assert.deepEqual(went, ["https://billing.stripe.com/p/session/abc"]);
});

test("in the store app: the in-app browser; a failure falls back to a navigation; anything that isn't https never reaches the plugin", async () => {
  const opened: string[] = [];
  const went: string[] = [];
  let closed = 0;
  const native = { open: async ({ url }: { url: string }) => void opened.push(url), close: async () => void closed++ };
  openOutside("https://billing.stripe.com/p/session/abc", native, (u) => void went.push(u));
  openOutside("intent://x#Intent;end", native, (u) => void went.push(u));
  assert.deepEqual(opened, ["https://billing.stripe.com/p/session/abc"]);
  assert.deepEqual(went, ["intent://x#Intent;end"], "left to the web view's own rules");

  const broken = { open: () => Promise.reject(new Error("no browser")), close: () => Promise.reject(new Error("none open")) };
  openOutside("https://example.com/receipt", broken, (u) => void went.push(u));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(went[1], "https://example.com/receipt");

  closeOutside(native);
  closeOutside(broken);
  closeOutside(undefined);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(closed, 1);
});
