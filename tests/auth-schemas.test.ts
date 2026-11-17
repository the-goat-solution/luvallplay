import { test } from "node:test";
import assert from "node:assert/strict";
import { emailStartSchema, emailVerifySchema, smsVerifySchema } from "../lib/auth-schemas.ts";

// Regression: the login form sent phoneProof: null (empty React state), the
// schema rejected it, and every typed email code showed "That code isn't right".
test("email verify accepts null optional fields from the browser", () => {
  const parsed = emailVerifySchema.safeParse({ email: "Player@Example.com ", code: "123456", next: "/profile", phoneProof: null });
  assert.equal(parsed.success, true);
});

test("email verify accepts omitted optional fields and a phone proof", () => {
  assert.equal(emailVerifySchema.safeParse({ email: "a@b.co", code: "123456" }).success, true);
  assert.equal(emailVerifySchema.safeParse({ email: "a@b.co", code: "123456", phoneProof: "tok.sig" }).success, true);
});

test("email verify still rejects a bad email or code", () => {
  assert.equal(emailVerifySchema.safeParse({ email: "not-an-email", code: "123456" }).success, false);
  assert.equal(emailVerifySchema.safeParse({ email: "a@b.co", code: "12" }).success, false);
});

test("email start and SMS verify accept nulls and fill defaults", () => {
  const start = emailStartSchema.parse({ email: "a@b.co", next: null, lang: null, turnstileToken: null });
  assert.equal(start.lang, "en");
  const sms = smsVerifySchema.parse({ sessionInfo: "x".repeat(20), code: "123456", purpose: null, next: null });
  assert.equal(sms.purpose, "login");
});
