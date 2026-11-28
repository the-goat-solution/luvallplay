// Cutover gap B4: player emails link to the players' app once its address is
// set (PLAYER_APP_URL), and to the website exactly as today until then. The
// emails are rendered for real into the captured outbox (never sent off
// production, lib/side-effects.ts).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { playerLink, linksToApp } from "../lib/player-links.ts";
import { sendLoginCodeEmail, sendPlayerNoticeEmail } from "../lib/player-email.ts";
import { notifyPlayerOfReply } from "../lib/message-notify.ts";
import { profileRenewalUrl } from "../lib/membership-renewal.ts";
import { capturedOutbox, clearCapturedOutbox } from "../lib/side-effects.ts";

const KEYS = ["PLAYER_APP_URL", "RESEND_API_KEY", "EMAIL_FROM", "VERCEL_ENV", "TENANT_SLUG", "NEXT_PUBLIC_SITE_URL"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const APP = "https://app.luvallplay.example";
const last = () => capturedOutbox()[capturedOutbox().length - 1];

describe("player email links", () => {
  beforeEach(() => {
    delete process.env.PLAYER_APP_URL;
    delete process.env.VERCEL_ENV;
    process.env.RESEND_API_KEY = "re_captured_never_sent";
    process.env.EMAIL_FROM = "Club <club@links.test>";
    process.env.TENANT_SLUG = "three-wolves";
    clearCapturedOutbox();
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("unset: the website's link, unchanged; set: the app's screen (in this club when asked)", () => {
    assert.equal(linksToApp(), false);
    assert.equal(playerLink("/inbox/4", "https://club.example/profile?thread=4", { club: true }), "https://club.example/profile?thread=4");
    process.env.PLAYER_APP_URL = APP;
    assert.equal(linksToApp(), true);
    assert.equal(playerLink("/signin", "https://club.example/login"), `${APP}/signin`);
    assert.equal(playerLink("/inbox/4", "x", { club: true }), `${APP}/inbox/4?club=three-wolves`);
    assert.equal(playerLink("/membership?card=updated", "x", { club: true }), `${APP}/membership?card=updated&club=three-wolves`);
  });

  test("a malformed address is the same as none: the website's links", () => {
    process.env.PLAYER_APP_URL = "http://app.luvallplay.example";
    assert.equal(linksToApp(), false);
    assert.equal(playerLink("/home", "https://club.example/profile"), "https://club.example/profile");
  });

  test("the club's reply: the inbox thread in the app once set, the website's /profile?thread= until then", async () => {
    await notifyPlayerOfReply({ to: "hana@links.test", lang: "en", threadId: 41, subject: "Shuttles", body: "We have more on Friday." });
    assert.match(last().html, /\/profile\?thread=41/);
    assert.doesNotMatch(last().html, /app\.luvallplay\.example/);
    process.env.PLAYER_APP_URL = APP;
    await notifyPlayerOfReply({ to: "hana@links.test", lang: "vi", threadId: 41, subject: "Cầu", body: "Thứ Sáu có thêm." });
    assert.match(last().html, new RegExp(`${APP.replace(/\./g, "\\.")}/inbox/41\\?club=three-wolves`));
    assert.match(last().text, /\/inbox\/41\?club=three-wolves/);
    assert.doesNotMatch(last().html, /\/profile\?thread=/);
  });

  test("a notice without an app screen keeps its website link either way", async () => {
    process.env.PLAYER_APP_URL = APP;
    await sendPlayerNoticeEmail({ to: "hana@links.test", subject: "s", heading: "h", lines: ["l"], cta: { label: "Open", path: "/shop/orders/7" } });
    assert.match(last().html, /\/shop\/orders\/7/);
    assert.doesNotMatch(last().html, /app\.luvallplay\.example/);
  });

  test("the renewal reminder: the app's Membership screen once set", () => {
    assert.match(profileRenewalUrl("hana@links.test"), /\/login\?email=hana%40links\.test&next=%2Fprofile$/);
    process.env.PLAYER_APP_URL = APP;
    assert.equal(profileRenewalUrl("hana@links.test"), `${APP}/membership?club=three-wolves`);
  });

  test("the sign-in email: with a link, the one-tap button as today; without (the app's, once set), the code alone", async () => {
    await sendLoginCodeEmail({ to: "hana@links.test", code: "123456", linkUrl: "https://club.example/api/auth/email/link?token=t", lang: "en" });
    assert.match(last().html, /api\/auth\/email\/link\?token=t/);
    assert.match(last().text, /The code and button work once/);
    await sendLoginCodeEmail({ to: "hana@links.test", code: "654321", linkUrl: null, lang: "vi" });
    assert.match(last().html, /654321/);
    assert.doesNotMatch(last().html, /api\/auth\/email\/link/);
    assert.doesNotMatch(last().html, /một chạm/, "no 'one tap' line without the button");
    assert.match(last().text, /Mã chỉ dùng được một lần/);
  });
});
