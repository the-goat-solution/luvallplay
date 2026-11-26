// Every email the club sends, word for word (Track A step A2, part 2; audit
// C4). The saved copy (tests/fixtures/email-wording.json) was captured from
// the code BEFORE the club's name, address, locale and currency moved out of
// the email files and into lib/club-brand.ts, so this proves Three Wolves'
// emails read exactly as they did, and it fails on any later change to an
// email's wording (a change members see: it needs the owner's OK).
//
//   UPDATE_EMAIL_WORDING=1 pnpm test    rewrites the saved copy, on purpose
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

process.env.RESEND_API_KEY = "re_test_captured";
process.env.EMAIL_FROM = "club@wording.test";
process.env.NEXT_PUBLIC_SITE_URL = "https://club.wording.test";
delete process.env.VERCEL_ENV;
delete process.env.CLUB_ROSTER_EMAIL;
delete process.env.POSTGRES_URL;

const FIXTURE = new URL("./fixtures/email-wording.json", import.meta.url);

type Sent = { to: string[]; from: string; subject: string; text: string; html: string };

test("every email reads exactly as saved", async () => {
  const { capturedOutbox, clearCapturedOutbox } = await import("../lib/side-effects.ts");
  const e = await import("../lib/email.ts");
  const p = await import("../lib/player-email.ts");
  const { notifyRoleChange } = await import("../lib/admin-notify.ts");
  const m = await import("../lib/message-notify.ts");
  const { renderStatsEmail } = await import("../lib/wolf-vision-email.ts");
  const { renderWelcomeEmail, WELCOME_SUBJECT } = await import("../lib/welcome-email-template.ts");

  const got: Record<string, Sent[] | unknown> = {};
  const run = async (name: string, send: () => Promise<unknown>) => {
    clearCapturedOutbox();
    await send();
    got[name] = capturedOutbox().map(({ to, from, subject, text, html }) => ({ to, from, subject, text, html }));
    assert.ok((got[name] as Sent[]).length > 0, `${name} sent nothing`);
  };

  const mia = "mia@wording.test";
  const when = { sessionTime: "7:00 pm – 9:00 pm", sessionLocation: "Pioneer Stadium" };
  const member = (over: object = {}) => ({ firstName: "Mia", plan: "monthly" as const, day: "friday" as const, priceNzd: 33, recurring: true, periodStart: "2026-11-27", periodEnd: "2026-12-25", delayed: false, ...over });

  await run("roster", () =>
    e.sendRosterEmail("2026-11-27", [
      { bookingId: 1, membershipId: null, name: "Pete Player", firstName: "Pete", email: "pete@wording.test", phone: "021 000 000", type: "casual", method: "card", paymentRef: null },
      { bookingId: null, membershipId: 2, name: "Mia Member", firstName: "Mia", email: mia, phone: null, type: "monthly", method: "cash", paymentRef: "CASH-1", periodStart: "2026-11-20", periodEnd: "2026-12-18" },
    ] as Parameters<typeof e.sendRosterEmail>[1]),
  );
  await run("waitlist confirmation", () => e.sendWaitlistConfirmationEmail(mia, "Mia", "2026-11-27"));
  await run("waitlist confirmation, no date", () => e.sendWaitlistConfirmationEmail(mia, "Mia"));
  await run("waitlist admin alert", () => e.sendWaitlistAdminAlertEmail("Mia Member", mia, "2026-11-27"));
  await run("waitlist spot open", () => e.sendWaitlistSpotOpenEmail(mia, "Mia", "2026-11-27"));
  await run("membership confirmed", () => e.sendMembershipConfirmationEmail(mia, member()));
  await run("membership confirmed, delayed, wednesday, quarterly, one-off", () =>
    e.sendMembershipConfirmationEmail(mia, member({ plan: "quarterly", day: "wednesday", priceNzd: 89.5, recurring: false, delayed: true, miniGameDates: ["2026-12-02"] })),
  );
  await run("membership renewed", () => e.sendMembershipConfirmationEmail(mia, member({ renewal: true })));
  await run("membership reminder", () => e.sendMembershipReminderEmail(mia, { firstName: "Mia", plan: "monthly", day: "friday", tomorrowDate: "2026-11-27", ...when, remainingDates: ["2026-12-04", "2026-12-11"] }));
  await run("membership reminder, last one", () => e.sendMembershipReminderEmail(mia, { firstName: "Mia", plan: "quarterly", day: "wednesday", tomorrowDate: "2026-12-02", sessionTime: null, sessionLocation: null, remainingDates: [] }));
  await run("casual booking confirmed", () => e.sendCasualBookingConfirmationEmail(mia, { firstName: "Mia", sessionDate: "2026-11-27", ...when }));
  await run("fill-in confirmed", () => e.sendFillInConfirmationEmail(mia, { firstName: "Mia", replacing: "Pete", sessionDate: "2026-11-27", ...when }));
  await run("casual booking reminder", () => e.sendCasualBookingReminderEmail(mia, { firstName: "Mia", tomorrowDate: "2026-11-27", ...when }));
  await run("casual booking refunded", () => e.sendCasualBookingFullRefundEmail(mia, { firstName: "Mia", sessionDate: "2026-11-27", amountNzd: 10 }));
  await run("booking race alert, refunded", () => e.sendAdminBookingRaceAlertEmail({ sessionDate: "2026-11-27", customerEmail: mia, paymentIntentId: "pi_wording", refunded: true }));
  await run("booking race alert, not refunded", () => e.sendAdminBookingRaceAlertEmail({ sessionDate: "2026-11-27", customerEmail: mia, paymentIntentId: "pi_wording", refunded: false, cashInvoice: true, errorDetail: "card_declined" }));
  await run("day request, paused", () => e.sendDayRequestConfirmationEmail(mia, "Mia", "Wednesday", true));
  await run("day request, not running", () => e.sendDayRequestConfirmationEmail(mia, "Mia", "Monday", false));
  await run("day request admin alert", () => e.sendDayRequestAdminAlertEmail("Mia Member", mia, "Wednesday"));
  await run("day open", () => e.sendDayOpenEmail(mia, "Mia", "Wednesday"));
  await run("membership renewal reminder", () => e.sendMembershipRenewalReminderEmail(mia, { firstName: "Mia", plan: "monthly", day: "friday", periodEnd: "2026-12-25", renewUrl: "https://club.wording.test/renew-membership?t=x" }));
  for (const lang of ["en", "vi"] as const) {
    await run(`jersey registration (${lang})`, () => e.sendJerseyRegistrationEmail({ to: mia, firstName: "Mia", refCode: "TW-ABC1", priceCents: 4500, earlyBird: true, lang, deadline: new Date("2026-12-01T10:00:00Z") }));
    await run(`jersey paid (${lang})`, () => e.sendJerseyPaidEmail({ to: mia, firstName: "Mia", refCode: "TW-ABC1", paidCents: 4500, priceCents: 4500, lang }));
    await run(`sign-in code (${lang})`, () => p.sendLoginCodeEmail({ to: mia, code: "123456", linkUrl: "https://club.wording.test/login/verify?t=x", lang }));
    await run(`reply to a message (${lang})`, () => m.notifyPlayerOfReply({ to: mia, lang, threadId: 7, subject: "Friday", body: "See you there." }));
  }
  await run("jersey registration, no deadline, full price", () => e.sendJerseyRegistrationEmail({ to: mia, firstName: "Mia", refCode: "TW-ABC1", priceCents: 5500, earlyBird: false, deadline: null }));
  await run("jersey part paid", () => e.sendJerseyPaidEmail({ to: mia, firstName: "Mia", refCode: "TW-ABC1", paidCents: 2000, priceCents: 4500 }));
  await run("jersey admin alert", () => e.sendJerseyAdminAlertEmail({ name: "Mia Member", email: mia, refCode: "TW-ABC1", flags: ["Underpaid by $25"] }));
  await run("welcome", () => p.sendWelcomeEmail({ to: mia, firstName: "Mia", optOutUrl: "https://club.wording.test/profile/settings?optout=x" }));
  await run("admin alert", () => p.sendAdminAlertEmail({ subject: "A thing happened", heading: "Something to look at", lines: ["One", "Two"], cta: { label: "Open", path: "/admin" } }));
  await run("player notice", () => p.sendPlayerNoticeEmail({ to: mia, subject: "A notice", heading: "For you", lines: ["One"], cta: { label: "Open", path: "/profile" } }));
  await run("message to admins", () => m.notifyAdminsOfPlayerMessage({ threadId: 7, playerName: "Mia Member", playerEmail: mia, subject: "Friday", body: "Is it on?" }));
  for (const [name, role, invited] of [["made admin", "admin", false], ["invited as coach", "coach", true], ["made owner", "owner", false], ["removed", null, false]] as const) {
    await run(`role change: ${name}`, () => notifyRoleChange({ email: mia, name: "Mia Member", role, invited, by: "Olivia Owner", ownerEmails: ["olivia@wording.test"] }));
  }
  got["welcome template"] = { subject: WELCOME_SUBJECT, ...renderWelcomeEmail({ to: mia, firstName: "Mia", optOutUrl: "https://club.wording.test/optout", siteUrl: "https://club.wording.test/" }) };
  got["match stats"] = renderStatsEmail({
    siteUrl: "https://club.wording.test/",
    recipientName: "Mia",
    recipientIndex: 2,
    recordedBy: "Pete P.",
    playedAt: "Fri 27 Nov 2026, 7:40 pm",
    teams: ["Pete & Kim", "Mia & Bo"],
    duration: 1325,
    rallies: 31,
    longestRally: 18,
    avgRallyShots: 6.4,
    fastestShotKmh: 212,
    freeUntil: "28 February 2027",
    players: [
      { name: "Pete P.", team: 0, hits: 41, distance: 812.4, topSpeed: 5.2 },
      { name: "Kim T.", team: 0, hits: 38, distance: 760, topSpeed: 4.9 },
      { name: "Mia", team: 1, hits: 44, distance: 901.25, topSpeed: 5.6 },
      { name: "Bo", team: 1, hits: 35, distance: 700, topSpeed: 4.4 },
    ],
  });

  if (process.env.UPDATE_EMAIL_WORDING === "1" || !existsSync(FIXTURE)) {
    writeFileSync(FIXTURE, `${JSON.stringify(got, null, 1)}\n`);
    return;
  }
  const saved = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(got).sort(), Object.keys(saved).sort(), "the same emails as saved");
  for (const name of Object.keys(saved)) assert.deepEqual(got[name], saved[name], `"${name}" reads differently from the saved copy`);
});
