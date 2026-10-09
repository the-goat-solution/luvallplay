import { NextResponse } from "next/server";
import { syncStripeFinance } from "@/lib/finance-stripe";

export const runtime = "nodejs";

// Daily import of Stripe payments, fees and refunds into the finance ledger,
// so the Financials tab (and anything exported from it) is current even if
// no admin has opened it lately. Opening the page also syncs when stale.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.POSTGRES_URL || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ skipped: true });
  }

  try {
    const result = await syncStripeFinance();
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Finance sync failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
