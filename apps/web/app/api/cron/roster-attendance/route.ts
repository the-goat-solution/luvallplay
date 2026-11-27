import { cronAuthorized } from "@/lib/cron";
import { cronStatus, forEachClub } from "@/lib/tenant-context";
import { sql } from "@/lib/database";
import { NextResponse } from "next/server";
import { recordRosterAttendance } from "@/lib/stats-db";

export const runtime = "nodejs";
export const maxDuration = 60;

const PATH = "/api/cron/roster-attendance";

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

  // Once for each club of the region, each as that club, and only where the
  // job's module is on (audit H2; lib/tenant-context.ts).
  const clubs = await forEachClub(sql, PATH, async () => {
    try {
      return { ok: true, recorded: await recordRosterAttendance() };
    } catch (err) {
      console.error("Roster attendance failed", err);
      throw new Error("Roster attendance failed");
    }
  });
  return NextResponse.json({ clubs }, { status: cronStatus(clubs) });
}
