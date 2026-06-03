import { NextResponse } from "next/server";
import { MAX_CASUAL } from "@/lib/constants";
import { getAvailableSpots, ensureTables } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/security";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`spots:${ip}`, 60)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const datesParam = searchParams.get("dates") ?? searchParams.get("date");
  if (!datesParam) {
    return NextResponse.json({ error: "dates required" }, { status: 400 });
  }

  const dates = datesParam.split(",").map((d) => d.trim()).filter(Boolean);
  const spots: Record<string, number> = {};

  try {
    if (process.env.POSTGRES_URL) {
      await ensureTables();
      for (const date of dates) {
        spots[date] = await getAvailableSpots(date);
      }
    } else {
      for (const date of dates) {
        spots[date] = MAX_CASUAL;
      }
    }
  } catch {
    for (const date of dates) {
      spots[date] = MAX_CASUAL;
    }
  }

  return NextResponse.json({ spots });
}
