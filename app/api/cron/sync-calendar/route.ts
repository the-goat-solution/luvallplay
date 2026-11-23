import { NextResponse } from "next/server";
import { upsertSessionFromCalendar } from "@/lib/db";
import { listUpcomingCalendarEvents } from "@/lib/google-calendar";
import { calendarEventDateKey } from "@/lib/dates";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ skipped: true });
  }

  let events;
  try {
    events = await listUpcomingCalendarEvents(180);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Calendar sync failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  for (const event of events) {
    const dateKey = calendarEventDateKey(event.start);
    await upsertSessionFromCalendar(dateKey, event);
  }

  return NextResponse.json({ eventsFound: events.length });
}
