import { NextResponse } from "next/server";
import { ensureTables, getRosterForDate, getUpcomingSessionDates } from "@/lib/db";
import { sendRosterEmail } from "@/lib/email";

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

  const [date] = await getUpcomingSessionDates(0);
  if (!date) {
    return NextResponse.json({ ok: true, skipped: "No session scheduled today" });
  }

  const roster = await getRosterForDate(date);
  await sendRosterEmail(date, roster);

  return NextResponse.json({ ok: true, date, count: roster.length });
}
