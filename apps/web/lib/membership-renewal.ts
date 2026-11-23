import { clubClock } from "./club";
import crypto from "crypto";
import {
  addDays,
  claimRenewalReminder,
  getOneTimeMembershipsDueForRenewalReminder,
  releaseRenewalReminder,
} from "./db";
import { getClubToday } from "./dates";
import { sendMembershipRenewalReminderEmail } from "./email";
import { getSiteUrl } from "./email-layout";

// How many days before a one-time membership's end date its renewal reminder
// (and with it, the member's renewal link) goes out.
export const RENEWAL_REMINDER_DAYS_BEFORE = 5;

export function renewalUrl(token: string): string {
  return `${getSiteUrl()}/renew-membership?token=${encodeURIComponent(token)}`;
}

// Reminders now send members to their profile, where they can renew or turn
// on auto-renew. The private token is still issued, so links in reminders
// sent before accounts existed keep working (renewalUrl above).
export function profileRenewalUrl(email: string): string {
  return `${getSiteUrl()}/login?email=${encodeURIComponent(email)}&next=${encodeURIComponent("/profile")}`;
}

// Emails every active one-time membership ending within the next
// RENEWAL_REMINDER_DAYS_BEFORE days that hasn't been reminded yet. Looking
// at the whole window (not just exactly 5 days out) means a missed cron day
// still sends the reminder on the next run, just a day later.
export async function sendRenewalReminders(): Promise<{
  due: number;
  sent: number;
}> {
  const today = getClubToday(new Date(), await clubClock()).dateKey;
  const due = await getOneTimeMembershipsDueForRenewalReminder(
    today,
    addDays(today, RENEWAL_REMINDER_DAYS_BEFORE),
  );

  let sent = 0;
  for (const m of due) {
    if (!m.periodEnd) continue;
    const token = crypto.randomBytes(24).toString("base64url");
    // Claim first so an overlapping run can't double-send; release on a
    // failed send so tomorrow's run retries.
    if (!(await claimRenewalReminder(m.id, token))) continue;
    try {
      await sendMembershipRenewalReminderEmail(m.email, {
        firstName: m.firstName || m.name,
        plan: m.plan,
        day: m.day,
        periodEnd: m.periodEnd,
        renewUrl: profileRenewalUrl(m.email),
      });
      sent++;
    } catch (err) {
      console.error("Failed to send renewal reminder email", m.id, err);
      await releaseRenewalReminder(m.id);
    }
  }

  return { due: due.length, sent };
}
