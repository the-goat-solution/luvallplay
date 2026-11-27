import { clubClock } from "@/lib/club";
import { cronAuthorized } from "@/lib/cron";
import { cronStatus, forEachClub } from "@/lib/tenant-context";
import { sql } from "@/lib/database";
import { NextResponse } from "next/server";
import { addDays, claimBookingReminder, claimMembershipReminder, getCasualBookingsForDate, getMembersWithPlayDayTomorrow, getRemainingSessionDatesInPeriod, listSessionsInRange, sessionExists } from "@/lib/db";
import { formatEventTimeRange, getClubToday } from "@/lib/dates";
import {
  sendCasualBookingReminderEmail,
  sendMembershipReminderEmail,
} from "@/lib/email";
import { sendRenewalReminders } from "@/lib/membership-renewal";
import { auditMembershipStatuses } from "@/lib/membership-status";
import { syncMembershipsWithStripe } from "@/lib/stripe-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

const PATH = "/api/cron/membership-reminders";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // Once for each club of the region, each as that club, and only where the
  // job's module is on (audit H2; lib/tenant-context.ts).
  const clubs = await forEachClub(sql, PATH, async () => {
    // Line every membership up with Stripe first (dates, statuses, missed
    // webhooks), so everything below works from correct data.
    let stripeSync:
      | { checked: number; changed: number; issues: string[]; errors: number }
      | { error: string };
    try {
      const report = await syncMembershipsWithStripe();
      stripeSync = {
        checked: report.checked,
        changed: report.changed.length,
        issues: report.issues,
        errors: report.errors,
      };
      for (const c of report.changed) {
        console.log(`Stripe sync: #${c.membershipId} ${c.email}: ${c.changes.join("; ")}`);
      }
    } catch (err) {
      console.error("Stripe sync failed", err);
      stripeSync = { error: "Stripe sync failed" };
    }

    // Mark ended memberships before anything below reads statuses.
    let statusAudit: Awaited<ReturnType<typeof auditMembershipStatuses>> | { error: string };
    try {
      statusAudit = await auditMembershipStatuses();
    } catch (err) {
      console.error("Membership status audit failed", err);
      statusAudit = { error: "Membership status audit failed" };
    }

    // Renewal reminders for one-time memberships go out every day, whether or
    // not there's a play day tomorrow.
    let renewals: { due: number; sent: number } | { error: string };
    try {
      renewals = await sendRenewalReminders();
    } catch (err) {
      console.error("Renewal reminders failed", err);
      renewals = { error: "Renewal reminders failed" };
    }

    // Shop upkeep, webhook retries and roster attendance are jobs of their own
    // (shop-upkeep, webhook-retries, roster-attendance), owned by the modules
    // they belong to, so switching Memberships off doesn't stop them (audit H2).

    const tomorrow = addDays(getClubToday(new Date(), await clubClock()).dateKey, 1);

    const hasSession = await sessionExists(tomorrow);
    if (!hasSession) {
      return {
        ok: true,
        skipped: "No play day tomorrow",
        renewals,
        statusAudit,
        stripeSync,
      };
    }

    const members = await getMembersWithPlayDayTomorrow(tomorrow);
    let sent = 0;

    const [tomorrowSession] = await listSessionsInRange(tomorrow, tomorrow);
    const sessionTime = tomorrowSession?.eventStartTime
      ? formatEventTimeRange(tomorrowSession.eventStartTime, tomorrowSession.eventEndTime)
      : null;
    const sessionLocation = tomorrowSession?.eventLocation ?? null;

    for (const member of members) {
      const claimed = await claimMembershipReminder(member.membershipId, tomorrow);
      if (!claimed) continue; // already reminded for this play day

      const remainingDates = await getRemainingSessionDatesInPeriod(
        tomorrow,
        member.periodEnd,
        member.day,
      );

      try {
        await sendMembershipReminderEmail(member.email, {
          firstName: member.firstName,
          plan: member.plan,
          day: member.day,
          tomorrowDate: tomorrow,
          sessionTime,
          sessionLocation,
          remainingDates,
        });
        sent++;
      } catch (err) {
        console.error("Failed to send membership reminder email", member.membershipId, err);
      }
    }

    const casualBookings = await getCasualBookingsForDate(tomorrow);
    let casualSent = 0;

    for (const booking of casualBookings) {
      const claimed = await claimBookingReminder(booking.bookingId);
      if (!claimed) continue; // already reminded for this booking

      try {
        await sendCasualBookingReminderEmail(booking.email, {
          firstName: booking.firstName,
          tomorrowDate: tomorrow,
          sessionTime,
          sessionLocation,
        });
        casualSent++;
      } catch (err) {
        console.error("Failed to send casual booking reminder email", booking.bookingId, err);
      }
    }

    return {
      ok: true,
      date: tomorrow,
      members: members.length,
      sent,
      casualBookings: casualBookings.length,
      casualSent,
      renewals,
      statusAudit,
      stripeSync,
    };
  });
  return NextResponse.json({ clubs }, { status: cronStatus(clubs) });
}
