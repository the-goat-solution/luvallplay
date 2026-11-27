// The switch for the hidden Social, Marketplace and Moderation modules
// (lib/juniors/switch-rule.ts; Social plan, Task 3). Pure: settings in, a
// yes or no out. In production only the pilot lists count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hiddenModuleOn, pilotClubs, pilotModuleOn } from "../lib/juniors/switch-rule.ts";

const PROD = { VERCEL_ENV: "production" };

test("a pilot list is club ids separated by commas; anything else in it is nobody", () => {
  assert.deepEqual([...pilotClubs(undefined)], []);
  assert.deepEqual([...pilotClubs("")], []);
  assert.deepEqual([...pilotClubs(" 1, 7 ,12 ")], [1, 7, 12]);
  // Junk never matches: not a slug, not a range, not a sign, not a decimal, not a wildcard, not zero.
  assert.deepEqual([...pilotClubs("three-wolves,*,all,true,1-9,+3,-3,2.0,0x4,0,07,1e1, ,5;6,9999999999999999999")], []);
  assert.deepEqual([...pilotClubs("x,4,*")], [4], "a good entry beside junk still counts, and only it");
});

test("with nothing set every one of them is off, for every club, everywhere", () => {
  for (const env of [{}, PROD, { VERCEL_ENV: "preview" }, { SOCIAL_PILOT_TENANTS: "", MARKET_PILOT_TENANTS: "" }]) {
    for (const id of ["social", "marketplace", "moderation"]) {
      for (const club of [1, 2, null, undefined]) assert.equal(hiddenModuleOn(id, null, env, club), false, `${id} ${JSON.stringify(env)} ${club}`);
    }
  }
});

test("production: on only for a club in the pilot list, and the id has to be exactly that club's", () => {
  const env = { ...PROD, SOCIAL_PILOT_TENANTS: "1,12" };
  assert.equal(hiddenModuleOn("social", null, env, 1), true);
  assert.equal(hiddenModuleOn("social", null, env, 12), true);
  for (const club of [11, 2, 112, 121, 0, -1, 1.5, null, undefined]) assert.equal(hiddenModuleOn("social", null, env, club as number), false, String(club));
  assert.equal(hiddenModuleOn("social", null, env, "1" as unknown as number), false, "a club id is a number, not text");
  // Social's list says nothing about the Marketplace, and the other way round.
  assert.equal(hiddenModuleOn("marketplace", null, env, 1), false);
  assert.equal(hiddenModuleOn("marketplace", null, { ...PROD, MARKET_PILOT_TENANTS: "3" }, 3), true);
  assert.equal(hiddenModuleOn("social", null, { ...PROD, MARKET_PILOT_TENANTS: "3" }, 3), false);
});

test("production ignores SOCIAL_AVAILABILITY and MARKET_AVAILABILITY", () => {
  const env = { ...PROD, SOCIAL_AVAILABILITY: "available", MARKET_AVAILABILITY: "available" };
  for (const id of ["social", "marketplace", "moderation"]) assert.equal(hiddenModuleOn(id, null, env, 1), false, id);
  // Nothing in the club's own row opens it either.
  assert.equal(hiddenModuleOn("social", { safeguarding: { version: "1", byPlayerId: 1, at: "2026-01-01" }, on: true, pilot: true }, PROD, 1), false);
  // The pilot list still works beside the ignored word.
  assert.equal(hiddenModuleOn("social", null, { ...env, SOCIAL_PILOT_TENANTS: "4" }, 4), true);
  assert.equal(hiddenModuleOn("social", null, { ...env, SOCIAL_PILOT_TENANTS: "4" }, 5), false);
});

test("outside production the availability word opens it for every club (tests and previews), as Juniors' does", () => {
  for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }]) {
    assert.equal(hiddenModuleOn("social", null, { ...env, SOCIAL_AVAILABILITY: "available" }, 2), true);
    assert.equal(hiddenModuleOn("social", null, { ...env, SOCIAL_AVAILABILITY: " Beta " }, 2), true);
    assert.equal(hiddenModuleOn("social", null, { ...env, SOCIAL_AVAILABILITY: "hidden" }, 2), false);
    assert.equal(hiddenModuleOn("social", null, { ...env, SOCIAL_AVAILABILITY: "yes" }, 2), false, "an unknown word changes nothing");
    assert.equal(hiddenModuleOn("social", null, { ...env, MARKET_AVAILABILITY: "available" }, 2), false, "the Marketplace's word isn't Social's");
    assert.equal(hiddenModuleOn("marketplace", null, { ...env, MARKET_AVAILABILITY: "available" }, 2), true);
    assert.equal(hiddenModuleOn("social", null, { ...env, JUNIORS_AVAILABILITY: "available" }, 2), false, "nor is Juniors'");
    // A pilot list works here too, with no word set.
    assert.equal(hiddenModuleOn("social", null, { ...env, SOCIAL_PILOT_TENANTS: "2" }, 2), true);
    assert.equal(hiddenModuleOn("social", null, { ...env, SOCIAL_PILOT_TENANTS: "2" }, 3), false);
  }
});

test("moderation is on for a club when Social or the Marketplace is", () => {
  assert.equal(hiddenModuleOn("moderation", null, { ...PROD, SOCIAL_PILOT_TENANTS: "1" }, 1), true);
  assert.equal(hiddenModuleOn("moderation", null, { ...PROD, MARKET_PILOT_TENANTS: "1" }, 1), true, "the queue works with only the Marketplace on");
  assert.equal(hiddenModuleOn("moderation", null, { ...PROD, SOCIAL_PILOT_TENANTS: "1", MARKET_PILOT_TENANTS: "2" }, 3), false);
  assert.equal(hiddenModuleOn("moderation", null, { MARKET_AVAILABILITY: "available" }, 9), true);
  assert.equal(pilotModuleOn("social", 1, { ...PROD, SOCIAL_PILOT_TENANTS: "1" }), true);
  assert.equal(pilotModuleOn("marketplace", 1, { ...PROD, SOCIAL_PILOT_TENANTS: "1" }), false);
});

test("Juniors' own rule is as it was, and an unknown hidden module is never on", () => {
  const ack = { safeguarding: { version: "1", byPlayerId: 1, at: "2026-01-01T00:00:00Z" } };
  assert.equal(hiddenModuleOn("juniors", ack, { JUNIORS_AVAILABILITY: "available" }), true);
  assert.equal(hiddenModuleOn("juniors", null, { JUNIORS_AVAILABILITY: "available" }), false);
  assert.equal(hiddenModuleOn("forms-waivers", null, { JUNIORS_AVAILABILITY: "available" }), true);
  assert.equal(hiddenModuleOn("juniors", ack, { ...PROD, JUNIORS_AVAILABILITY: "available" }), false);
  assert.equal(hiddenModuleOn("juniors", ack, { SOCIAL_AVAILABILITY: "available", SOCIAL_PILOT_TENANTS: "1" }, 1), false, "Social's settings don't open Juniors");
  assert.equal(hiddenModuleOn("something-new", ack, { SOCIAL_AVAILABILITY: "available", JUNIORS_AVAILABILITY: "available", SOCIAL_PILOT_TENANTS: "1" }, 1), false);
});
