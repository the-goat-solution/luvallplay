import { cronAuthorized } from "@/lib/cron";
import { cronStatus, forEachClub } from "@/lib/tenant-context";
import { sql } from "@/lib/database";
import { NextResponse } from "next/server";
import { upsertSessionFromCalendar } from "@/lib/db";
import { listUpcomingCalendarEvents } from "@/lib/google-calendar";
import { calendarEventDateKey } from "@/lib/dates";

export const runtime = "nodejs";

const PATH = "/api/cron/sync-calendar";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ skipped: true });
  }

  // Once for each club of the region, each as that club, and only where the
  // job's module is on (audit H2; lib/tenant-context.ts).
  const clubs = await forEachClub(sql, PATH, async () => {
    let events;
    try {
      events = await listUpcomingCalendarEvents(180);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Calendar sync failed";
      throw new Error(message);
    }

    for (const event of events) {
      const dateKey = calendarEventDateKey(event.start);
      await upsertSessionFromCalendar(dateKey, event);
    }

    return { eventsFound: events.length };
  });
  return NextResponse.json({ clubs }, { status: cronStatus(clubs) });
}
