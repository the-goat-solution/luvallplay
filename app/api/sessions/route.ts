import { NextResponse } from "next/server";
import { ensureTables, listSessionsInRange } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/security";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`sessions:${ip}`, 60)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  try {
    if (process.env.POSTGRES_URL) {
      await ensureTables();
      const sessions = await listSessionsInRange(from, to);
      return NextResponse.json({ sessions });
    }
  } catch {
    // fall through to empty response below
  }

  return NextResponse.json({ sessions: [] });
}
