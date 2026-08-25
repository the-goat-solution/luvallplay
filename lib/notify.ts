import { Resend } from "resend";
import { heading, paragraph, renderEmailLayout } from "./email-layout";

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

export async function sendHeadcountAlertEmail(input: {
  date: string;
  state: "under" | "over";
  total: number;
  casual: number;
  members: number;
}): Promise<void> {
  const to = (process.env.ALERT_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (to.length === 0) return;

  const subject =
    input.state === "under"
      ? `Low headcount for ${input.date} (${input.total}/8-12)`
      : `High headcount for ${input.date} (${input.total}/8-12)`;

  const action =
    input.state === "under"
      ? "Below the comfortable 8-12 range — consider recruiting more players."
      : "Above the comfortable 8-12 range — consider booking an additional court (pending availability).";

  const bodyHtml = `
    ${heading(subject)}
    ${paragraph(`Session <strong>${input.date}</strong>: <strong>${input.total}</strong> total players (${input.casual} casual + ${input.members} active members).`)}
    ${paragraph(action)}
  `;
  const text = `Session ${input.date}: ${input.total} total players (${input.casual} casual + ${input.members} active members).\n\n${action}`;

  const resend = getResend();
  await resend.emails.send({
    from: process.env.ALERT_FROM_EMAIL ?? "alerts@threewolvesbadminton.com",
    to,
    subject,
    html: renderEmailLayout({ title: subject, bodyHtml }),
    text,
  });
}
