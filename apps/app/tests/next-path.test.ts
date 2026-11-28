// Cutover gap B3: the screen a signed-out visitor asked for opens after sign-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appNext, HOME, nextSearch } from "../src/lib/next-path.ts";

test("a screen of the app, with its search and hash, is kept", () => {
  assert.equal(appNext("/inbox/12?club=three-wolves"), "/inbox/12?club=three-wolves");
  assert.equal(appNext("/arena"), "/arena");
  assert.equal(appNext("/profile#settings"), "/profile#settings");
});

test("anything that could leave the app, or loop, goes Home", () => {
  for (const bad of [undefined, null, 12, "", "inbox", "https://evil.example/x", "//evil.example", "/\\evil.example", "/api/v1/app/me", "/", "/signin", "/signin?next=/arena", "/handover", "/welcome", "/x\\y", "/x\ny", "/" + "a".repeat(600)]) {
    assert.equal(appNext(bad), HOME, String(bad));
  }
});

test("the search value: kept only when it leads somewhere other than Home", () => {
  assert.deepEqual(nextSearch({ next: "/leaderboard" }), { next: "/leaderboard" });
  assert.deepEqual(nextSearch({ next: "/home" }), {});
  assert.deepEqual(nextSearch({ next: "//evil.example" }), {});
  assert.deepEqual(nextSearch({}), {});
});
