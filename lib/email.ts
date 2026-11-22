import { Resend } from "resend";
import { capturingResend, sideEffectAllowed } from "./side-effects.ts";
import type { RosterEntry } from "./db";
import type { MembershipDay, MembershipTier } from "./constants";
import { BANK_ACCOUNT_NAME, BANK_ACCOUNT_NUMBER } from "./jersey";
import {
  contactFooterNote,
  contactFooterNoteText,
  ctaButton,
  escapeHtml,
  formatEmailDate,
  getSiteUrl,
  heading,
  paragraph,
  renderEmailLayout,
  withDisplayName,
} from "./email-layout";

let resend: Resend | null = null;

export function getResend(): Resend {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  // Outside production every email is captured, never sent (lib/side-effects.ts).
  if (!sideEffectAllowed("email")) return capturingResend() as unknown as Resend;
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const PLAN_LABEL: Record<RosterEntry["type"], string> = {
  casual: "Casual",
  monthly: "Monthly member",
  quarterly: "Quarterly member",
};

const PLAN_NAME: Record<MembershipTier, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
};

const DAY_LABEL: Record<MembershipDay, string> = {
  friday: "Friday",
  wednesday: "Wednesday",
};

export async function sendRosterEmail(
  date: string,
  roster: RosterEntry[],
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  const to = process.env.CLUB_ROSTER_EMAIL || "threewolvesbadminton@gmail.com";
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  // A player with a stand-in is listed as their stand-in: whoever runs the
  // door needs the name and number of the person actually turning up, with
  // the absent member named only so the spot can still be accounted for.
  // Members also show when their membership started (and when it ends, unless
  // it auto-renews), so it's clear why they're on this play day.
  const memberWindow = (p: RosterEntry): string =>
    p.type === "casual" || !p.periodStart
      ? ""
      : ` · since ${formatEmailDate(p.periodStart)}${
          p.autoRenews || !p.periodEnd ? "" : `, until ${formatEmailDate(p.periodEnd)}`
        }`;

  const rows = roster
    .map((p) => {
      const cell = (content: string) =>
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e0cf">${content}</td>`;
      if (p.fillIn) {
        return `<tr>
          ${cell(`${escapeHtml(p.fillIn.name)}<br /><span style="font-size:12px;color:#6b6b6b">filling in for ${escapeHtml(p.name)}</span>`)}
          ${cell(escapeHtml(p.fillIn.email))}
          ${cell(escapeHtml(p.fillIn.phone ?? ""))}
          ${cell(`${PLAN_LABEL[p.type]} (fill-in)${escapeHtml(memberWindow(p))}`)}
        </tr>`;
      }
      return `<tr>
          ${cell(escapeHtml(p.name))}
          ${cell(escapeHtml(p.email))}
          ${cell(escapeHtml(p.phone ?? ""))}
          ${cell(`${PLAN_LABEL[p.type]}${escapeHtml(memberWindow(p))}`)}
        </tr>`;
    })
    .join("");

  const bodyHtml = `
    ${heading(`Play day roster — ${date}`)}
    ${paragraph(`<strong>${roster.length}</strong> player${roster.length === 1 ? "" : "s"} signed up.`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="text-align:left;border-bottom:2px solid #184467">
          <th style="padding:8px 10px">Name</th><th style="padding:8px 10px">Email</th><th style="padding:8px 10px">Phone</th><th style="padding:8px 10px">Type</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:10px">No signups yet.</td></tr>`}</tbody>
    </table>
  `;

  const text = [
    `Play day roster — ${date}`,
    `${roster.length} player${roster.length === 1 ? "" : "s"} signed up.`,
    "",
    ...roster.map((p) =>
      p.fillIn
        ? `${p.fillIn.name} <${p.fillIn.email}> ${p.fillIn.phone ?? ""} — ${PLAN_LABEL[p.type]} (filling in for ${p.name})${memberWindow(p)}`
        : `${p.name} <${p.email}> ${p.phone ?? ""} — ${PLAN_LABEL[p.type]}${memberWindow(p)}`,
    ),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `Three Wolves play day roster — ${date} (${roster.length})`,
    html: renderEmailLayout({ title: `Play day roster — ${date}`, bodyHtml }),
    text,
  });
}

export async function sendWaitlistConfirmationEmail(
  to: string,
  name: string,
  sessionDate?: string,
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const forDate = sessionDate ? ` for ${escapeHtml(formatEmailDate(sessionDate))}` : "";
  const forDateText = sessionDate ? ` for ${formatEmailDate(sessionDate)}` : "";

  const bodyHtml = `
    ${heading("You're on the waitlist")}
    ${paragraph(`Hi ${escapeHtml(name)},`)}
    ${paragraph(`Thanks for your patience — you're on the waitlist${forDate} at Three Wolves Badminton Club. We'll email you the moment a spot opens up, no payment required until then.`)}
    ${contactFooterNote()}
  `;
  const text = [
    `Hi ${name},`,
    "",
    `Thanks for your patience — you're on the waitlist${forDateText} at Three Wolves Badminton Club. We'll email you as soon as a spot opens up, no payment required until then.`,
    "",
    contactFooterNoteText(),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `You're on the waitlist — Three Wolves Badminton Club${forDateText}`,
    html: renderEmailLayout({ title: "You're on the waitlist", bodyHtml }),
    text,
  });
}

export async function sendWaitlistAdminAlertEmail(
  name: string,
  email: string,
  sessionDate?: string,
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  const to = process.env.CLUB_ROSTER_EMAIL || "threewolvesbadminton@gmail.com";
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const forDate = sessionDate ?? "an unspecified play day";

  const bodyHtml = `
    ${heading("New waitlist signup")}
    ${paragraph(`<strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) joined the waitlist for ${escapeHtml(forDate)}.`)}
  `;
  const text = `${name} (${email}) joined the waitlist for ${forDate}.`;

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `New waitlist signup — ${forDate}`,
    html: renderEmailLayout({ title: "New waitlist signup", bodyHtml }),
    text,
  });
}

// A spot opened up for a date someone was waitlisted on — best-effort
// notification fired from lib/waitlist-notify.ts. Links straight to the
// schedule section so they can book immediately (first-come-first-served —
// this does NOT reserve anything for them).
export async function sendWaitlistSpotOpenEmail(
  to: string,
  name: string,
  sessionDate: string,
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const bookUrl = `${getSiteUrl()}/#schedule`;
  const displayDate = formatEmailDate(sessionDate);

  const bodyHtml = `
    ${heading("A spot just opened up!")}
    ${paragraph(`Hi ${escapeHtml(name)},`)}
    ${paragraph(`Good news — a spot has opened up for <strong>${escapeHtml(displayDate)}</strong> at Three Wolves Badminton Club. Spots go first-come, first-served, so grab it while it's open!`)}
    ${ctaButton("Book your spot", bookUrl)}
    ${contactFooterNote()}
  `;
  const text = [
    `Hi ${name},`,
    "",
    `Good news — a spot has opened up for ${displayDate} at Three Wolves Badminton Club. Spots go first-come, first-served — book now: ${bookUrl}`,
    "",
    contactFooterNoteText(),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `A spot opened up — ${displayDate} — Three Wolves Badminton Club`,
    html: renderEmailLayout({ title: "A spot opened up", bodyHtml }),
    text,
  });
}

export async function sendMembershipConfirmationEmail(
  to: string,
  input: {
    firstName: string;
    plan: MembershipTier;
    day: MembershipDay;
    priceNzd: number;
    recurring: boolean;
    periodStart: string;
    periodEnd: string;
    delayed: boolean;
    /** A paid renewal of an earlier one-time membership. */
    renewal?: boolean;
  },
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const planName = PLAN_NAME[input.plan];
  const dayName = DAY_LABEL[input.day];
  const planTitle = `${planName} (${dayName})`;
  const billingNote = input.recurring
    ? `renews automatically every ${input.plan === "monthly" ? "4 weeks" : "12 weeks"}`
    : "a single, one-time payment";
  const displayStart = formatEmailDate(input.periodStart);
  const displayEnd = formatEmailDate(input.periodEnd);

  const accessParagraph = input.renewal
    ? paragraph(
        `You were charged <strong>NZD $${input.priceNzd.toFixed(2)}</strong> today. Your renewed membership picks up on <strong>${escapeHtml(displayStart)}</strong>, right after your current one — no gap, no need to book sessions.`,
      )
    : input.delayed
    ? paragraph(
        `You were charged <strong>NZD $${input.priceNzd.toFixed(2)}</strong> today. There wasn't an open spot on the very next ${dayName} session, so your membership access starts on <strong>${escapeHtml(displayStart)}</strong> — the next ${dayName} session with room. You were charged today either way; your access simply begins then.`,
      )
    : paragraph(
        `You were charged <strong>NZD $${input.priceNzd.toFixed(2)}</strong> today, and your membership is active immediately — you're welcome at every ${dayName} session from now through <strong>${escapeHtml(displayEnd)}</strong>.`,
      );

  const greeting = input.renewal
    ? `Thanks for renewing, ${input.firstName}!`
    : `Welcome to Three Wolves, ${input.firstName}!`;
  const intro = input.renewal
    ? `Your <strong>${planTitle}</strong> membership is renewed (${billingNote}).`
    : `We're so glad to have you — your <strong>${planTitle}</strong> membership is confirmed (${billingNote}).`;

  const bodyHtml = `
    ${heading(greeting)}
    ${paragraph(intro)}
    ${accessParagraph}
    ${paragraph(`Membership window: <strong>${escapeHtml(displayStart)}</strong> to <strong>${escapeHtml(displayEnd)}</strong>. You can show up to any ${dayName} session in that window — no need to book individual sessions. See you on court!`)}
    ${contactFooterNote()}
  `;
  const text = [
    greeting,
    "",
    intro.replace(/<\/?strong>/g, ""),
    "",
    input.renewal
      ? `You were charged NZD $${input.priceNzd.toFixed(2)} today. Your renewed membership picks up on ${displayStart}, right after your current one.`
      : input.delayed
      ? `You were charged NZD $${input.priceNzd.toFixed(2)} today. There wasn't an open spot on the very next ${dayName} session, so your membership access starts on ${displayStart} — the next ${dayName} session with room.`
      : `You were charged NZD $${input.priceNzd.toFixed(2)} today, and your membership is active immediately.`,
    "",
    `Membership window: ${displayStart} to ${displayEnd}. See you on court!`,
    "",
    contactFooterNoteText(),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: input.renewal
      ? `Membership renewed — ${planTitle} — Three Wolves Badminton Club`
      : `Welcome to Three Wolves — ${planTitle} membership confirmed`,
    html: renderEmailLayout({ title: "Membership confirmed", bodyHtml }),
    text,
  });
}

export async function sendMembershipReminderEmail(
  to: string,
  input: {
    firstName: string;
    plan: MembershipTier;
    day: MembershipDay;
    tomorrowDate: string;
    sessionTime: string | null;
    sessionLocation: string | null;
    remainingDates: string[];
  },
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const dayName = DAY_LABEL[input.day];
  const planTitle = `${PLAN_NAME[input.plan]} (${dayName})`;
  const displayDate = formatEmailDate(input.tomorrowDate);
  const location = input.sessionLocation || "Graham Condon Recreation and Sport Centre";
  const whenWhere = input.sessionTime
    ? `at <strong>${escapeHtml(input.sessionTime)}</strong>, ${escapeHtml(location)}`
    : escapeHtml(location);
  const whenWhereText = input.sessionTime
    ? `at ${input.sessionTime}, ${location}`
    : location;

  const otherDates = input.remainingDates.filter(
    (d) => d !== input.tomorrowDate,
  );
  const remainingListHtml =
    otherDates.length > 0
      ? `
        ${paragraph(`Your other remaining ${dayName} sessions this membership period:`)}
        <ul style="margin:0 0 16px;padding-left:20px;color:#3a526a">
          ${otherDates.map((d) => `<li style="margin-bottom:4px">${escapeHtml(formatEmailDate(d))}</li>`).join("")}
        </ul>
      `
      : "";

  const bodyHtml = `
    ${heading("See you tomorrow!")}
    ${paragraph(`Hi ${escapeHtml(input.firstName)}, just a friendly reminder that you're on for play tomorrow, <strong>${escapeHtml(displayDate)}</strong>, ${whenWhere} — on your ${planTitle} membership.`)}
    ${remainingListHtml}
    ${paragraph("Grab your racket and we'll see you on court!")}
    ${contactFooterNote()}
  `;
  const text = [
    `Hi ${input.firstName}, just a friendly reminder that you're on for play tomorrow, ${displayDate}, ${whenWhereText} — on your ${planTitle} membership.`,
    ...(otherDates.length > 0
      ? ["", `Your other remaining ${dayName} sessions this membership period:`, ...otherDates.map((d) => `- ${formatEmailDate(d)}`)]
      : []),
    "",
    "Grab your racket and we'll see you on court!",
    "",
    contactFooterNoteText(),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `Reminder: you're playing tomorrow, ${displayDate}`,
    html: renderEmailLayout({ title: "See you tomorrow!", bodyHtml }),
    text,
  });
}

export async function sendCasualBookingConfirmationEmail(
  to: string,
  input: {
    firstName: string;
    sessionDate: string;
    sessionTime: string | null;
    sessionLocation: string | null;
  },
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const displayDate = formatEmailDate(input.sessionDate);
  const location = input.sessionLocation || "Graham Condon Recreation and Sport Centre";
  const whenWhere = input.sessionTime
    ? `at <strong>${escapeHtml(input.sessionTime)}</strong>, ${escapeHtml(location)}`
    : escapeHtml(location);
  const whenWhereText = input.sessionTime
    ? `at ${input.sessionTime}, ${location}`
    : location;

  const accountUrl = `${getSiteUrl()}/login?email=${encodeURIComponent(to)}&next=/profile`;
  const bodyHtml = `
    ${heading("You're confirmed!")}
    ${paragraph(`Hi ${escapeHtml(input.firstName)}, you're booked in for play on <strong>${escapeHtml(displayDate)}</strong>, ${whenWhere}.`)}
    ${paragraph("Grab your racket and we'll see you on court!")}
    ${paragraph("<strong>Make it yours:</strong> create a free Three Wolves account to track your play days, climb the leaderboard and share photos. One tap, no password.")}
    ${ctaButton("Create my account", accountUrl)}
    ${contactFooterNote()}
  `;
  const text = [
    `Hi ${input.firstName}, you're booked in for play on ${displayDate}, ${whenWhereText}.`,
    "",
    "Grab your racket and we'll see you on court!",
    "",
    `Create a free Three Wolves account (track your play days, climb the leaderboard, share photos): ${accountUrl}`,
    "",
    contactFooterNoteText(),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `You're confirmed — ${displayDate} — Three Wolves Badminton Club`,
    html: renderEmailLayout({ title: "You're confirmed!", bodyHtml }),
    text,
  });
}

// Sent to someone standing in for a member who can't make a session. Their
// spot is already paid for by the member, so this deliberately says nothing
// about payment — it's just the where and when.
export async function sendFillInConfirmationEmail(
  to: string,
  input: {
    firstName: string;
    replacing: string;
    sessionDate: string;
    sessionTime: string | null;
    sessionLocation: string | null;
  },
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const displayDate = formatEmailDate(input.sessionDate);
  const location =
    input.sessionLocation || "Graham Condon Recreation and Sport Centre";
  const whenWhere = input.sessionTime
    ? `at <strong>${escapeHtml(input.sessionTime)}</strong>, ${escapeHtml(location)}`
    : escapeHtml(location);
  const whenWhereText = input.sessionTime
    ? `at ${input.sessionTime}, ${location}`
    : location;

  const bodyHtml = `
    ${heading("You're on the list!")}
    ${paragraph(`Hi ${escapeHtml(input.firstName)}, you're filling in for <strong>${escapeHtml(input.replacing)}</strong> on <strong>${escapeHtml(displayDate)}</strong>, ${whenWhere}.`)}
    ${paragraph("Their spot is already covered, so there's nothing to pay. Just bring your racket and we'll see you on court!")}
    ${contactFooterNote()}
  `;
  const text = [
    `Hi ${input.firstName}, you're filling in for ${input.replacing} on ${displayDate}, ${whenWhereText}.`,
    "",
    "Their spot is already covered, so there's nothing to pay. Just bring your racket and we'll see you on court!",
    "",
    contactFooterNoteText(),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `You're filling in — ${displayDate} — Three Wolves Badminton Club`,
    html: renderEmailLayout({ title: "You're on the list!", bodyHtml }),
    text,
  });
}

export async function sendCasualBookingReminderEmail(
  to: string,
  input: {
    firstName: string;
    tomorrowDate: string;
    sessionTime: string | null;
    sessionLocation: string | null;
  },
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const displayDate = formatEmailDate(input.tomorrowDate);
  const location = input.sessionLocation || "Graham Condon Recreation and Sport Centre";
  const whenWhere = input.sessionTime
    ? `at <strong>${escapeHtml(input.sessionTime)}</strong>, ${escapeHtml(location)}`
    : escapeHtml(location);
  const whenWhereText = input.sessionTime
    ? `at ${input.sessionTime}, ${location}`
    : location;

  const bodyHtml = `
    ${heading("See you tomorrow!")}
    ${paragraph(`Hi ${escapeHtml(input.firstName)}, just a friendly reminder that you're on for play tomorrow, <strong>${escapeHtml(displayDate)}</strong>, ${whenWhere}.`)}
    ${paragraph("Grab your racket and we'll see you on court!")}
    ${contactFooterNote()}
  `;
  const text = [
    `Hi ${input.firstName}, just a friendly reminder that you're on for play tomorrow, ${displayDate}, ${whenWhereText}.`,
    "",
    "Grab your racket and we'll see you on court!",
    "",
    contactFooterNoteText(),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `Reminder: you're playing tomorrow, ${displayDate}`,
    html: renderEmailLayout({ title: "See you tomorrow!", bodyHtml }),
    text,
  });
}

export async function sendCasualBookingFullRefundEmail(
  to: string,
  input: { firstName: string; sessionDate: string; amountNzd: number },
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const displayDate = formatEmailDate(input.sessionDate);

  const bodyHtml = `
    ${heading("Your session sold out — refund issued")}
    ${paragraph(`Hi ${escapeHtml(input.firstName)},`)}
    ${paragraph(`We're sorry — the play day on <strong>${escapeHtml(displayDate)}</strong> filled up in the moments between your payment and confirmation, so you have <strong>not</strong> secured a spot.`)}
    ${paragraph(`We've refunded your <strong>NZD $${input.amountNzd.toFixed(2)}</strong> in full. It can take 5–10 business days to appear back on your card, depending on your bank.`)}
    ${paragraph("Sorry again for the mix-up — please feel free to book another play day, or join the waitlist for this one and we'll email you the moment a spot frees up.")}
    ${contactFooterNote()}
  `;
  const text = [
    `Hi ${input.firstName},`,
    "",
    `We're sorry — the play day on ${displayDate} filled up in the moments between your payment and confirmation, so you have not secured a spot.`,
    "",
    `We've refunded your NZD $${input.amountNzd.toFixed(2)} in full. It can take 5-10 business days to appear back on your card, depending on your bank.`,
    "",
    "Sorry again for the mix-up — please feel free to book another play day, or join the waitlist for this one.",
    "",
    contactFooterNoteText(),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `Refund issued — ${displayDate} sold out — Three Wolves Badminton Club`,
    html: renderEmailLayout({ title: "Refund issued", bodyHtml }),
    text,
  });
}

// Internal alert for the casual-booking race condition (session filled
// between PaymentIntent creation and payment confirmation) — always sent to
// the club regardless of whether the automatic refund succeeded, so a
// failed refund is never only visible in a server log.
export async function sendAdminBookingRaceAlertEmail(input: {
  sessionDate: string;
  customerEmail: string;
  paymentIntentId: string;
  refunded: boolean;
  cashInvoice?: boolean;
  errorDetail?: string;
}): Promise<void> {
  const from = process.env.EMAIL_FROM;
  const to = process.env.CLUB_ROSTER_EMAIL || "threewolvesbadminton@gmail.com";
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const statusLine = input.cashInvoice
    ? "This was a cash invoice (paid out-of-band) — it cannot be auto-refunded via Stripe. Please reconcile with the customer manually."
    : input.refunded
      ? "The customer's card was automatically refunded in full."
      : "AUTOMATIC REFUND FAILED — please refund this customer manually in the Stripe dashboard as soon as possible.";

  const bodyHtml = `
    ${heading("Booking race — session oversold")}
    ${paragraph(`A ${input.cashInvoice ? "cash invoice" : "payment"} for <strong>${escapeHtml(input.sessionDate)}</strong> succeeded after the session had already filled.`)}
    ${paragraph(`Customer: <strong>${escapeHtml(input.customerEmail)}</strong><br/>Payment reference: <code>${escapeHtml(input.paymentIntentId)}</code>`)}
    ${paragraph(`<strong>${statusLine}</strong>`)}
    ${input.errorDetail ? paragraph(`Error detail: ${escapeHtml(input.errorDetail)}`) : ""}
  `;
  const text = [
    `A ${input.cashInvoice ? "cash invoice" : "payment"} for ${input.sessionDate} succeeded after the session had already filled.`,
    `Customer: ${input.customerEmail}`,
    `Payment reference: ${input.paymentIntentId}`,
    statusLine,
    input.errorDetail ? `Error detail: ${input.errorDetail}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `⚠ Booking race — ${input.sessionDate} oversold${input.refunded ? "" : " — ACTION NEEDED"}`,
    html: renderEmailLayout({ title: "Booking race alert", bodyHtml }),
    text,
  });
}

// Someone asked to be emailed when a weekday opens up — `paused` says whether
// it's a day we normally run that's temporarily paused, or a brand-new day.
export async function sendDayRequestConfirmationEmail(
  to: string,
  name: string,
  dayLabel: string,
  paused: boolean,
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const message = paused
    ? `${dayLabel} sessions at Three Wolves Badminton Club are temporarily paused. You're on the list — we'll email you as soon as ${dayLabel} sign-ups are back.`
    : `Thanks for letting us know you'd like to play on ${dayLabel}s. You're on the list — if we open up ${dayLabel} sessions, you'll be the first to hear about it.`;

  const bodyHtml = `
    ${heading("You're on the list")}
    ${paragraph(`Hi ${escapeHtml(name)},`)}
    ${paragraph(escapeHtml(message))}
    ${contactFooterNote()}
  `;
  const text = [`Hi ${name},`, "", message, "", contactFooterNoteText()].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `We'll let you know about ${dayLabel} sessions — Three Wolves Badminton Club`,
    html: renderEmailLayout({ title: "You're on the list", bodyHtml }),
    text,
  });
}

export async function sendDayRequestAdminAlertEmail(
  name: string,
  email: string,
  dayLabel: string,
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  const to = process.env.CLUB_ROSTER_EMAIL || "threewolvesbadminton@gmail.com";
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const bodyHtml = `
    ${heading("New play day request")}
    ${paragraph(`<strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) asked to be notified when ${escapeHtml(dayLabel)} sessions open.`)}
  `;
  const text = `${name} (${email}) asked to be notified when ${dayLabel} sessions open.`;

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `New ${dayLabel} session request`,
    html: renderEmailLayout({ title: "New play day request", bodyHtml }),
    text,
  });
}

// Sent from /admin/day-requests when the club opens (or reopens) a weekday.
export async function sendDayOpenEmail(
  to: string,
  name: string,
  dayLabel: string,
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const url = `${getSiteUrl()}/#schedule`;

  const bodyHtml = `
    ${heading(`${dayLabel} sessions are open!`)}
    ${paragraph(`Hi ${escapeHtml(name)},`)}
    ${paragraph(`Good news — you asked us to let you know, and <strong>${escapeHtml(dayLabel)}</strong> sessions at Three Wolves Badminton Club are now open for sign-ups. Spots go first-come, first-served.`)}
    ${ctaButton("See sessions & sign up", url)}
    ${contactFooterNote()}
  `;
  const text = [
    `Hi ${name},`,
    "",
    `Good news — you asked us to let you know, and ${dayLabel} sessions at Three Wolves Badminton Club are now open for sign-ups. Spots go first-come, first-served: ${url}`,
    "",
    contactFooterNoteText(),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `${dayLabel} sessions are open — Three Wolves Badminton Club`,
    html: renderEmailLayout({ title: `${dayLabel} sessions are open`, bodyHtml }),
    text,
  });
}

// Sent by the daily reminders cron 5 days before a one-time membership ends.
// The link carries the membership's private renewal token, which is what
// opens renewal for this member (see app/renew-membership).
export async function sendMembershipRenewalReminderEmail(
  to: string,
  input: {
    firstName: string;
    plan: MembershipTier;
    day: MembershipDay;
    periodEnd: string;
    renewUrl: string;
  },
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const planTitle = `${PLAN_NAME[input.plan]} (${DAY_LABEL[input.day]})`;
  const displayEnd = formatEmailDate(input.periodEnd);

  const bodyHtml = `
    ${heading("Your membership is ending soon")}
    ${paragraph(`Hi ${escapeHtml(input.firstName)},`)}
    ${paragraph(`Your <strong>${planTitle}</strong> membership at Three Wolves Badminton Club ends on <strong>${escapeHtml(displayEnd)}</strong>.`)}
    ${paragraph(`Renewal is now open for you. Renew before it ends and your next membership starts straight after this one, so you keep your spot on court.`)}
    ${ctaButton("Renew my membership", input.renewUrl)}
    ${paragraph(`Not renewing? No action needed — your membership simply ends on ${escapeHtml(displayEnd)}.`)}
    ${contactFooterNote()}
  `;
  const text = [
    `Hi ${input.firstName},`,
    "",
    `Your ${planTitle} membership at Three Wolves Badminton Club ends on ${displayEnd}.`,
    "",
    `Renewal is now open for you. Renew before it ends and your next membership starts straight after this one: ${input.renewUrl}`,
    "",
    `Not renewing? No action needed — your membership simply ends on ${displayEnd}.`,
    "",
    contactFooterNoteText(),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: `Your ${planTitle} membership ends ${displayEnd} — renew now`,
    html: renderEmailLayout({ title: "Your membership is ending soon", bodyHtml }),
    text,
  });
}

// ── Club jersey ─────────────────────────────────────────────────────────

function jerseyFrom(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not configured");
  return from;
}

export async function sendJerseyRegistrationEmail(input: {
  to: string;
  firstName: string;
  refCode: string;
  priceCents: number;
  earlyBird: boolean;
  lang?: "en" | "vi";
  deadline: Date | null;
}): Promise<void> {
  const vi = input.lang === "vi";
  const price = `$${(input.priceCents / 100).toFixed(2)}`;
  const deadline = input.deadline
    ? new Intl.DateTimeFormat(vi ? "vi-VN" : "en-NZ", {
        timeZone: "Pacific/Auckland",
        dateStyle: "full",
        timeStyle: "short",
      }).format(input.deadline)
    : null;
  const holdNote = input.earlyBird && deadline
    ? vi
      ? `Giá ưu đãi của bạn được giữ đến <strong>${escapeHtml(deadline)}</strong>. Nếu chưa nhận được thanh toán trước thời điểm đó, suất của bạn sẽ chuyển cho người kế tiếp.`
      : `Your early-bird price is held until <strong>${escapeHtml(deadline)}</strong>. If we haven't received payment by then, your spot goes to the next person.`
    : "";
  const holdText = holdNote.replace(/<[^>]+>/g, "");
  const code = escapeHtml(input.refCode);

  const T = vi
    ? {
        title: "Đăng ký áo đấu CLB",
        h: "Bạn đã đăng ký áo đấu của CLB",
        intro: `Xin chào ${escapeHtml(input.firstName)}, cảm ơn bạn đã đăng ký! Để giữ áo, vui lòng chuyển khoản <strong>${price}</strong> vào:`,
        codeLabel: "Mã tham chiếu của bạn",
        must: `<strong>Vui lòng ghi ${code} vào ô nội dung (reference) khi chuyển khoản.</strong> Nhờ mã này chúng tôi mới đối chiếu được khoản thanh toán của bạn — nếu thiếu mã, chúng tôi có thể không tìm thấy giao dịch và bạn có thể mất suất.`,
        rules:
          "Nếu bạn chuyển dư, phần chênh lệch sẽ thuộc về quỹ CLB — xin cảm ơn! Rất tiếc chúng tôi không hoàn tiền. Áo dự kiến về khoảng đầu tháng 11 và sẽ được phát vào một buổi chơi, thời gian sẽ thông báo sau.",
        subject: `Mã tham chiếu áo đấu của bạn: ${input.refCode} — Three Wolves Badminton Club`,
        text: [
          `Xin chào ${input.firstName}, cảm ơn bạn đã đăng ký áo đấu CLB!`,
          "",
          `Vui lòng chuyển khoản ${price} vào ${BANK_ACCOUNT_NAME}, số tài khoản ${BANK_ACCOUNT_NUMBER}.`,
          `Mã tham chiếu: ${input.refCode}`,
          "",
          `Vui lòng ghi ${input.refCode} vào ô nội dung (reference). Nếu thiếu mã, chúng tôi có thể không tìm thấy giao dịch và bạn có thể mất suất.`,
          holdText,
          "Số tiền chuyển dư thuộc về quỹ CLB (xin cảm ơn!). Không hoàn tiền.",
          "Áo dự kiến về khoảng đầu tháng 11 và sẽ được phát vào một buổi chơi, thời gian sẽ thông báo sau.",
        ],
      }
    : {
        title: "Club jersey registration",
        h: "You're registered for the club jersey",
        intro: `Hi ${escapeHtml(input.firstName)}, thanks for registering! To secure your jersey, please transfer <strong>${price}</strong> to:`,
        codeLabel: "Your reference code",
        must: `<strong>Please put ${code} in the reference field of your transfer.</strong> It's how we match your payment to you — without it we may not be able to find your transfer and you could lose your spot.`,
        rules:
          "If you send more than the price, the difference goes to the club's funds — thank you! Sorry, we can't offer refunds. Jerseys arrive around early November and will be handed out at a play day, to be announced.",
        subject: `Your jersey reference code: ${input.refCode} — Three Wolves Badminton Club`,
        text: [
          `Hi ${input.firstName}, thanks for registering for the club jersey!`,
          "",
          `Please transfer ${price} to ${BANK_ACCOUNT_NAME}, ${BANK_ACCOUNT_NUMBER}.`,
          `Reference code: ${input.refCode}`,
          "",
          `Please put ${input.refCode} in the reference field. Without it we may not be able to find your transfer and you could lose your spot.`,
          holdText,
          "Any amount over the price goes to club funds (thank you!). No refunds.",
          "Jerseys arrive around early November and will be handed out at a play day, to be announced.",
        ],
      };

  const bodyHtml = `
    ${heading(T.h)}
    ${paragraph(T.intro)}
    ${paragraph(`<strong>${escapeHtml(BANK_ACCOUNT_NAME)}</strong><br/>${escapeHtml(BANK_ACCOUNT_NUMBER)}`)}
    <div style="margin:8px 0 20px;padding:18px;text-align:center;background:#fff;border:2px dashed #C4892A;border-radius:12px">
      <div style="font-size:13px;color:#3a526a">${T.codeLabel}</div>
      <div style="font-size:38px;font-weight:800;letter-spacing:.2em;color:#184467">${code}</div>
    </div>
    ${paragraph(T.must)}
    ${holdNote ? paragraph(holdNote) : ""}
    ${paragraph(T.rules)}
    ${contactFooterNote()}
  `;
  const text = [...T.text, "", contactFooterNoteText()].join("\n");

  await getResend().emails.send({
    from: withDisplayName(jerseyFrom()),
    to: input.to,
    subject: T.subject,
    html: renderEmailLayout({ title: T.title, bodyHtml }),
    text,
  });
}

export async function sendJerseyPaidEmail(input: {
  to: string;
  firstName: string;
  refCode: string;
  paidCents: number;
  priceCents: number;
  lang?: "en" | "vi";
}): Promise<void> {
  const vi = input.lang === "vi";
  const extra = input.paidCents - input.priceCents;
  const extraAmt = `$${(extra / 100).toFixed(2)}`;
  const T = vi
    ? {
        h: "Đã nhận thanh toán — bạn đã có áo!",
        p: `Xin chào ${escapeHtml(input.firstName)}, chúng tôi đã nhận được thanh toán cho áo mã ${escapeHtml(input.refCode)}. Áo của bạn đã được xác nhận.`,
        extra: `Bạn đã chuyển dư ${extraAmt} so với giá áo. Số tiền này thuộc về quỹ CLB — cảm ơn bạn đã ủng hộ!`,
        pick: "Áo dự kiến về khoảng đầu tháng 11 và sẽ được phát vào một buổi chơi, thời gian sẽ thông báo sau. Mặc áo đến House of Barber để được giảm 10% khi cắt tóc!",
        subject: "Đã nhận thanh toán áo đấu — Three Wolves Badminton Club",
        title: "Đã nhận thanh toán",
        first: `Xin chào ${input.firstName}, chúng tôi đã nhận được thanh toán cho áo mã ${input.refCode}. Áo của bạn đã được xác nhận.`,
      }
    : {
        h: "Payment received — you're in!",
        p: `Hi ${escapeHtml(input.firstName)}, we've received your payment for jersey ${escapeHtml(input.refCode)}. Your jersey is confirmed.`,
        extra: `You sent ${extraAmt} more than the price. That goes to the club's funds — thank you for the support!`,
        pick: "Jerseys arrive around early November and will be handed out at a play day, to be announced. Wear it to House of Barber for 10% off a haircut!",
        subject: "Jersey payment received — Three Wolves Badminton Club",
        title: "Payment received",
        first: `Hi ${input.firstName}, we've received your payment for jersey ${input.refCode}. Your jersey is confirmed.`,
      };
  const bodyHtml = `
    ${heading(T.h)}
    ${paragraph(T.p)}
    ${extra > 0 ? paragraph(T.extra) : ""}
    ${paragraph(T.pick)}
    ${contactFooterNote()}
  `;
  const text = [T.first, extra > 0 ? T.extra : "", T.pick, "", contactFooterNoteText()].join("\n");

  await getResend().emails.send({
    from: withDisplayName(jerseyFrom()),
    to: input.to,
    subject: T.subject,
    html: renderEmailLayout({ title: T.title, bodyHtml }),
    text,
  });
}

export async function sendJerseyAdminAlertEmail(input: {
  name: string;
  email: string;
  refCode: string;
  flags: string[];
}): Promise<void> {
  const to = process.env.CLUB_ROSTER_EMAIL || "threewolvesbadminton@gmail.com";
  const flagText = input.flags.join(", ");
  const bodyHtml = `
    ${heading("Jersey registration needs a look")}
    ${paragraph(`<strong>${escapeHtml(input.name)}</strong> (${escapeHtml(input.email)}), code ${escapeHtml(input.refCode)}, matches another registration: ${escapeHtml(flagText)}. Review it on the Jersey tab in admin.`)}
  `;
  await getResend().emails.send({
    from: withDisplayName(jerseyFrom()),
    to,
    subject: `Jersey registration flagged: ${input.name}`,
    html: renderEmailLayout({ title: "Jersey registration flagged", bodyHtml }),
    text: `${input.name} (${input.email}), code ${input.refCode}, matches another registration: ${flagText}.`,
  });
}
