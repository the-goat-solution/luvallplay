import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { ctaTarget, fold, indexingAllowed, originFor, safetyContact } from "../lib/site.ts";
import { pickLang } from "../proxy.ts";
import { parseSubmission, rateBucket } from "../lib/forms.ts";
import { emailAllowed } from "../lib/email.ts";
import { markdownToBlocks } from "../lib/markdown.ts";
import { assemble } from "../lib/content.ts";
import { validSignature } from "../app/api/revalidate/route.ts";
import { settings } from "../content/site-content.ts";
import type { Doc } from "../lib/types.ts";

test("language: saved choice, then .vn, then the browser, then English", () => {
  assert.equal(pickLang("vi", "luvallplay.com", "en-NZ"), "vi");
  assert.equal(pickLang(undefined, "luvallplay.vn", "en-NZ,en;q=0.9"), "vi");
  assert.equal(pickLang(undefined, "luvallplay.com", "vi-VN,vi;q=0.9,en;q=0.8"), "vi");
  assert.equal(pickLang(undefined, "luvallplay.com", "fr-FR,en;q=0.8,vi;q=0.9"), "vi");
  assert.equal(pickLang(undefined, "luvallplay.com", "fr-FR,fr;q=0.9"), "en");
  assert.equal(pickLang("xx", "luvallplay.com", null), "en");
});

test("launch mode flips the calls to action", () => {
  const soon = { ...settings };
  assert.equal(ctaTarget("startClub", "en", soon).href, "/en/waitlist");
  assert.deepEqual(ctaTarget("appStore", "vi", soon), { href: "/vi/get-the-app", external: false, soon: true });
  const live = { ...settings, launchMode: "live" as const, wizardUrl: "https://app.luvallplay.com/start", appStoreUrl: "https://apps.apple.com/app/x" };
  assert.deepEqual(ctaTarget("startClub", "en", live), { href: "https://app.luvallplay.com/start", external: true, soon: false });
  assert.equal(ctaTarget("appStore", "en", live).external, true);
  assert.equal(ctaTarget("playStore", "en", live).soon, true, "a store without a link stays coming soon");
  // Live without a wizard link yet: still the waitlist, never a dead link.
  assert.equal(ctaTarget("startClub", "en", { ...settings, launchMode: "live" }).href, "/en/waitlist");
  assert.equal(ctaTarget("walkthrough", "en", { ...settings, bookingUrl: "https://cal.example/x" }).external, true);
});

test("search engines: only production, and only after go-live", () => {
  assert.equal(indexingAllowed({ searchIndexing: true }, { VERCEL_ENV: "preview" }), false);
  assert.equal(indexingAllowed({ searchIndexing: false }, { VERCEL_ENV: "production" }), false);
  assert.equal(indexingAllowed({ searchIndexing: true }, { VERCEL_ENV: "production" }), true);
  assert.equal(indexingAllowed({ searchIndexing: true }, {}), false);
});

test("the Vietnamese home can live on its own domain", () => {
  const env = { SITE_ORIGIN: "https://luvallplay.com", SITE_VI_ORIGIN: "https://luvallplay.vn/" };
  assert.equal(originFor("vi", env), "https://luvallplay.vn");
  assert.equal(originFor("en", env), "https://luvallplay.com");
  assert.equal(originFor("vi", { SITE_ORIGIN: "https://luvallplay.com" }), "https://luvallplay.com");
});

test("search ignores Vietnamese accents and case", () => {
  assert.equal(fold("Đà Nẵng"), "da nang");
  assert.equal(fold("  Thành phố Hồ Chí Minh "), "thanh pho ho chi minh");
  assert.ok(fold("Christchurch, New Zealand").includes(fold("CHRIST")));
});

test("email is sent only from production", () => {
  assert.equal(emailAllowed({ VERCEL_ENV: "preview", RESEND_API_KEY: "re_x" }), false);
  assert.equal(emailAllowed({ RESEND_API_KEY: "re_x" }), false);
  assert.equal(emailAllowed({ VERCEL_ENV: "production" }), false);
  assert.equal(emailAllowed({ VERCEL_ENV: "production", RESEND_API_KEY: "re_x" }), true);
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const base = { kind: "waitlist", locale: "en", email: "Sam@Example.org", name: "Sam", role: "organiser", consent: "yes" };

test("forms: validation, consent, honeypot", () => {
  const ok = parseSubmission(form(base));
  assert.ok(ok.ok);
  assert.equal(ok.value.email, "sam@example.org");
  assert.match(ok.value.consentText, /removed at any time/);
  assert.deepEqual(parseSubmission(form({ ...base, website: "http://spam" })), { ok: false, reason: "spam" });
  assert.equal((parseSubmission(form({ ...base, consent: "" })) as { field?: string }).field, "consent");
  assert.equal((parseSubmission(form({ ...base, email: "nope" })) as { field?: string }).field, "email");
  assert.equal((parseSubmission(form({ ...base, role: "admin" })) as { field?: string }).field, "role");
  assert.equal((parseSubmission(form({ ...base, kind: "contact" })) as { field?: string }).field, "message");
  assert.equal(parseSubmission(form({ ...base, kind: "nonsense" })).ok, false);
  const vi = parseSubmission(form({ kind: "app", locale: "vi", email: "a@b.vn", consent: "yes" }));
  assert.ok(vi.ok && /xoá thông tin/.test(vi.value.consentText));
  const long = parseSubmission(form({ ...base, kind: "contact", message: "x".repeat(9000) }));
  assert.ok(long.ok && long.value.message!.length === 4000);
});

test("rate limiting keeps a salted hash, never the address", () => {
  const a = rateBucket("203.0.113.9", { RATE_LIMIT_SALT: "s1" });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, rateBucket("203.0.113.9", { RATE_LIMIT_SALT: "s2" }));
  assert.ok(!a.includes("203"));
});

test("markdown becomes Portable Text", () => {
  const b = markdownToBlocks("## Title\n\nA **bold** [link](/help/x) here.\n\n- one\n- two\n\n1. first\n");
  assert.deepEqual(b.map((x) => `${x.style}:${x.listItem ?? ""}`), ["h2:", "normal:", "normal:bullet", "normal:bullet", "normal:number"]);
  assert.equal(b[1].markDefs[0].href, "/help/x");
  assert.deepEqual(b[1].children.map((c) => c.text), ["A ", "bold", " ", "link", " here."]);
});

test("Sanity documents win over the seed; missing ones fall back", () => {
  const seed = [settings, { _id: "club.a", _type: "club", name: "A" }, { _id: "homePage", _type: "homePage", hero: 1, vision: 2 }] as unknown as Doc[];
  const live = [{ ...settings, launchMode: "live" }, { _id: "club.b", _type: "club", name: "B" }, { _id: "homePage", _type: "homePage", hero: 9 }] as unknown as Doc[];
  const c = assemble(seed, live);
  assert.equal(c.settings.launchMode, "live");
  assert.deepEqual(c.clubs.map((x) => x.name), ["B"], "once Sanity has clubs, the seeded list is not mixed in");
  assert.deepEqual([c.home.hero, c.home.vision], [9, 2], "a section Sanity lacks comes from the seed");
  assert.equal(assemble(seed, null).clubs[0].name, "A");
});

test("the publish webhook needs a valid, fresh signature", () => {
  const body = '{"_id":"homePage"}';
  const now = 1_800_000_000_000;
  const sig = (t: number, secret: string) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("base64url")}`;
  assert.equal(validSignature(body, sig(now, "s3cret"), "s3cret", now), true);
  assert.equal(validSignature(body, sig(now, "wrong"), "s3cret", now), false);
  assert.equal(validSignature(body + " ", sig(now, "s3cret"), "s3cret", now), false);
  assert.equal(validSignature(body, sig(now - 3_600_000, "s3cret"), "s3cret", now), false);
  assert.equal(validSignature(body, null, "s3cret", now), false);
});

test("the child-safety contact: its own setting, else the general contact, else none", () => {
  const s = { contactEmail: "hello@example.test" };
  assert.equal(safetyContact(s, { SAFETY_CONTACT_EMAIL: " safety@example.test " }), "safety@example.test");
  assert.equal(safetyContact(s, {}), "hello@example.test");
  assert.equal(safetyContact(s, { SAFETY_CONTACT_EMAIL: "" }), "hello@example.test");
  // Something that isn't an address is never published.
  assert.equal(safetyContact(s, { SAFETY_CONTACT_EMAIL: "see the website" }), "hello@example.test");
  assert.equal(safetyContact(s, { SAFETY_CONTACT_EMAIL: "a@b.test, c@d.test" }), "hello@example.test");
  assert.equal(safetyContact({}, {}), undefined);
});
