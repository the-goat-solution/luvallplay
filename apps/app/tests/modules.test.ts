// Product rules on a club's modules (src/lib/modules.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { offeredModules, withProductRules } from "../src/lib/modules.ts";

describe("Vision is for badminton clubs", () => {
  test("a badminton club keeps Vision; any other sport, or none known, doesn't", () => {
    assert.deepEqual(offeredModules(["arena", "vision", "shop"], ["badminton"]), ["arena", "vision", "shop"]);
    assert.deepEqual(offeredModules(["arena", "vision"], ["Badminton ", "tennis"]), ["arena", "vision"], "case and spaces don't matter");
    assert.deepEqual(offeredModules(["arena", "vision", "shop"], ["tennis"]), ["arena", "shop"]);
    assert.deepEqual(offeredModules(["vision"], []), []);
  });
  test("the config is the same object when nothing changes, so the cache doesn't churn", () => {
    const tw = { modules: ["vision"], club: { sports: ["badminton"] } };
    assert.equal(withProductRules(tw), tw);
    const tennis = { modules: ["vision", "arena"], club: { sports: ["tennis"] }, terms: { visionName: "Ace Cam" } };
    assert.deepEqual(withProductRules(tennis), { ...tennis, modules: ["arena"] });
  });
});

import { OFFER_EVERY, platformOf, storeLinks, storeToOffer } from "../src/lib/get-app.ts";

describe("Get the app: who is offered the store app, and when", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
  const links = storeLinks("https://apps.apple.com/app/luvallplay/id123", "https://play.google.com/store/apps/details?id=com.luvallplay.app");
  const base = { installedWebApp: false, storeApp: false, links };

  test("phones and tablets: iPhone, iPad (a 'Mac' with touch), Android; a computer is none", () => {
    assert.equal(platformOf(IPHONE), "ios");
    assert.equal(platformOf(MAC, "MacIntel", 5), "ios", "an iPad");
    assert.equal(platformOf(MAC, "MacIntel", 0), null, "a Mac");
    assert.equal(platformOf(PIXEL), "android");
    assert.equal(platformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0"), null);
  });

  test("every fifth open, on that phone's own store", () => {
    const at = (opens: number, platform: "ios" | "android") => storeToOffer({ ...base, platform, opens });
    assert.deepEqual([1, 2, 3, 4, 5, 6, 9, 10, 15].map((n) => at(n, "ios") !== null), [false, false, false, false, true, false, false, true, true]);
    assert.equal(OFFER_EVERY, 5);
    assert.match(at(5, "ios") ?? "", /^https:\/\/apps\.apple\.com\//);
    assert.match(at(5, "android") ?? "", /^https:\/\/play\.google\.com\//);
  });

  test("off until that store's app is live; never in the installed web app, the store app, or on a computer", () => {
    assert.equal(storeToOffer({ ...base, links: storeLinks(undefined, undefined), platform: "ios", opens: 5 }), null, "no links: off");
    assert.equal(storeToOffer({ ...base, links: storeLinks(undefined, "https://play.google.com/store/apps/details?id=x"), platform: "ios", opens: 5 }), null, "only the Android app is live: not on an iPhone");
    assert.equal(storeToOffer({ ...base, installedWebApp: true, platform: "ios", opens: 5 }), null);
    assert.equal(storeToOffer({ ...base, storeApp: true, platform: "android", opens: 5 }), null);
    assert.equal(storeToOffer({ ...base, platform: null, opens: 5 }), null);
  });

  test("a store link must be that store's https page", () => {
    assert.deepEqual(storeLinks("http://apps.apple.com/app/x", "https://evil.example/play"), { ios: null, android: null });
    assert.deepEqual(storeLinks("  ", "not a url"), { ios: null, android: null });
  });
});

import { needsAttention } from "../src/lib/home.ts";

describe("Home's membership alert: only what needs doing", () => {
  const now = Date.parse("2026-11-25T00:00:00Z");
  const m = (o: object) => ({ status: "active", autoRenews: true, next: null, periodEnd: "2026-12-18", ...o });
  test("a payment that didn't go through, always", () => {
    assert.equal(needsAttention(m({ status: "past_due" }), now), "past_due");
  });
  test("ending within two weeks and not renewing (and nothing paid after it)", () => {
    assert.equal(needsAttention(m({ autoRenews: false, periodEnd: "2026-12-05" }), now), "ending");
    assert.equal(needsAttention(m({ autoRenews: false, periodEnd: "2026-12-30" }), now), null, "more than two weeks away");
    assert.equal(needsAttention(m({ autoRenews: false, periodEnd: "2026-12-05", next: { plan: "monthly" } }), now), null, "a paid follow-on carries them on");
    assert.equal(needsAttention(m({ autoRenews: true, periodEnd: "2026-12-05" }), now), null, "it renews");
    assert.equal(needsAttention(m({ autoRenews: false, periodEnd: "2026-11-01" }), now), null, "long over");
  });
  test("nothing for a healthy membership, or none", () => {
    assert.equal(needsAttention(m({}), now), null);
    assert.equal(needsAttention(null, now), null);
  });
});
