// Track V: message channels (build plan §11.4, decision AD: "a club's
// announcement goes out on the channels each member chose"). Email, push and
// SMS; Zalo is a named slot. Switched off by default, and nothing here
// touches the existing message emails.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CHANNEL_IDS,
  DEFAULT_CHANNELS,
  capturedChannelSends,
  channelsFor,
  clearCapturedChannelSends,
  deliveryKey,
  deploymentChannels,
  dispatchAnnouncement,
  messageChannelsOn,
  parseChannelChoice,
  registerPushSender,
  registerSmsSender,
  sendAnnouncement,
  type Announcement,
  type ChannelId,
  type MessageChannel,
  type Recipient,
  type SendResult,
} from "../lib/messages/index.ts";
import { emailChannel } from "../lib/messages/channels/email.ts";
import { pushBody, pushChannel } from "../lib/messages/channels/push.ts";
import { SMS_PLAIN_MAX, SMS_UNICODE_MAX, smsChannel, smsText } from "../lib/messages/channels/sms.ts";

const announcement: Announcement = { id: "a1", clubName: "CLB Cầu lông Hồ Tây", subject: "Nghỉ tập thứ Sáu tuần này", body: "Sân bảo trì.\n\nHẹn gặp lại tuần sau!", path: "/inbox/12" };

type Sent = { channel: ChannelId; memberId: number };
function fake(id: ChannelId, sent: Sent[], behaviour: { available?: boolean; reach?: (r: Recipient) => boolean; result?: (r: Recipient) => SendResult | Promise<SendResult> } = {}): MessageChannel {
  return {
    id,
    available: () => behaviour.available ?? true,
    canReach: behaviour.reach ?? (() => true),
    async send(_a, r) {
      const result = (await behaviour.result?.(r)) ?? { ok: true as const };
      if (result.ok) sent.push({ channel: id, memberId: r.memberId });
      return result;
    },
  };
}
const member = (memberId: number, channels?: ChannelId[] | null, more: Partial<Recipient> = {}): Recipient => ({ memberId, name: `M${memberId}`, lang: "vi", channels, email: `m${memberId}@example.com`, ...more });
const status = (r: Awaited<ReturnType<typeof dispatchAnnouncement>>) => r.deliveries.map((d) => `${d.memberId}:${d.channel}:${d.status}${d.fallback ? ":fallback" : ""}`);

beforeEach(() => {
  clearCapturedChannelSends();
  registerPushSender(null);
  registerSmsSender(null);
});

// ── Who gets what ───────────────────────────────────────────────────────────

test("the channels: email, push, SMS, and Zalo as a named slot; email is the default", () => {
  assert.deepEqual([...CHANNEL_IDS], ["email", "push", "sms", "zalo"]);
  assert.deepEqual([...DEFAULT_CHANNELS], ["email"]);
  assert.deepEqual(channelsFor({ channels: null }), ["email"]);
  assert.deepEqual(channelsFor({}), ["email"]);
  assert.deepEqual(channelsFor({ channels: ["zalo", "push"] }), ["push", "zalo"], "always tried in the same order");
  assert.deepEqual(channelsFor({ channels: [] }), [], "chose none");
  assert.deepEqual(channelsFor({ channels: null }, ["push", "email"]), ["email", "push"], "the club's default");
});

test("a stored choice is read safely", () => {
  assert.deepEqual(parseChannelChoice(["push", "email", "push", "fax", 7]), ["push", "email"]);
  assert.deepEqual(parseChannelChoice([]), []);
  for (const junk of [null, undefined, "email", { email: true }, 1]) assert.equal(parseChannelChoice(junk), null);
});

test("each member gets the announcement on exactly the channels they chose", async () => {
  const sent: Sent[] = [];
  const channels = (["email", "push", "sms"] as const).map((id) => fake(id, sent));
  const report = await dispatchAnnouncement(announcement, [member(1, ["email"]), member(2, ["push", "sms"]), member(3, null), member(4, ["email", "push", "sms"])], { channels });
  assert.deepEqual(sent, [
    { channel: "email", memberId: 1 },
    { channel: "push", memberId: 2 },
    { channel: "sms", memberId: 2 },
    { channel: "email", memberId: 3 },
    { channel: "email", memberId: 4 },
    { channel: "push", memberId: 4 },
    { channel: "sms", memberId: 4 },
  ]);
  assert.equal(report.reached, 4);
  assert.equal(report.optedOut, 0);
  assert.deepEqual(report.missed, []);
});

test("a member who chose none gets nothing, on any channel", async () => {
  const sent: Sent[] = [];
  const report = await dispatchAnnouncement(announcement, [member(1, []), member(2, ["email"])], { channels: [fake("email", sent), fake("push", sent)] });
  assert.deepEqual(sent, [{ channel: "email", memberId: 2 }]);
  assert.equal(report.optedOut, 1);
  assert.equal(report.reached, 1);
  assert.deepEqual(report.missed, [], "opting out isn't a missed delivery");
});

test("a channel that can't reach a member is recorded; email is the fallback when nothing could be tried", async () => {
  const sent: Sent[] = [];
  const channels = [fake("email", sent), fake("push", sent, { reach: (r) => (r.pushTokens?.length ?? 0) > 0 }), fake("sms", sent, { available: false })];
  const report = await dispatchAnnouncement(announcement, [member(1, ["push"]), member(2, ["push"], { pushTokens: ["t"] }), member(3, ["sms", "zalo"]), member(4, ["push", "email"])], { channels });
  assert.deepEqual(status(report), [
    "1:push:unreachable",
    "1:email:sent:fallback",
    "2:push:sent",
    "3:sms:unavailable",
    "3:zalo:unavailable",
    "3:email:sent:fallback",
    "4:email:sent",
    "4:push:unreachable",
  ]);
  assert.equal(report.reached, 4);
});

test("nobody is reachable: reported as missed, not as an error", async () => {
  const sent: Sent[] = [];
  const channels = [fake("email", sent, { reach: (r) => Boolean(r.email) }), fake("push", sent, { reach: () => false })];
  const report = await dispatchAnnouncement(announcement, [member(1, ["push"], { email: null })], { channels });
  assert.deepEqual(status(report), ["1:push:unreachable", "1:email:unreachable:fallback"]);
  assert.deepEqual(report.missed, [1]);
  assert.equal(report.reached, 0);
});

test("one channel failing or throwing never stops the others or the next member", async () => {
  const sent: Sent[] = [];
  const channels = [
    fake("email", sent, { result: (r) => (r.memberId === 1 ? { ok: false, reason: "bounced" } : { ok: true }) }),
    fake("push", sent, {
      result: () => {
        throw new Error("push service down");
      },
    }),
    fake("sms", sent),
  ];
  const report = await dispatchAnnouncement(announcement, [member(1, ["email", "push", "sms"]), member(2, ["email", "push"])], { channels });
  assert.deepEqual(status(report), ["1:email:failed", "1:push:failed", "1:sms:sent", "2:email:sent", "2:push:failed"]);
  assert.equal(report.deliveries[0].reason, "bounced");
  assert.equal(report.deliveries[1].reason, "push service down");
  assert.equal(report.reached, 2);
  // A failed channel was tried, so there's no surprise fallback to email on top.
  const onlyPush = await dispatchAnnouncement(announcement, [member(3, ["push"])], { channels });
  assert.deepEqual(status(onlyPush), ["3:push:failed"]);
  assert.deepEqual(onlyPush.missed, [3]);
});

test("running the send again never sends a second copy", async () => {
  const sent: Sent[] = [];
  const channels = [fake("email", sent), fake("push", sent)];
  const people = [member(1, ["email", "push"]), member(2, ["email"]), member(2, ["email"])];
  const first = await dispatchAnnouncement(announcement, people, { channels });
  assert.equal(sent.length, 3, "a member listed twice gets one copy");
  const delivered = new Set(first.deliveries.filter((d) => d.status === "sent").map((d) => deliveryKey(announcement.id, d.memberId, d.channel)));
  const second = await dispatchAnnouncement(announcement, people, { channels, alreadySent: delivered });
  assert.equal(sent.length, 3);
  assert.deepEqual(status(second), ["1:email:already_sent", "1:push:already_sent", "2:email:already_sent"]);
  assert.equal(second.reached, 2);
  // A different announcement is a different message.
  await dispatchAnnouncement({ ...announcement, id: "a2" }, people, { channels, alreadySent: delivered });
  assert.equal(sent.length, 6);
});

test("a retry after a partial failure sends only what's missing", async () => {
  const sent: Sent[] = [];
  let pushUp = false;
  const channels = [fake("email", sent), fake("push", sent, { result: () => (pushUp ? { ok: true } : { ok: false, reason: "down" }) })];
  const first = await dispatchAnnouncement(announcement, [member(1, ["email", "push"])], { channels });
  const delivered = new Set(first.deliveries.filter((d) => d.status === "sent").map((d) => deliveryKey(announcement.id, d.memberId, d.channel)));
  pushUp = true;
  const retry = await dispatchAnnouncement(announcement, [member(1, ["email", "push"])], { channels, alreadySent: delivered });
  assert.deepEqual(status(retry), ["1:email:already_sent", "1:push:sent"]);
  assert.deepEqual(sent, [{ channel: "email", memberId: 1 }, { channel: "push", memberId: 1 }]);
});

// ── The switch ──────────────────────────────────────────────────────────────

test("switched off by default: nothing is sent, and the report says so", async () => {
  assert.equal(messageChannelsOn({}), false);
  assert.equal(messageChannelsOn({ MESSAGE_CHANNELS: "off" }), false);
  assert.equal(messageChannelsOn({ MESSAGE_CHANNELS: "1" }), false);
  assert.equal(messageChannelsOn({ MESSAGE_CHANNELS: " On " }), true);
  const sent: Sent[] = [];
  const channels = [fake("email", sent)];
  const off = await sendAnnouncement(announcement, [member(1, ["email"])], { channels, env: {} });
  assert.deepEqual(off, { announcementId: "a1", deliveries: [], reached: 0, optedOut: 0, missed: [], off: true });
  assert.equal(sent.length, 0);
  const on = await sendAnnouncement(announcement, [member(1, ["email"])], { channels, env: { MESSAGE_CHANNELS: "on" } });
  assert.equal(on.off, false);
  assert.equal(sent.length, 1);
});

test("the existing message emails don't go through the channels, and nothing in the app sends announcements yet", () => {
  const root = path.resolve(import.meta.dirname, "..");
  assert.ok(!/lib\/messages|\.\/messages\//.test(fs.readFileSync(path.join(root, "lib/message-notify.ts"), "utf8")), "Three Wolves' message emails are as they were");
  const users: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (rel !== "lib/messages") walk(rel);
      } else if (/\.(ts|tsx)$/.test(e.name) && /from "(@\/lib|\.\.?(\/\.\.)*)\/messages(\/|")/.test(fs.readFileSync(path.join(root, rel), "utf8"))) users.push(rel);
    }
  };
  for (const dir of ["app", "lib", "components"]) walk(dir);
  // When the Messages module starts sending announcements, that is a change members see: it needs the owner's OK, and this list.
  assert.deepEqual(users, []);
});

// ── The channels themselves ─────────────────────────────────────────────────

test("email: the club's notice email, to members with an address", async () => {
  const mails: { to: string; subject: string; heading: string; lines: string[]; cta?: { label: string; path: string } }[] = [];
  const email = emailChannel({ send: async (m) => void mails.push(m), configured: () => true });
  assert.equal(email.available(), true);
  assert.equal(emailChannel({ configured: () => false }).available(), false);
  assert.equal(email.canReach(member(1)), true);
  assert.equal(email.canReach(member(1, null, { email: null })), false);
  assert.equal(email.canReach(member(1, null, { email: "not an address" })), false);
  assert.deepEqual(await email.send(announcement, member(1)), { ok: true });
  assert.deepEqual(mails, [{ to: "m1@example.com", subject: "CLB Cầu lông Hồ Tây: Nghỉ tập thứ Sáu tuần này", heading: "Nghỉ tập thứ Sáu tuần này", lines: ["Sân bảo trì.", "Hẹn gặp lại tuần sau!"], cta: { label: "Mở", path: "/inbox/12" } }]);
  await email.send({ ...announcement, path: undefined }, member(2, null, { lang: "en" }));
  assert.equal(mails[1].cta, undefined);
  await email.send(announcement, member(3, null, { lang: "fr" }));
  assert.equal(mails[2].cta?.label, "Open");
});

test("push: unavailable until the app registers a sender; one short line, never the body", async () => {
  assert.equal(pushChannel().available(), false);
  const pushed: unknown[] = [];
  const push = pushChannel({ sender: async (n) => (pushed.push(n), { ok: true, providerId: "p1" }), allowed: () => true });
  assert.equal(push.available(), true);
  assert.equal(push.canReach(member(1)), false);
  assert.equal(push.canReach(member(1, null, { pushTokens: [] })), false);
  assert.equal(push.canReach(member(1, null, { pushTokens: ["tok"] })), true);
  assert.deepEqual(await push.send(announcement, member(1, null, { pushTokens: ["tok"] })), { ok: true, providerId: "p1" });
  assert.deepEqual(pushed, [{ tokens: ["tok"], title: "CLB Cầu lông Hồ Tây", body: "Nghỉ tập thứ Sáu tuần này", path: "/inbox/12" }]);
  assert.ok(!JSON.stringify(pushed).includes("Sân bảo trì"), "the body stays off the lock screen");
  assert.equal(pushBody({ ...announcement, subject: "x".repeat(300) }).length, 118);
});

test("SMS: unavailable until a sender is registered; one segment; only allowed numbers", async () => {
  assert.equal(smsChannel().available(), false);
  const texts: { to: string; text: string }[] = [];
  const sms = smsChannel({ sender: async (m) => (texts.push(m), { ok: true }), isAllowedNumber: (n) => /^\+84[35789]\d{8}$/.test(n), link: () => "https://lvp.test/i/12", allowed: () => true });
  assert.equal(sms.canReach(member(1, null, { phoneE164: "+84912345678" })), true);
  assert.equal(sms.canReach(member(1, null, { phoneE164: "+64211234567" })), false, "not a number this deployment texts");
  assert.equal(sms.canReach(member(1)), false);
  assert.equal(smsChannel({ sender: async () => ({ ok: true }) }).canReach(member(1, null, { phoneE164: "+84912345678" })), false, "no numbers are allowed unless the deployment says which");
  await sms.send(announcement, member(1, null, { phoneE164: "+84912345678" }));
  assert.equal(texts[0].to, "+84912345678");
  assert.ok(texts[0].text.endsWith(" https://lvp.test/i/12"));
  assert.ok(texts[0].text.length <= SMS_UNICODE_MAX, "Vietnamese letters make it a 70-character text");
  assert.ok(!texts[0].text.includes("Sân bảo trì"));

  const plain = { ...announcement, clubName: "Hanoi Smashers", subject: "No session this Friday. ".repeat(20) };
  assert.equal(smsText(plain, "https://lvp.test/i/12").length, SMS_PLAIN_MAX);
  assert.ok(smsText(plain, "https://lvp.test/i/12").endsWith("… https://lvp.test/i/12"), "the link is kept whole");
  assert.equal(smsText({ ...plain, subject: "No session Friday" }), "Hanoi Smashers: No session Friday");
  assert.ok(smsText({ ...announcement, subject: "ô".repeat(200) }).length <= SMS_UNICODE_MAX);
});

test("outside production, push and SMS are captured, never sent", async () => {
  let real = 0;
  const sender = async () => (real++, { ok: true as const });
  const push = pushChannel({ sender }); // default: lib/side-effects.ts decides, and this isn't production
  const sms = smsChannel({ sender, isAllowedNumber: () => true });
  assert.deepEqual(await push.send(announcement, member(1, null, { pushTokens: ["a", "b"] })), { ok: true, providerId: "captured" });
  assert.deepEqual(await sms.send(announcement, member(2, null, { phoneE164: "+84912345678" })), { ok: true, providerId: "captured" });
  assert.equal(real, 0);
  assert.deepEqual(capturedChannelSends().map((c) => [c.channel, c.memberId, c.to]), [["push", 1, "2 device(s)"], ["sms", 2, "+84912345678"]]);
});

test("this deployment's channels: email, push and SMS, with push and SMS waiting for a sender", () => {
  assert.deepEqual(deploymentChannels().map((c) => [c.id, c.id === "email" ? "-" : c.available()]), [["email", "-"], ["push", false], ["sms", false]]);
  registerPushSender(async () => ({ ok: true }));
  registerSmsSender({ send: async () => ({ ok: true }), isAllowedNumber: () => true });
  assert.deepEqual(deploymentChannels().filter((c) => c.id !== "email").map((c) => c.available()), [true, true]);
  assert.ok(!deploymentChannels().some((c) => c.id === "zalo"), "Zalo isn't built");
});
