// Stats by email (audit: "any account can send club-branded stats emails to
// any address", with a limit kept only by one of its two callers).
// The limits now live in shareStats itself, so they hold for the website's
// route and the app's API alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMAILS_PER_ADDRESS_PER_DAY, SHARES_PER_SENDER_PER_DAY, shareStats } from "../lib/wolf-vision-share.ts";

const body = (emails: (string | undefined)[]) => ({
  teams: ["Us", "Them"] as [string, string],
  duration: 600,
  rallies: 20,
  longestRally: 9,
  avgRallyShots: 4,
  fastestShotKmh: null,
  players: emails.map((email, i) => ({ name: `P${i}`, team: (i < 2 ? 0 : 1) as 0 | 1, hits: 5, distance: 100, topSpeed: 4, email })),
});
const sender = (id: number) => ({ id, email: `sender${id}@limits.test`, firstName: "Sam", lastName: "Sender" });
// Email isn't set up here, so a request that gets past the limits answers 503 "email_off": nothing is sent.
const outcome = async (id: number, emails: (string | undefined)[]) => {
  const r = await shareStats(sender(id), body(emails), () => true);
  return "error" in r.json ? r.json.error : "sent";
};

test("a sender's daily limit holds even when the caller applies none (the app's API passed 'always allowed')", async () => {
  const saved = [process.env.RESEND_API_KEY, process.env.EMAIL_FROM];
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  try {
    for (let i = 0; i < SHARES_PER_SENDER_PER_DAY; i++) assert.equal(await outcome(9001, [`friend${i}@limits.test`, undefined, undefined, undefined]), "email_off", `share ${i + 1}`);
    assert.equal(await outcome(9001, ["one.more@limits.test", undefined, undefined, undefined]), "too_many");
    // Someone else is not affected.
    assert.equal(await outcome(9002, ["one.more@limits.test", undefined, undefined, undefined]), "email_off");
  } finally {
    if (saved[0] !== undefined) process.env.RESEND_API_KEY = saved[0];
    if (saved[1] !== undefined) process.env.EMAIL_FROM = saved[1];
  }
});

test("one address gets only a few of these emails a day, however many accounts send them", async () => {
  delete process.env.RESEND_API_KEY;
  const target = "target@limits.test";
  for (let i = 0; i < EMAILS_PER_ADDRESS_PER_DAY; i++) assert.equal(await outcome(9100 + i, [target, undefined, undefined, undefined]), "email_off", `sender ${i + 1}`);
  assert.equal(await outcome(9200, [target, undefined, undefined, undefined]), "too_many");
  assert.equal(await outcome(9201, [` Target@Limits.TEST `.trim().toLowerCase(), undefined, undefined, undefined]), "too_many");
});

test("nobody to email, the sender's own address, and more than three addresses behave as before", async () => {
  assert.deepEqual((await shareStats(sender(9300), body([undefined, undefined, undefined, undefined]), () => true)).json, { ok: true, sent: [] });
  assert.deepEqual((await shareStats(sender(9300), body(["sender9300@limits.test", undefined, undefined, undefined]), () => true)).json, { ok: true, sent: [] });
  assert.equal(await outcome(9300, ["a@limits.test", "b@limits.test", "c@limits.test", "d@limits.test"]), "too_many_recipients");
  assert.equal((await shareStats(sender(9300), body(["a@limits.test", undefined, undefined, undefined]), () => false)).status, 429);
});
