import { NextResponse } from "next/server";
import { clubConfig } from "@/lib/club";
import { getSpotsAndHeadcountForDates } from "@/lib/db";
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

  // The club's general capacity: the answer when a day can't be looked up.
  const { sessionCapacity } = (await clubConfig()).playDays;
  const dates = datesParam.split(",").map((d) => d.trim()).filter(Boolean);
  let spots: Record<string, number> = {};
  let signedUp: Record<string, number> = {};
  let locked: Record<string, boolean> = {};
  let miniGame: Record<string, boolean> = {};

  try {
    if (process.env.POSTGRES_URL) {
      ({ spots, signedUp, locked, miniGame } = await getSpotsAndHeadcountForDates(dates));
    } else {
      for (const date of dates) {
        spots[date] = sessionCapacity;
        signedUp[date] = 0;
      }
    }
  } catch {
    for (const date of dates) {
      spots[date] = sessionCapacity;
      signedUp[date] = 0;
    }
  }

  return NextResponse.json({ spots, signedUp, locked, miniGame });
}
