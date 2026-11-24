import { NextResponse, type NextRequest } from "next/server";
import { dbConfigured } from "@/lib/db";
import { purge } from "@/lib/forms";

export const runtime = "nodejs";

// Daily (vercel.json): deletes unconfirmed sign-ups after 30 days and
// rate-limit rows after a day. Vercel sends CRON_SECRET as a bearer token.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  if (!dbConfigured()) return NextResponse.json({ skipped: true });
  return NextResponse.json(await purge());
}
