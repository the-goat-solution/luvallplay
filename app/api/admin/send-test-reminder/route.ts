import { NextResponse } from "next/server";
import { addDays, listSessionsInRange } from "@/lib/db";
import { formatEventTimeRange, getClubToday } from "@/lib/dates";
import { sendMembershipReminderEmail } from "@/lib/email";

// TEMPORARY — one-off manual test of the membership reminder email template.
// Recipient is fixed (no user-supplied input) and this route is removed
// again right after use.
export const runtime = "nodejs";

const TEST_RECIPIENT = "timba.le93@gmail.com";

export async function GET() {
  const tomorrow = addDays(getClubToday().dateKey, 1);
  const [session] = await listSessionsInRange(tomorrow, tomorrow);
  const sessionTime = session?.eventStartTime
    ? formatEventTimeRange(session.eventStartTime, session.eventEndTime)
    : null;
  const sessionLocation = session?.eventLocation ?? null;

  await sendMembershipReminderEmail(TEST_RECIPIENT, {
    firstName: "Timba",
    plan: "monthly",
    tomorrowDate: tomorrow,
    sessionTime,
    sessionLocation,
    remainingDates: [tomorrow],
  });

  return NextResponse.json({
    ok: true,
    sentTo: TEST_RECIPIENT,
    tomorrow,
    sessionTime,
    sessionLocation,
  });
}
