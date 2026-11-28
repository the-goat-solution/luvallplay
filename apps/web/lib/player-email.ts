import { playerLink } from "./player-links";
import { getResend } from "./email";
import {
  contactFooterNote,
  contactFooterNoteText,
  ctaButton,
  escapeHtml,
  getSiteUrl,
  heading,
  paragraph,
  renderEmailLayout,
  withDisplayName,
} from "./email-layout";
import type { Lang } from "./i18n";
import { renderWelcomeEmail } from "./welcome-email-template";
import { clubContactEmail, clubShortName } from "./club-brand";

// Emails for player accounts. Same branded layout as every other club email
// (lib/email-layout.ts).

function from(): string {
  const f = process.env.EMAIL_FROM;
  if (!f) throw new Error("EMAIL_FROM is not configured");
  return withDisplayName(f);
}

export function adminAlertRecipients(): string[] {
  const list = (process.env.ALERT_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length > 0) return list;
  return [process.env.CLUB_ROSTER_EMAIL || `${clubContactEmail()}`];
}

const CODE_TEXT = {
  en: {
    subject: `{code} is your ${clubShortName()} sign-in code`,
    heading: "Your sign-in code",
    intro: `Enter this code to sign in to your ${clubShortName()} account:`,
    or: "Or sign in on this device with one tap:",
    button: "Sign in",
    expiry: "The code and button work once and expire in 10 minutes. If you didn't ask to sign in, you can ignore this email.",
    expiryCode: "The code works once and expires in 10 minutes. If you didn't ask to sign in, you can ignore this email.",
  },
  vi: {
    subject: `{code} là mã đăng nhập ${clubShortName()} của bạn`,
    heading: "Mã đăng nhập của bạn",
    intro: `Nhập mã này để đăng nhập tài khoản ${clubShortName()}:`,
    or: "Hoặc đăng nhập trên thiết bị này chỉ với một chạm:",
    button: "Đăng nhập",
    expiry: "Mã và nút chỉ dùng được một lần và hết hạn sau 10 phút. Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.",
    expiryCode: "Mã chỉ dùng được một lần và hết hạn sau 10 phút. Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.",
  },
} as const;

export async function sendLoginCodeEmail(input: {
  to: string;
  code: string;
  /** The website's one-tap sign-in; null for the code alone (the app's sign-in once player emails go to the app: the button would sign in on the website). */
  linkUrl: string | null;
  lang: Lang;
}): Promise<void> {
  const t = CODE_TEXT[input.lang];
  const codeBlock = `<div style="margin:8px 0 20px;font-size:34px;font-weight:700;letter-spacing:10px;color:#184467;font-family:'Courier New',monospace">${escapeHtml(input.code)}</div>`;
  const bodyHtml = `
    ${heading(t.heading)}
    ${paragraph(t.intro)}
    ${codeBlock}
    ${input.linkUrl ? `${paragraph(t.or)}
    ${ctaButton(t.button, input.linkUrl)}
    ${paragraph(t.expiry)}` : paragraph(t.expiryCode)}
  `;
  await getResend().emails.send({
    from: from(),
    to: input.to,
    subject: t.subject.replace("{code}", input.code),
    html: renderEmailLayout({ title: t.heading, preheader: `${input.code}`, bodyHtml }),
    text: input.linkUrl ? `${t.intro} ${input.code}\n\n${t.or} ${input.linkUrl}\n\n${t.expiry}` : `${t.intro} ${input.code}\n\n${t.expiryCode}`,
  });
}

/**
 * The welcome for members whose accounts were created for them: the launch
 * email ("Your Three Wolves profile is here"), personalised. Template in
 * lib/welcome-email-template.ts.
 */
export async function sendWelcomeEmail(input: {
  to: string;
  firstName: string;
  optOutUrl: string;
}): Promise<void> {
  const email = renderWelcomeEmail({ ...input, siteUrl: getSiteUrl() });
  await getResend().emails.send({ from: from(), to: input.to, subject: email.subject, html: email.html, text: email.text });
}

/** Short notice to the club admins (ALERT_ADMIN_EMAILS, else the club inbox). */
export async function sendAdminAlertEmail(input: {
  subject: string;
  heading: string;
  lines: string[];
  /** `path` on the website; `appPath`, the app's screen for it once the app's address is set (lib/player-links.ts). */
  cta?: { label: string; path: string; appPath?: string };
}): Promise<void> {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  const ctaUrl = input.cta ? (input.cta.appPath ? playerLink(input.cta.appPath, `${getSiteUrl()}${input.cta.path}`, { club: true }) : `${getSiteUrl()}${input.cta.path}`) : "";
  const bodyHtml = `
    ${heading(input.heading)}
    ${input.lines.map((l) => paragraph(escapeHtml(l))).join("")}
    ${input.cta ? ctaButton(input.cta.label, ctaUrl) : ""}
  `;
  await getResend().emails.send({
    from: from(),
    to: adminAlertRecipients(),
    subject: input.subject,
    html: renderEmailLayout({ title: input.heading, bodyHtml }),
    text: [...input.lines, input.cta ? `${getSiteUrl()}${input.cta.path}` : ""].join("\n"),
  });
}

/** Simple player notification: heading, a few lines, one button. */
export async function sendPlayerNoticeEmail(input: {
  to: string;
  subject: string;
  heading: string;
  lines: string[];
  /** `path` on the website; `appPath`, the app's screen for it once the app's address is set (lib/player-links.ts). */
  cta?: { label: string; path: string; appPath?: string };
}): Promise<void> {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  const ctaUrl = input.cta ? (input.cta.appPath ? playerLink(input.cta.appPath, `${getSiteUrl()}${input.cta.path}`, { club: true }) : `${getSiteUrl()}${input.cta.path}`) : "";
  const bodyHtml = `
    ${heading(input.heading)}
    ${input.lines.map((l) => paragraph(escapeHtml(l))).join("")}
    ${input.cta ? ctaButton(input.cta.label, ctaUrl) : ""}
    ${contactFooterNote()}
  `;
  await getResend().emails.send({
    from: from(),
    to: input.to,
    subject: input.subject,
    html: renderEmailLayout({ title: input.heading, bodyHtml }),
    text: [...input.lines, ctaUrl, "", contactFooterNoteText()].join("\n"),
  });
}
