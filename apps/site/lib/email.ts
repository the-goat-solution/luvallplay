// Email goes out only from the production deployment. Everywhere else
// (previews, local, CI) it is captured in the site database instead, so a
// preview can never email a real person (same rule as apps/web/lib/side-effects.ts).
import { db } from "./db";
import { isProductionDeployment } from "./site";

export type Mail = { to: string; subject: string; text: string; html?: string; replyTo?: string };

export function emailAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return isProductionDeployment(env) && !!env.RESEND_API_KEY;
}

export function fromAddress(env: Record<string, string | undefined> = process.env): string {
  return env.EMAIL_FROM || "Luvallplay <hello@luvallplay.com>";
}

export async function sendMail(mail: Mail): Promise<"sent" | "captured" | "failed"> {
  if (!emailAllowed()) {
    await db().query("INSERT INTO site_captured_emails (to_email, subject, body) VALUES ($1,$2,$3)", [mail.to, mail.subject, mail.text]);
    return "captured";
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromAddress(), to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, reply_to: mail.replyTo }),
  });
  if (!res.ok) {
    console.error("[email] Resend refused", res.status, await res.text().catch(() => ""));
    return "failed";
  }
  return "sent";
}
