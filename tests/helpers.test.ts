import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../lib/moderation-rules.ts";
import { toE164 } from "../lib/phone.ts";
import { safeNextPath } from "../lib/safe-next.ts";

test("SafeSearch rule: block likely, review possible, approve the rest", () => {
  assert.equal(decide({ adult: "VERY_UNLIKELY", violence: "UNLIKELY", racy: "UNLIKELY", spoof: "LIKELY" }), "approved");
  assert.equal(decide({ adult: "UNLIKELY", violence: "UNLIKELY", racy: "POSSIBLE" }), "needs_review");
  assert.equal(decide({ adult: "LIKELY", violence: "UNLIKELY", racy: "UNLIKELY" }), "rejected");
  assert.equal(decide({ adult: "UNLIKELY", violence: "VERY_LIKELY", racy: "UNLIKELY" }), "rejected");
  assert.equal(decide({}), "approved");
});

test("toE164: NZ numbers and international ones", () => {
  assert.equal(toE164("021 123 4567"), "+64211234567");
  assert.equal(toE164("+64 21 123 4567"), "+64211234567");
  assert.equal(toE164("0064211234567"), "+64211234567");
  assert.equal(toE164("+84 90 123 4567"), "+84901234567");
  assert.equal(toE164("12"), null);
  assert.equal(toE164(""), null);
  assert.equal(toE164(null), null);
});

test("safeNextPath only allows same-site paths", () => {
  assert.equal(safeNextPath("/profile/membership"), "/profile/membership");
  assert.equal(safeNextPath("https://evil.example"), "/profile");
  assert.equal(safeNextPath("//evil.example"), "/profile");
  assert.equal(safeNextPath("/\\evil.example"), "/profile");
  assert.equal(safeNextPath("/api/auth/logout"), "/profile");
  assert.equal(safeNextPath(undefined, "/x"), "/x");
});
