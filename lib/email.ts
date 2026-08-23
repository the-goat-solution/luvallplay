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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
