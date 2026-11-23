import { NextResponse } from "next/server";
import { getSessionAlertState, getSessionHeadcount, getUpcomingSessionDates, upsertSessionAlertState } from "@/lib/db";
import { sendHeadcountAlertEmail } from "@/lib/notify";

export const runtime = "nodejs";

const ALERT_LEAD_DAYS = 5;
const MIN_COMFORTABLE = 8;
const MAX_COMFORTABLE = 12;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ skipped: true });
  }

  const dates = await getUpcomingSessionDates(ALERT_LEAD_DAYS);
  const results: { date: string; state: string; total: number }[] = [];

  for (const date of dates) {
    const { casual, members, total } = await getSessionHeadcount(date);
    const state =
      total < MIN_COMFORTABLE ? "under" : total > MAX_COMFORTABLE ? "over" : "ok";
    const prev = await getSessionAlertState(date);

    if (state !== prev.state) {
      await upsertSessionAlertState(date, state, total);
      if (state !== "ok") {
        await sendHeadcountAlertEmail({ date, state, total, casual, members });
      }
    }

    results.push({ date, state, total });
  }

  return NextResponse.json({ checked: results });
}
