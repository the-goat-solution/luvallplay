import { NextResponse } from "next/server";
import { db, dbConfigured } from "@/lib/db";
import { isProductionDeployment } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Captured email, for end-to-end tests. Never served on production, and only
// when E2E_OUTBOX=1.
export async function GET() {
  if (isProductionDeployment() || process.env.E2E_OUTBOX !== "1" || !dbConfigured()) return new NextResponse("Not found", { status: 404 });
  const { rows } = await db().query("SELECT to_email, subject, body, created_at FROM site_captured_emails ORDER BY id DESC LIMIT 50");
  return NextResponse.json(rows);
}
