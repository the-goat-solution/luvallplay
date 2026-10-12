import { Resend } from "resend";
import type { RosterEntry } from "./db";
import type { MembershipDay, MembershipTier } from "./constants";
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
  const rows = roster
    .map((p) => {
      const cell = (content: string) =>
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e0cf">${content}</td>`;
      if (p.fillIn) {
        return `<tr>
          ${cell(`${escapeHtml(p.fillIn.name)}<br /><span style="font-size:12px;color:#6b6b6b">filling in for ${escapeHtml(p.name)}</span>`)}
          ${cell(escapeHtml(p.fillIn.email))}
          ${cell(escapeHtml(p.fillIn.phone ?? ""))}
          ${cell(`${PLAN_LABEL[p.type]} (fill-in)`)}
        </tr>`;
      }
      return `<tr>
          ${cell(escapeHtml(p.name))}
          ${cell(escapeHtml(p.email))}
          ${cell(escapeHtml(p.phone ?? ""))}
          ${cell(PLAN_LABEL[p.type])}
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
        ? `${p.fillIn.name} <${p.fillIn.email}> ${p.fillIn.phone ?? ""} — ${PLAN_LABEL[p.type]} (filling in for ${p.name})`
        : `${p.name} <${p.email}> ${p.phone ?? ""} — ${PLAN_LABEL[p.type]}`,
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

export async function sendCancellationLinkEmail(
  to: string,
  planLabel: string,
  confirmUrl: string,
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const bodyHtml = `
    ${heading("Confirm your cancellation")}
    ${paragraph(`We're sorry to see you go! We received a request to cancel your <strong>${escapeHtml(planLabel)}</strong> membership at Three Wolves Badminton Club.`)}
    ${ctaButton("Confirm cancellation", confirmUrl)}
    ${paragraph("This link expires in 24 hours. If you didn't request this, no action needed — you can safely ignore this email and your membership will stay active.")}
    ${contactFooterNote()}
  `;
  const text = [
    `We're sorry to see you go! We received a request to cancel your ${planLabel} membership at Three Wolves Badminton Club.`,
    "",
    `Confirm your cancellation: ${confirmUrl}`,
    "",
    "This link expires in 24 hours. If you didn't request this, no action needed — you can ignore this email and your membership will stay active.",
    "",
    contactFooterNoteText(),
  ].join("\n");

  await getResend().emails.send({
    from: withDisplayName(from),
    to,
    subject: "Confirm your membership cancellation — Three Wolves Badminton Club",
    html: renderEmailLayout({ title: "Confirm your cancellation", bodyHtml }),
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

  const accessParagraph = input.delayed
    ? paragraph(
        `You were charged <strong>NZD $${input.priceNzd.toFixed(2)}</strong> today. There wasn't an open spot on the very next ${dayName} session, so your membership access starts on <strong>${escapeHtml(displayStart)}</strong> — the next ${dayName} session with room. You were charged today either way; your access simply begins then.`,
      )
    : paragraph(
        `You were charged <strong>NZD $${input.priceNzd.toFixed(2)}</strong> today, and your membership is active immediately — you're welcome at every ${dayName} session from now through <strong>${escapeHtml(displayEnd)}</strong>.`,
      );

  const bodyHtml = `
    ${heading(`Welcome to Three Wolves, ${escapeHtml(input.firstName)}!`)}
    ${paragraph(`We're so glad to have you — your <strong>${planTitle}</strong> membership is confirmed (${billingNote}).`)}
    ${accessParagraph}
    ${paragraph(`Membership window: <strong>${escapeHtml(displayStart)}</strong> to <strong>${escapeHtml(displayEnd)}</strong>. You can show up to any ${dayName} session in that window — no need to book individual sessions. See you on court!`)}
    ${contactFooterNote()}
  `;
  const text = [
    `Welcome to Three Wolves, ${input.firstName}!`,
    "",
    `We're so glad to have you — your ${planTitle} membership is confirmed (${billingNote}).`,
    "",
    input.delayed
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
    subject: `Welcome to Three Wolves — ${planTitle} membership confirmed`,
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

  const bodyHtml = `
    ${heading("You're confirmed!")}
    ${paragraph(`Hi ${escapeHtml(input.firstName)}, you're booked in for play on <strong>${escapeHtml(displayDate)}</strong>, ${whenWhere}.`)}
    ${paragraph("Grab your racket and we'll see you on court!")}
    ${contactFooterNote()}
  `;
  const text = [
    `Hi ${input.firstName}, you're booked in for play on ${displayDate}, ${whenWhereText}.`,
    "",
    "Grab your racket and we'll see you on court!",
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
