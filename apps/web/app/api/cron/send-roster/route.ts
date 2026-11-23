import { cronAuthorized } from "@/lib/cron";
import { NextResponse } from "next/server";
import { getRosterForDate, getUpcomingSessionDates } from "@/lib/db";
import { sendRosterEmail } from "@/lib/email";
import { sql } from "@/lib/database";
import { shadowHeartbeat } from "@/lib/shadow-log";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // Once a day, whether or not there is a play day: the shadow reads'
  // result goes on record (Phase 3; lib/shadow-log.ts). Never throws.
  const shadow = await shadowHeartbeat(sql);

  const [date] = await getUpcomingSessionDates(0);
  if (!date) {
    return NextResponse.json({ ok: true, skipped: "No session scheduled today", shadow: shadow.map((x) => `${x.what}: ${x.result}`) });
  }

  const roster = await getRosterForDate(date);
  await sendRosterEmail(date, roster);

  return NextResponse.json({ ok: true, date, count: roster.length });
}
