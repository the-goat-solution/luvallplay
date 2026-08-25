import { Resend } from "resend";
import type { RosterEntry } from "./db";

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
        `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.email)}</td><td>${escapeHtml(p.phone ?? "")}</td><td>${PLAN_LABEL[p.type]}</td></tr>`,
    )
    .join("");

  const html = `
    <h2>Play day roster — ${date}</h2>
    <p>${roster.length} player${roster.length === 1 ? "" : "s"} signed up.</p>
    <table cellpadding="6" style="border-collapse:collapse">
      <thead>
        <tr style="text-align:left;border-bottom:1px solid #ccc">
          <th>Name</th><th>Email</th><th>Phone</th><th>Type</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4">No signups yet.</td></tr>`}</tbody>
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
    html,
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

  const html = `
    <p>We received a request to cancel your ${escapeHtml(planLabel)} membership at Three Wolves Badminton Club.</p>
    <p><a href="${escapeHtml(confirmUrl)}">Confirm your cancellation</a></p>
    <p>This link expires in 24 hours. If you didn't request this, you can ignore this email — your membership will stay active.</p>
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
    html,
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

  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>You're on the waitlist${forDate} at Three Wolves Badminton Club. We'll email you as soon as a spot opens up — no payment required until then.</p>
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
    html,
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

  const html = `
    <h2>New waitlist signup</h2>
    <p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) joined the waitlist for ${escapeHtml(forDate)}.</p>
  `;
  const text = `${name} (${email}) joined the waitlist for ${forDate}.`;

  await getResend().emails.send({
    from,
    to,
    subject: `New waitlist signup — ${forDate}`,
    html,
    text,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
