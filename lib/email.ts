import { Resend } from "resend";
import type { RosterEntry } from "./db";
import {
  ctaButton,
  escapeHtml,
  getSiteUrl,
  heading,
  paragraph,
  renderEmailLayout,
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

const PLAN_NAME: Record<"monthly" | "quarterly", string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
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

  const rows = roster
    .map(
      (p) =>
        `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e0cf">${escapeHtml(p.name)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e0cf">${escapeHtml(p.email)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e0cf">${escapeHtml(p.phone ?? "")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e0cf">${PLAN_LABEL[p.type]}</td>
        </tr>`,
    )
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
    ...roster.map(
      (p) => `${p.name} <${p.email}> ${p.phone ?? ""} — ${PLAN_LABEL[p.type]}`,
    ),
  ].join("\n");

  await getResend().emails.send({
    from,
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
    ${paragraph(`We received a request to cancel your <strong>${escapeHtml(planLabel)}</strong> membership at Three Wolves Badminton Club.`)}
    ${ctaButton("Confirm cancellation", confirmUrl)}
    ${paragraph("This link expires in 24 hours. If you didn't request this, you can safely ignore this email — your membership will stay active.")}
  `;
  const text = [
    `We received a request to cancel your ${planLabel} membership at Three Wolves Badminton Club.`,
    "",
    `Confirm your cancellation: ${confirmUrl}`,
    "",
    "This link expires in 24 hours. If you didn't request this, you can ignore this email — your membership will stay active.",
  ].join("\n");

  await getResend().emails.send({
    from,
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

  const forDate = sessionDate ? ` for ${escapeHtml(sessionDate)}` : "";
  const forDateText = sessionDate ? ` for ${sessionDate}` : "";

  const bodyHtml = `
    ${heading("You're on the waitlist")}
    ${paragraph(`Hi ${escapeHtml(name)},`)}
    ${paragraph(`You're on the waitlist${forDate} at Three Wolves Badminton Club. We'll email you the moment a spot opens up — no payment required until then.`)}
  `;
  const text = [
    `Hi ${name},`,
    "",
    `You're on the waitlist${forDateText} at Three Wolves Badminton Club. We'll email you as soon as a spot opens up — no payment required until then.`,
  ].join("\n");

  await getResend().emails.send({
    from,
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
    from,
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

  const bodyHtml = `
    ${heading("A spot just opened up")}
    ${paragraph(`Hi ${escapeHtml(name)},`)}
    ${paragraph(`Good news — a spot has opened up for <strong>${escapeHtml(sessionDate)}</strong> at Three Wolves Badminton Club. Spots go first-come, first-served, so grab it while it's open.`)}
    ${ctaButton("Book your spot", bookUrl)}
  `;
  const text = [
    `Hi ${name},`,
    "",
    `A spot has opened up for ${sessionDate} at Three Wolves Badminton Club. Spots go first-come, first-served — book now: ${bookUrl}`,
  ].join("\n");

  await getResend().emails.send({
    from,
    to,
    subject: `A spot opened up — ${sessionDate} — Three Wolves Badminton Club`,
    html: renderEmailLayout({ title: "A spot opened up", bodyHtml }),
    text,
  });
}

export async function sendMembershipConfirmationEmail(
  to: string,
  input: {
    firstName: string;
    plan: "monthly" | "quarterly";
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
  const billingNote = input.recurring
    ? `renews automatically every ${input.plan === "monthly" ? "4 weeks" : "12 weeks"}`
    : "a single, one-time payment";

  const accessParagraph = input.delayed
    ? paragraph(
        `You were charged <strong>NZD $${input.priceNzd.toFixed(2)}</strong> today. There wasn't an open spot on the very next play day, so your membership access starts on <strong>${escapeHtml(input.periodStart)}</strong> — the next play day with room. You were charged today either way; your access simply begins then.`,
      )
    : paragraph(
        `You were charged <strong>NZD $${input.priceNzd.toFixed(2)}</strong> today, and your membership is active immediately — you're welcome at any play day from now through <strong>${escapeHtml(input.periodEnd)}</strong>.`,
      );

  const bodyHtml = `
    ${heading(`Welcome to Three Wolves, ${escapeHtml(input.firstName)}!`)}
    ${paragraph(`Your <strong>${planName}</strong> membership is confirmed (${billingNote}).`)}
    ${accessParagraph}
    ${paragraph(`Membership window: <strong>${escapeHtml(input.periodStart)}</strong> to <strong>${escapeHtml(input.periodEnd)}</strong>. You can show up to any play day in that window — no need to book individual sessions.`)}
  `;
  const text = [
    `Welcome to Three Wolves, ${input.firstName}!`,
    "",
    `Your ${planName} membership is confirmed (${billingNote}).`,
    "",
    input.delayed
      ? `You were charged NZD $${input.priceNzd.toFixed(2)} today. There wasn't an open spot on the very next play day, so your membership access starts on ${input.periodStart} — the next play day with room.`
      : `You were charged NZD $${input.priceNzd.toFixed(2)} today, and your membership is active immediately.`,
    "",
    `Membership window: ${input.periodStart} to ${input.periodEnd}.`,
  ].join("\n");

  await getResend().emails.send({
    from,
    to,
    subject: `Welcome to Three Wolves — ${planName} membership confirmed`,
    html: renderEmailLayout({ title: "Membership confirmed", bodyHtml }),
    text,
  });
}

export async function sendMembershipReminderEmail(
  to: string,
  input: {
    firstName: string;
    plan: "monthly" | "quarterly";
    tomorrowDate: string;
    remainingDates: string[];
  },
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const otherDates = input.remainingDates.filter(
    (d) => d !== input.tomorrowDate,
  );
  const remainingListHtml =
    otherDates.length > 0
      ? `
        ${paragraph("Your other remaining play days this membership period:")}
        <ul style="margin:0 0 16px;padding-left:20px;color:#3a526a">
          ${otherDates.map((d) => `<li style="margin-bottom:4px">${escapeHtml(d)}</li>`).join("")}
        </ul>
      `
      : "";

  const bodyHtml = `
    ${heading("See you tomorrow!")}
    ${paragraph(`Hi ${escapeHtml(input.firstName)}, this is a reminder that you're playing tomorrow, <strong>${escapeHtml(input.tomorrowDate)}</strong>, on your ${PLAN_NAME[input.plan]} membership.`)}
    ${remainingListHtml}
  `;
  const text = [
    `Hi ${input.firstName}, this is a reminder that you're playing tomorrow, ${input.tomorrowDate}, on your ${PLAN_NAME[input.plan]} membership.`,
    ...(otherDates.length > 0
      ? ["", "Your other remaining play days this membership period:", ...otherDates.map((d) => `- ${d}`)]
      : []),
  ].join("\n");

  await getResend().emails.send({
    from,
    to,
    subject: `Reminder: you're playing tomorrow, ${input.tomorrowDate}`,
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

  const bodyHtml = `
    ${heading("Your session sold out — refund issued")}
    ${paragraph(`Hi ${escapeHtml(input.firstName)},`)}
    ${paragraph(`We're sorry — the play day on <strong>${escapeHtml(input.sessionDate)}</strong> filled up in the moments between your payment and confirmation. You have <strong>not</strong> secured a spot.`)}
    ${paragraph(`We've refunded your <strong>NZD $${input.amountNzd.toFixed(2)}</strong> in full. It can take 5–10 business days to appear back on your card, depending on your bank.`)}
    ${paragraph("We're sorry for the inconvenience — please feel free to book another play day, or join the waitlist for this one and we'll email you if a spot frees up.")}
  `;
  const text = [
    `Hi ${input.firstName},`,
    "",
    `We're sorry — the play day on ${input.sessionDate} filled up in the moments between your payment and confirmation. You have not secured a spot.`,
    "",
    `We've refunded your NZD $${input.amountNzd.toFixed(2)} in full. It can take 5-10 business days to appear back on your card, depending on your bank.`,
    "",
    "We're sorry for the inconvenience — please feel free to book another play day, or join the waitlist for this one.",
  ].join("\n");

  await getResend().emails.send({
    from,
    to,
    subject: `Refund issued — ${input.sessionDate} sold out — Three Wolves Badminton Club`,
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
    from,
    to,
    subject: `⚠ Booking race — ${input.sessionDate} oversold${input.refunded ? "" : " — ACTION NEEDED"}`,
    html: renderEmailLayout({ title: "Booking race alert", bodyHtml }),
    text,
  });
}
