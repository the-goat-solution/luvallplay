import { cronAuthorized } from "@/lib/cron";
import { NextResponse } from "next/server";
import { retryWebhookDeliveries } from "@/lib/webhooks";

export const runtime = "nodejs";
export const maxDuration = 60;

// Retries failed outgoing webhooks. Its own job, owned by Integrations (audit
// H2): it used to ride on the membership reminders, so a club with
// Memberships off lost its retries.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ skipped: true });
  }
  try {
    return NextResponse.json({ ok: true, ...(await retryWebhookDeliveries()) });
  } catch (err) {
    console.error("Webhook retries failed", err);
    return NextResponse.json({ error: "Webhook retries failed" }, { status: 500 });
  }
}
