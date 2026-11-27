import { cronAuthorized } from "@/lib/cron";
import { cronStatus, forEachClub } from "@/lib/tenant-context";
import { sql } from "@/lib/database";
import { NextResponse } from "next/server";
import { getSessionAlertState, getSessionHeadcount, getUpcomingSessionDates, upsertSessionAlertState } from "@/lib/db";
import { sendHeadcountAlertEmail } from "@/lib/notify";

export const runtime = "nodejs";

const PATH = "/api/cron/headcount-alerts";

const ALERT_LEAD_DAYS = 5;
const MIN_COMFORTABLE = 8;
const MAX_COMFORTABLE = 12;

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

    return { checked: results };
  });
  return NextResponse.json({ clubs }, { status: cronStatus(clubs) });
}
