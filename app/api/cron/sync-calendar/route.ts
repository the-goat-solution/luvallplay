import { NextResponse } from "next/server";
import { ensureTables, upsertSessionFromCalendar } from "@/lib/db";
import { listUpcomingCalendarEvents } from "@/lib/google-calendar";
import { toDateKey } from "@/lib/dates";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ skipped: true });
  }

  await ensureTables();

  let events;
  try {
    events = await listUpcomingCalendarEvents(180);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Calendar sync failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  for (const event of events) {
    const dateKey = toDateKey(new Date(event.start));
    await upsertSessionFromCalendar(dateKey, event);
  }

  return NextResponse.json({ eventsFound: events.length });
}
