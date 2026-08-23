import { NextResponse } from "next/server";
import { ensureTables, getRosterForDate } from "@/lib/db";
import { sendRosterEmail } from "@/lib/email";
import { getNextFriday, toDateKey } from "@/lib/dates";

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

  const date = toDateKey(getNextFriday(new Date()));

  await ensureTables();
  const roster = await getRosterForDate(date);
  await sendRosterEmail(date, roster);

  return NextResponse.json({ ok: true, date, count: roster.length });
}
