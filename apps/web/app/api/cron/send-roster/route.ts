import { cronAuthorized } from "@/lib/cron";
import { cronStatus, forEachClub } from "@/lib/tenant-context";
import { NextResponse } from "next/server";
import { getRosterForDate, getUpcomingSessionDates } from "@/lib/db";
import { sendRosterEmail } from "@/lib/email";
import { appLogin, sql, unscopedPool } from "@/lib/database";
import { shadowHeartbeat } from "@/lib/shadow-log";

export const runtime = "nodejs";

const PATH = "/api/cron/send-roster";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // Once for each club of the region, each as that club, and only where the
  // job's module is on (audit H2; lib/tenant-context.ts).
  const clubs = await forEachClub(sql, PATH, async () => {
    // Once a day, whether or not there is a play day: the shadow reads'
    // result goes on record (Phase 3; lib/shadow-log.ts). Never throws.
    // The row-level-security probe gets the unscoped pool: it names the club
    // itself, and under `enforce` the scoped one would make its "no club
    // named" half see the club's rows.
    const shadow = await shadowHeartbeat(sql, unscopedPool(), { ownerReads: !appLogin() });

    const [date] = await getUpcomingSessionDates(0);
    if (!date) {
      return { ok: true, skipped: "No session scheduled today", shadow: shadow.map((x) => `${x.what}: ${x.result}`) };
    }

    const roster = await getRosterForDate(date);
    await sendRosterEmail(date, roster);

    return { ok: true, date, count: roster.length };
  });
  return NextResponse.json({ clubs }, { status: cronStatus(clubs) });
}
