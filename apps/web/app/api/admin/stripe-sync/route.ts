import { NextResponse } from "next/server";
import { auditMembershipStatuses } from "@/lib/membership-status";
import { syncMembershipsWithStripe } from "@/lib/stripe-sync";
import { checkRateLimit, getClientIp, isAdminRequest } from "@/lib/security";
import { auditedRoute } from "@/lib/admin-audit";

export const runtime = "nodejs";
export const maxDuration = 60;

// "Sync with Stripe now" on /admin/members — the same sync the daily cron
// runs, returning a report of everything it changed.
export const POST = auditedRoute("stripe.sync", async function POST(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ip = getClientIp(request);
  if (!checkRateLimit(`admin-stripe-sync:${ip}`, 6)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }

  try {
    const report = await syncMembershipsWithStripe();
    // Then expire anything the corrected dates show has ended.
    await auditMembershipStatuses();
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    console.error("Stripe sync failed", e);
    const message = e instanceof Error ? e.message : "Stripe sync failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
