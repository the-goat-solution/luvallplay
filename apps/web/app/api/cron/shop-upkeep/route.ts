import { cronAuthorized } from "@/lib/cron";
import { NextResponse } from "next/server";
import { runShopDailyUpkeep } from "@/lib/shop-notify";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  try {
    return NextResponse.json({ ok: true, ...(await runShopDailyUpkeep()) });
  } catch (err) {
    console.error("Shop upkeep failed", err);
    return NextResponse.json({ error: "Shop upkeep failed" }, { status: 500 });
  }
}
