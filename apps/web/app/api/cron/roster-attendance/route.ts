import { cronAuthorized } from "@/lib/cron";
import { NextResponse } from "next/server";
import { recordRosterAttendance } from "@/lib/stats-db";

export const runtime = "nodejs";
export const maxDuration = 60;

// Yesterday's play day (and any earlier one) without a saved court board:
// record attendance from the roster so streaks and the leaderboard stay
// current. Its own job, part of the core (audit H2): it used to ride on the
// membership reminders, so a club with Memberships off stopped counting
// play days.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ skipped: true });
  }
  try {
    return NextResponse.json({ ok: true, recorded: await recordRosterAttendance() });
  } catch (err) {
    console.error("Roster attendance failed", err);
    return NextResponse.json({ error: "Roster attendance failed" }, { status: 500 });
  }
}
