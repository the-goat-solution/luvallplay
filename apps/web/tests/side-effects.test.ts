// Test plan §2: every outbound side effect is OFF (or captured) outside
// production. One test per side effect, run against the real modules.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  assertStripeKeyAllowed,
  capturedOutbox,
  clearCapturedOutbox,
  sideEffectAllowed,
  type SideEffect,
} from "../lib/side-effects.ts";

const saved = { ...process.env };
beforeEach(() => {
  clearCapturedOutbox();
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

const ALL: SideEffect[] = ["email", "sms", "push", "stripe_live", "calendar_write", "akahu"];

test("side effects: allowed only when VERCEL_ENV is production", () => {
  for (const kind of ALL) {
    assert.equal(sideEffectAllowed(kind, { VERCEL_ENV: "production" }), true, kind);
    assert.equal(sideEffectAllowed(kind, { VERCEL_ENV: "preview" }), false, `${kind} on preview`);
    assert.equal(sideEffectAllowed(kind, { VERCEL_ENV: "development" }), false, `${kind} on development`);
    assert.equal(sideEffectAllowed(kind, {}), false, `${kind} locally / in CI`);
    // NODE_ENV=production (a local `next start`) is not the production deployment.
    assert.equal(sideEffectAllowed(kind, { NODE_ENV: "production" }), false, `${kind} with NODE_ENV only`);
  }
});

test("email: a preview with a real Resend key captures instead of sending", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.RESEND_API_KEY = "re_live_looking_key";
  process.env.EMAIL_FROM = "Three Wolves <club@example.com>";
  const realFetch = globalThis.fetch;
  let network = 0;
  globalThis.fetch = (async () => {
    network++;
    throw new Error("network must not be used");
  }) as typeof fetch;
  try {
    const { getResend } = await import("../lib/email.ts");
    const { getResend: getNotifyResend } = await import("../lib/notify.ts");
    await getResend().emails.send({ from: "a@example.com", to: "member@example.com", subject: "Hi", html: "<p>x</p>", text: "x" });
    await getNotifyResend().emails.send({ from: "a@example.com", to: ["admin@example.com"], subject: "Alert", html: "<p>y</p>" });
    assert.equal(network, 0);
    const box = capturedOutbox();
    assert.equal(box.length, 2);
    assert.deepEqual(box[0].to, ["member@example.com"]);
    assert.equal(box[1].subject, "Alert");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("sms: no texts outside production, even with the Firebase key set", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.FIREBASE_API_KEY = "AIza-real-looking";
  delete process.env.POSTGRES_URL;
  const { getSmsUsage } = await import("../lib/sms.ts");
  const usage = await getSmsUsage();
  assert.equal(usage.configured, false);
  assert.equal(usage.available, false);
});

test("stripe: a live key is refused outside production; test keys work", async () => {
  assert.throws(() => assertStripeKeyAllowed("sk_live_abc", { VERCEL_ENV: "preview" }), /production/);
  assert.throws(() => assertStripeKeyAllowed("rk_live_abc", {}), /production/);
  assert.doesNotThrow(() => assertStripeKeyAllowed("sk_test_abc", { VERCEL_ENV: "preview" }));
  assert.doesNotThrow(() => assertStripeKeyAllowed("sk_live_abc", { VERCEL_ENV: "production" }));
  // And through the real client factory.
  process.env.VERCEL_ENV = "preview";
  process.env.STRIPE_SECRET_KEY = "sk_live_should_not_be_used";
  const { getStripe } = await import("../lib/stripe.ts");
  assert.throws(() => getStripe(), /production/);
});

test("akahu: the bank feed is not configured outside production", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.AKAHU_APP_TOKEN = "app_token";
  process.env.AKAHU_USER_TOKEN = "user_token";
  const { akahuConfigured } = await import("../lib/bank-akahu.ts");
  assert.equal(akahuConfigured(), false);
  process.env.VERCEL_ENV = "production";
  assert.equal(akahuConfigured(), true);
});

test("google calendar: the integration is read-only (no write scope, no write calls)", () => {
  const src = readFileSync(new URL("../lib/google-calendar.ts", import.meta.url), "utf8");
  assert.match(src, /calendar\.readonly/);
  assert.doesNotMatch(src, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  assert.equal(sideEffectAllowed("calendar_write", { VERCEL_ENV: "preview" }), false);
});

test("push: nothing sends push notifications yet, and the gate is off outside production", () => {
  // Push arrives in Phase 5; until then no code may talk to a push service.
  const hits = scan((src) => /fcm\.googleapis\.com|web-push|sendNotification\(/.test(src));
  assert.deepEqual(hits, []);
  assert.equal(sideEffectAllowed("push", { VERCEL_ENV: "preview" }), false);
});

test("wiring: every outbound client is created behind the gate", () => {
  // A new `new Resend(` / `new Stripe(` anywhere else would bypass the gate.
  const resend = scan((src) => /new Resend\(/.test(src));
  assert.deepEqual(resend.sort(), ["lib/email.ts", "lib/notify.ts"]);
  const stripe = scan((src) => /new Stripe\(/.test(src));
  assert.deepEqual(stripe, ["lib/payments/stripe-client.ts"]);
  for (const file of [...resend, ...stripe, "lib/sms.ts", "lib/bank-akahu.ts"]) {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    assert.match(src, /side-effects/, `${file} imports the side-effect gate`);
  }
});

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
function scan(match: (src: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs)$/.test(name) && match(readFileSync(full, "utf8"))) out.push(path.relative(ROOT, full));
    }
  };
  for (const dir of ["lib", "app", "components"]) walk(path.join(ROOT, dir));
  return out;
}
