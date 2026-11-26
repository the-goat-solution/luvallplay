import { clubContactEmail, clubEmailLogoPath, clubName, clubPlace, clubShortName } from "./club-brand";
// The member welcome email (Admin → Players → Welcome emails). Same design
// as the launch note in docs/release-notes/2026-11-player-accounts-email.html,
// personalised: first name, a login link with their email filled in, and a
// one-click link to hide from the leaderboard. Table layout with inline
// styles only, so it survives Gmail, Outlook and Apple Mail.

export const WELCOME_SUBJECT = `Your ${clubShortName()} profile is here 🐺`;
const PREHEADER = "Sign in with a code, manage your membership, grab the new jersey and see where you rank.";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Pure (no env or imports) so it can be unit-tested; siteUrl has no trailing slash. */
export function renderWelcomeEmail(input: { to: string; firstName: string; optOutUrl: string; siteUrl: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const site = input.siteUrl.replace(/\/$/, "");
  const rawLoginUrl = `${site}/login?email=${encodeURIComponent(input.to)}`;
  const first = input.firstName.trim();
  const greeting = first ? `Kia ora ${escapeHtml(first)},` : "Kia ora,";
  const loginUrl = escapeHtml(rawLoginUrl);
  const optOutUrl = escapeHtml(input.optOutUrl);
  const logoUrl = escapeHtml(`${site}${clubEmailLogoPath()}`);
  const siteLabel = escapeHtml(site.replace(/^https?:\/\//, ""));

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Your ${clubShortName()} profile is here</title>
  </head>
  <body style="margin:0;padding:0;background:#f2efe3;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">
      ${PREHEADER}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2efe3;padding:32px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fcfbf2;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(24,68,103,.08)">

            <!-- Header -->
            <tr>
              <td style="background:#184467;padding:36px 32px 32px;text-align:center">
                <img src="${logoUrl}" alt="${clubName()}" width="84" style="display:inline-block;width:84px;height:auto;border:0" />
                <div style="margin:18px 0 6px;font-family:'Montserrat',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#e2ae60">
                  New for the pack
                </div>
                <h1 style="margin:0;font-family:'Copperplate','Copperplate Gothic Light',Georgia,serif;font-size:30px;line-height:1.25;font-weight:normal;color:#fcfbf2">
                  Your ${clubShortName()} profile is here
                </h1>
              </td>
            </tr>
            <tr><td style="height:4px;background:#C4892A;font-size:0;line-height:0">&nbsp;</td></tr>

            <!-- Intro -->
            <tr>
              <td style="padding:32px 32px 8px;font-size:15px;line-height:1.7;color:#3a526a">
                <p style="margin:0 0 16px;color:#0d1b26;font-size:16px">${greeting}</p>
                <p style="margin:0 0 16px">
                  We've just launched something we've wanted for a long time: <strong style="color:#184467">your own ${clubShortName()} profile</strong>.
                  Your membership, bookings, results and photos are now all in one place, on your phone or computer.
                </p>
                <p style="margin:0 0 8px">
                  <strong style="color:#184467">Your account is ready.</strong>
                  We've set it up with this email address, so sign in with it and you'll see your membership straight away.
                </p>
              </td>
            </tr>

            <!-- CTA -->
            <tr>
              <td align="center" style="padding:16px 32px 28px">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:10px;background:#C4892A">
                      <a href="${loginUrl}" style="display:inline-block;padding:15px 34px;font-family:'Montserrat',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#fcfbf2;text-decoration:none;border-radius:10px">
                        Open my profile
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Section label -->
            <tr>
              <td style="padding:0 32px 4px">
                <div style="font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#C4892A">What's new</div>
              </td>
            </tr>

            <!-- Feature: sign in -->
            <tr>
              <td style="padding:12px 32px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border-left:4px solid #C4892A">
                  <tr>
                    <td style="padding:18px 20px;font-size:15px;line-height:1.65;color:#3a526a">
                      <div style="font-size:17px;font-weight:700;color:#184467;margin-bottom:4px">🔑 No passwords, ever</div>
                      Sign in with a 6-digit code sent to your email or by text message. You'll stay signed in on that device for 90 days.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Feature: membership -->
            <tr>
              <td style="padding:12px 32px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border-left:4px solid #C4892A">
                  <tr>
                    <td style="padding:18px 20px;font-size:15px;line-height:1.65;color:#3a526a">
                      <div style="font-size:17px;font-weight:700;color:#184467;margin-bottom:4px">🏸 Your membership, in your pocket</div>
                      See your plan and next renewal date, then:
                      <ul style="margin:8px 0 0;padding-left:20px">
                        <li style="margin-bottom:4px">book and pay for play days from the club calendar;</li>
                        <li style="margin-bottom:4px">switch between monthly and quarterly, starting at your next renewal;</li>
                        <li style="margin-bottom:4px">update your card or download receipts any time.</li>
                      </ul>
                      <div style="margin-top:8px">Not a member yet? Join right from your profile.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Feature: shop (with jersey) -->
            <tr>
              <td style="padding:12px 32px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#184467;border-radius:12px">
                  <tr>
                    <td width="45%" valign="middle" style="padding:16px 0 16px 16px;text-align:center">
                      <img src="${site}/uploads/shop/jersey-port-hills-dawn-front.webp" alt="${clubShortName()} Port Hills Dawn jersey" width="200" style="display:block;width:100%;max-width:200px;height:auto;border:0;border-radius:8px;margin:0 auto" />
                    </td>
                    <td valign="middle" style="padding:20px 20px 20px 16px;font-size:15px;line-height:1.65;color:#d6e3ec">
                      <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#e2ae60;margin-bottom:6px">Club shop</div>
                      <div style="font-family:'Copperplate','Copperplate Gothic Light',Georgia,serif;font-size:21px;color:#fcfbf2;margin-bottom:6px">Port Hills Dawn jersey</div>
                      <div style="font-size:24px;font-weight:700;color:#e2ae60;margin-bottom:6px">$30</div>
                      Men's and women's fits, S to 3XL. Pay by card online, or in cash at a play day, and collect it at your next session.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Feature: stats + leaderboard -->
            <tr>
              <td style="padding:12px 32px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border-left:4px solid #C4892A">
                  <tr>
                    <td style="padding:18px 20px;font-size:15px;line-height:1.65;color:#3a526a">
                      <div style="font-size:17px;font-weight:700;color:#184467;margin-bottom:4px">📈 Your game, tracked</div>
                      Your attendance and round-robin results now build up on your profile, at 2 points for every win.
                      The new <a href="${site}/leaderboard" style="color:#C4892A;font-weight:700">club leaderboard</a> ranks the pack by month, quarter, year and all time.
                      <div style="margin-top:8px;font-size:14px;color:#5b6f82">You're on it by default. Prefer to keep your results private? <a href="${optOutUrl}" style="color:#C4892A;font-weight:700">Hide me from the leaderboard</a> (one tap), or turn off "Show me on the leaderboard" in your profile any time.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Feature: photos -->
            <tr>
              <td style="padding:12px 32px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border-left:4px solid #C4892A">
                  <tr>
                    <td style="padding:18px 20px;font-size:15px;line-height:1.65;color:#3a526a">
                      <div style="font-size:17px;font-weight:700;color:#184467;margin-bottom:4px">📸 Share your court-side shots</div>
                      Upload photos from your profile to the club Gallery. We remove location data before anything is shared, and every photo is checked before it goes up.
                      Spotted yourself in the Gallery? Tap <strong style="color:#184467">Download original</strong> for the full-quality version.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Feature: messages + app -->
            <tr>
              <td style="padding:12px 32px 4px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="50%" valign="top" style="padding-right:6px">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border-top:4px solid #C4892A">
                        <tr>
                          <td style="padding:16px 16px;font-size:14px;line-height:1.6;color:#3a526a">
                            <div style="font-size:16px;font-weight:700;color:#184467;margin-bottom:4px">💬 Message the club</div>
                            Questions about your membership or a play day? Send them from your profile and we'll reply there.
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td width="50%" valign="top" style="padding-left:6px">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border-top:4px solid #C4892A">
                        <tr>
                          <td style="padding:16px 16px;font-size:14px;line-height:1.6;color:#3a526a">
                            <div style="font-size:16px;font-weight:700;color:#184467;margin-bottom:4px">📱 Works like an app</div>
                            Add it to your home screen and it opens full-screen. Available in English and Tiếng Việt.
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Casual players note -->
            <tr>
              <td style="padding:20px 32px 8px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2efe3;border-radius:12px">
                  <tr>
                    <td style="padding:16px 20px;font-size:14px;line-height:1.65;color:#3a526a">
                      <strong style="color:#184467">Casual players:</strong> nothing changes. You can still book a session as a guest.
                      A free account is there whenever you want to track your games or join the leaderboard.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Sign-off -->
            <tr>
              <td style="padding:20px 32px 32px;font-size:15px;line-height:1.7;color:#3a526a">
                <p style="margin:0 0 16px">
                  This is the first version, so tell us what you think.
                  Send us a message from your profile, or email
                  <a href="mailto:${clubContactEmail()}" style="color:#C4892A">${clubContactEmail()}</a>.
                </p>
                <p style="margin:0 0 4px">See you on court,</p>
                <p style="margin:0;font-family:'Copperplate','Copperplate Gothic Light',Georgia,serif;font-size:18px;color:#184467">The ${clubShortName()} team</p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background:#0e2c3f;padding:22px 32px;text-align:center;font-family:'Montserrat',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#b4ccd9">
                ${clubName()} · ${clubPlace()}<br />
                <a href="${site}" style="color:#e2ae60;text-decoration:none">${siteLabel}</a>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  const text = [
    first ? `Kia ora ${first},` : "Kia ora,",
    "",
    `We've just launched your own ${clubShortName()} profile: your membership, bookings, results and photos, all in one place.`,
    "Your account is ready. We've set it up with this email address, so sign in with it and you'll see your membership straight away.",
    "",
    `Open my profile: ${rawLoginUrl}`,
    "",
    "What's new:",
    "- No passwords, ever: sign in with a 6-digit code by email or text message.",
    "- Your membership in your pocket: book and pay for play days, switch between monthly and quarterly from your next renewal, update your card or download receipts.",
    "- Club shop: the Port Hills Dawn jersey, $30, men's and women's S to 3XL. Pay by card online or cash at a play day.",
    `- Your game, tracked: attendance and round-robin results (2 points per win) and the club leaderboard: ${site}/leaderboard`,
    "- Share your court-side shots to the club Gallery, and download originals.",
    "- Message the club from your profile. Add it to your home screen; English and Tiếng Việt.",
    "",
    `You're on the leaderboard by default. Hide me from the leaderboard: ${input.optOutUrl}`,
    "",
    `Questions? Send us a message from your profile, or email ${clubContactEmail()}.`,
    "",
    "See you on court,",
    `The ${clubShortName()} team`,
  ].join("\n");

  return { subject: WELCOME_SUBJECT, html, text };
}
