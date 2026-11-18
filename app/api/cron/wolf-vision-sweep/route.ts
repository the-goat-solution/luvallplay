import { NextResponse } from "next/server";
import { sweepDroppedSessions } from "@/lib/wolf-vision-db";

export const runtime = "nodejs";

// Daily: paid Wolf Vision live sessions whose phone stopped reporting
// mid-game and never finished are refunded automatically (technical failure).
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.POSTGRES_URL) return NextResponse.json({ skipped: true });
  return NextResponse.json(await sweepDroppedSessions());
}
