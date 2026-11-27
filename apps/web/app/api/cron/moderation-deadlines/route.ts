import { cronAuthorized } from "@/lib/cron";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Watches the report queues' deadlines (12 hours for a serious report, 24 for
// the rest). Owned by Moderation, so it is answered only where that module is
// on: nowhere, while Social and the Marketplace are hidden.
//
// The work itself (the alert at three quarters of a deadline, and moving an
// overdue report to the platform's queue) arrives with the moderation pages.
// Until then the job checks the scheduler's secret and changes nothing.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, reports: 0 });
}
