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
  return [process.env.CLUB_ROSTER_EMAIL || "threewolvesbadminton@gmail.com"];
}

const CODE_TEXT = {
  en: {
    subject: "{code} is your Three Wolves sign-in code",
    heading: "Your sign-in code",
    intro: "Enter this code to sign in to your Three Wolves account:",
    or: "Or sign in on this device with one tap:",
    button: "Sign in",
    expiry: "The code and button work once and expire in 10 minutes. If you didn't ask to sign in, you can ignore this email.",
  },
  vi: {
    subject: "{code} là mã đăng nhập Three Wolves của bạn",
    heading: "Mã đăng nhập của bạn",
    intro: "Nhập mã này để đăng nhập tài khoản Three Wolves:",
    or: "Hoặc đăng nhập trên thiết bị này chỉ với một chạm:",
    button: "Đăng nhập",
    expiry: "Mã và nút chỉ dùng được một lần và hết hạn sau 10 phút. Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.",
  },
} as const;

export async function sendLoginCodeEmail(input: {
  to: string;
  code: string;
  linkUrl: string;
  lang: Lang;
}): Promise<void> {
  const t = CODE_TEXT[input.lang];
  const codeBlock = `<div style="margin:8px 0 20px;font-size:34px;font-weight:700;letter-spacing:10px;color:#184467;font-family:'Courier New',monospace">${escapeHtml(input.code)}</div>`;
  const bodyHtml = `
    ${heading(t.heading)}
    ${paragraph(t.intro)}
    ${codeBlock}
    ${paragraph(t.or)}
    ${ctaButton(t.button, input.linkUrl)}
    ${paragraph(t.expiry)}
  `;
  await getResend().emails.send({
    from: from(),
    to: input.to,
    subject: t.subject.replace("{code}", input.code),
    html: renderEmailLayout({ title: t.heading, preheader: `${input.code}`, bodyHtml }),
    text: `${t.intro} ${input.code}\n\n${t.or} ${input.linkUrl}\n\n${t.expiry}`,
  });
}

/**
 * "Your Three Wolves account is ready" for members whose accounts were
 * created for them. English and Vietnamese together, since imported
 * accounts have no language preference yet.
 */
export async function sendWelcomeEmail(input: {
  to: string;
  firstName: string;
  optOutUrl: string;
}): Promise<void> {
  const site = getSiteUrl();
  const loginUrl = `${site}/login?email=${encodeURIComponent(input.to)}`;
  const name = escapeHtml(input.firstName || "there");
  const bodyHtml = `
    ${heading("Your Three Wolves account is ready")}
    ${paragraph(`Hi ${name}, we've set up a Three Wolves account for you, using this email address.`)}
    ${paragraph("<strong>To sign in:</strong> go to the website, tap <strong>Log in</strong>, enter this email and type the code we send you. No password needed.")}
    ${paragraph("Inside: your membership, your play days and round robin results, the leaderboard, and the club shop.")}
    ${ctaButton("Open my profile", loginUrl)}
    ${paragraph(`You're shown on the club leaderboard by default. Prefer not to be? <a href="${escapeHtml(input.optOutUrl)}" style="color:#C4892A">Hide me from the leaderboard</a>.`)}
    <hr style="border:none;border-top:1px solid #e5e0cf;margin:28px 0" />
    ${heading("Tài khoản Three Wolves của bạn đã sẵn sàng")}
    ${paragraph(`Chào ${name}, chúng tôi đã tạo tài khoản Three Wolves cho bạn bằng địa chỉ email này.`)}
    ${paragraph("<strong>Cách đăng nhập:</strong> vào trang web, chọn <strong>Đăng nhập</strong>, nhập email này và nhập mã chúng tôi gửi cho bạn. Không cần mật khẩu.")}
    ${paragraph("Bên trong: thẻ thành viên, các buổi bạn đã chơi, kết quả vòng tròn, bảng xếp hạng và cửa hàng của CLB.")}
    ${paragraph(`Bạn được hiển thị trên bảng xếp hạng theo mặc định. <a href="${escapeHtml(input.optOutUrl)}" style="color:#C4892A">Ẩn tôi khỏi bảng xếp hạng</a>.`)}
    ${contactFooterNote()}
  `;
  await getResend().emails.send({
    from: from(),
    to: input.to,
    subject: "Your Three Wolves account is ready · Tài khoản Three Wolves đã sẵn sàng",
    html: renderEmailLayout({
      title: "Your Three Wolves account is ready",
      preheader: "Sign in with a code sent to this email. No password needed.",
      bodyHtml,
    }),
    text: [
      `Hi ${input.firstName || "there"}, we've set up a Three Wolves account for you, using this email address.`,
      "To sign in: go to the website, tap Log in, enter this email and type the code we send you.",
      `Open my profile: ${loginUrl}`,
      `Hide me from the leaderboard: ${input.optOutUrl}`,
      "",
      contactFooterNoteText(),
    ].join("\n"),
  });
}

/** Short notice to the club admins (ALERT_ADMIN_EMAILS, else the club inbox). */
export async function sendAdminAlertEmail(input: {
  subject: string;
  heading: string;
  lines: string[];
  cta?: { label: string; path: string };
}): Promise<void> {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  const bodyHtml = `
    ${heading(input.heading)}
    ${input.lines.map((l) => paragraph(escapeHtml(l))).join("")}
    ${input.cta ? ctaButton(input.cta.label, `${getSiteUrl()}${input.cta.path}`) : ""}
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
  cta?: { label: string; path: string };
}): Promise<void> {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  const bodyHtml = `
    ${heading(input.heading)}
    ${input.lines.map((l) => paragraph(escapeHtml(l))).join("")}
    ${input.cta ? ctaButton(input.cta.label, `${getSiteUrl()}${input.cta.path}`) : ""}
    ${contactFooterNote()}
  `;
  await getResend().emails.send({
    from: from(),
    to: input.to,
    subject: input.subject,
    html: renderEmailLayout({ title: input.heading, bodyHtml }),
    text: [...input.lines, input.cta ? `${getSiteUrl()}${input.cta.path}` : "", "", contactFooterNoteText()].join("\n"),
  });
}
