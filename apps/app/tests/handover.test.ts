// The app's side of the cutover's session handover (gap B2): the link's
// fragment, and what the app does with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handoverStep, parseHandover, signInFor } from "../src/lib/handover.ts";

const TOKEN = "A".repeat(21) + "-_" + "z".repeat(20);

test("the token and the screen come from the fragment; a bad screen is Home, a malformed token is none", () => {
  assert.deepEqual(parseHandover(`#t=${TOKEN}&to=%2Finbox%2F12%3Fclub%3Dthree-wolves`), { token: TOKEN, to: "/inbox/12?club=three-wolves" });
  assert.deepEqual(parseHandover(`t=${TOKEN}`), { token: TOKEN, to: "/home" });
  assert.deepEqual(parseHandover(`#t=${TOKEN}&to=https%3A%2F%2Fevil.example`), { token: TOKEN, to: "/home" });
  assert.deepEqual(parseHandover("#t=short&to=%2Farena"), { token: null, to: "/arena" });
  assert.deepEqual(parseHandover(""), { token: null, to: "/home" });
});

test("already signed in: the token is ignored and the screen opens (a handover never replaces a session)", () => {
  assert.deepEqual(handoverStep({ token: TOKEN, to: "/arena" }, true), { kind: "open", to: "/arena" });
});

test("signed out: the token is swapped; without one, sign-in, which opens the same screen afterwards", () => {
  assert.deepEqual(handoverStep({ token: TOKEN, to: "/arena" }, false), { kind: "swap", token: TOKEN, to: "/arena" });
  assert.deepEqual(handoverStep({ token: null, to: "/arena" }, false), { kind: "signin", to: "/arena" });
  assert.equal(signInFor("/arena"), "/signin?next=%2Farena");
  assert.equal(signInFor("/home"), "/signin");
});
