import { clubContactEmail, clubEmailLogoPath, clubName, clubPlace } from "./club-brand";
// Shared branded HTML shell for every transactional email the app sends
// (via lib/email.ts and lib/notify.ts). Table-based layout with inline
// styles only — the safe subset that survives Gmail/Outlook/Apple Mail
// stripping <style> blocks and modern CSS. Colors/fonts mirror the site's
// own palette in app/globals.css (--navy/--cream/--bronze) so a member
// recognizes the club immediately.

const NAVY = "#184467";
const NAVY_DARK = "#0e2c3f";
const CREAM = "#fcfbf2";
const CREAM_DARK = "#f2efe3";
const BRONZE = "#C4892A";
const TEXT_DARK = "#0d1b26";
const TEXT_MID = "#3a526a";
const FONT_SANS =
  "'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif";

// The club's public inbox — same address shown in the site footer and used
// as the admin alert fallback, so members always land in the one mailbox
// that's actually read.
export const CLUB_CONTACT_EMAIL = clubContactEmail();
const CLUB_DISPLAY_NAME = clubName();

// Resend sends whatever's in EMAIL_FROM/ALERT_FROM_EMAIL verbatim as the
// From header — a bare address (no display name) shows up in a member's
// inbox as just the raw email, not the club name. Wrap it unless it's
// already in "Name <email>" form.
export function withDisplayName(rawFrom: string): string {
  const trimmed = rawFrom.trim();
  if (trimmed.includes("<") && trimmed.includes(">")) return trimmed;
  return `${CLUB_DISPLAY_NAME} <${trimmed}>`;
}

// Member-facing dates are stored/passed around as "YYYY-MM-DD" keys — this
// renders them the way NZ readers expect, DD/MM/YYYY.
export function formatEmailDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  if (!y || !m || !d) return dateKey;
  return `${d}/${m}/${y}`;
}

// Appended to every member-facing email so people know replies here aren't
// monitored and where to actually reach a human.
export function contactFooterNote(): string {
  return paragraph(
    `Questions? This inbox isn't monitored — email us directly at <a href="mailto:${CLUB_CONTACT_EMAIL}" style="color:${BRONZE}">${CLUB_CONTACT_EMAIL}</a> and we'll get back to you.`,
  );
}

export function contactFooterNoteText(): string {
  return `Questions? This inbox isn't monitored — email us directly at ${CLUB_CONTACT_EMAIL} and we'll get back to you.`;
}

// Absolute base URL for links/images embedded in emails — a hosted image
// URL (rather than a base64 data: URI) is what actually renders across
// Outlook/Gmail/Apple Mail, so this must resolve to a real deployed origin.
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function emailLogoUrl(): string {
  return `${getSiteUrl()}${clubEmailLogoPath()}`;
}

export function ctaButton(label: string, href: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
      <tr>
        <td style="border-radius:8px;background:${BRONZE}">
          <a href="${escapeAttr(href)}" style="display:inline-block;padding:13px 28px;font-family:${FONT_SANS};font-size:15px;font-weight:700;color:${CREAM};text-decoration:none;border-radius:8px">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

export function renderEmailLayout(input: {
  title: string;
  preheader?: string;
  bodyHtml: string;
}): string {
  const { title, preheader, bodyHtml } = input;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${CREAM_DARK};font-family:${FONT_SANS}">
    ${
      preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>`
        : ""
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM_DARK};padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CREAM};border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(24,68,103,.08)">
            <tr>
              <td style="background:${NAVY};padding:28px 32px;text-align:center">
                <img
                  src="${emailLogoUrl()}"
                  alt="${clubName()}"
                  width="72"
                  style="display:inline-block;width:72px;height:auto;border:0"
                />
              </td>
            </tr>
            <tr>
              <td style="padding:32px;font-family:${FONT_SANS};color:${TEXT_DARK};font-size:15px;line-height:1.7">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="background:${NAVY_DARK};padding:20px 32px;text-align:center;font-family:${FONT_SANS};font-size:12px;color:${"#b4ccd9"}">
                ${clubName()} · ${clubPlace()}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;color:${TEXT_MID}">${html}</p>`;
}

export function heading(text: string): string {
  return `<h2 style="margin:0 0 16px;font-family:${FONT_SANS};font-size:19px;font-weight:700;color:${NAVY}">${escapeHtml(text)}</h2>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
