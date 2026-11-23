import { getSiteUrl } from "./email-layout";
import { ensureOptOutToken, listWelcomePending, markWelcomeSent } from "./player-db";
import { sendWelcomeEmail } from "./player-email";

// Welcome emails go out in batches so the club stays under Resend's free
// limit of 100 emails a day alongside rosters and reminders. Each member is
// emailed once; a failed send stays pending and is retried next batch.
export const WELCOME_BATCH = 40;

export async function sendWelcomeBatch(limit = WELCOME_BATCH): Promise<{ sent: number; failed: number }> {
  const pending = await listWelcomePending(limit);
  let sent = 0;
  let failed = 0;
  for (const p of pending) {
    try {
      const token = await ensureOptOutToken(p.id);
      await sendWelcomeEmail({
        to: p.email,
        firstName: p.firstName,
        optOutUrl: `${getSiteUrl()}/api/profile/leaderboard-optout?token=${encodeURIComponent(token)}`,
      });
      await markWelcomeSent(p.id);
      sent++;
    } catch (err) {
      console.error("[welcome] send failed for player", p.id, err);
      failed++;
    }
  }
  return { sent, failed };
}

export async function sendWelcomePreview(to: string): Promise<void> {
  await sendWelcomeEmail({ to, firstName: "Preview", optOutUrl: `${getSiteUrl()}/leaderboard` });
}
