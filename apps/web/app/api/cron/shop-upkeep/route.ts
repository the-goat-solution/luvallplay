import { cronAuthorized } from "@/lib/cron";
import { cronStatus, forEachClub } from "@/lib/tenant-context";
import { sql } from "@/lib/database";
import { NextResponse } from "next/server";
import { runShopDailyUpkeep } from "@/lib/shop-notify";

export const runtime = "nodejs";
export const maxDuration = 60;

const PATH = "/api/cron/shop-upkeep";

// Shop: a heads-up for cash reservations ending within a day, then release
// lapsed holds (and tell those players). Its own job, owned by the Shop
// (audit H2): it used to ride on the membership reminders, so a club with
// Memberships off never released its shop holds.
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
      return { ok: true, ...(await runShopDailyUpkeep()) };
    } catch (err) {
      console.error("Shop upkeep failed", err);
      throw new Error("Shop upkeep failed");
    }
  });
  return NextResponse.json({ clubs }, { status: cronStatus(clubs) });
}
