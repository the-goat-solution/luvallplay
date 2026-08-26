import { NextResponse } from "next/server";
import {
  addDays,
  claimMembershipReminder,
  ensureTables,
  getMembersWithPlayDayTomorrow,
  getRemainingSessionDatesInPeriod,
  listSessionsInRange,
  sessionExists,
} from "@/lib/db";
import { formatEventTimeRange, getClubToday } from "@/lib/dates";
import { sendMembershipReminderEmail } from "@/lib/email";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  await ensureTables();

  const tomorrow = addDays(getClubToday().dateKey, 1);

  const hasSession = await sessionExists(tomorrow);
  if (!hasSession) {
    return NextResponse.json({ ok: true, skipped: "No play day tomorrow" });
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
    );

    try {
      await sendMembershipReminderEmail(member.email, {
        firstName: member.firstName,
        plan: member.plan,
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

  return NextResponse.json({ ok: true, date: tomorrow, members: members.length, sent });
}
