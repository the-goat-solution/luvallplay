import { cronAuthorized } from "@/lib/cron";
import { NextResponse } from "next/server";
import { syncStripeFinance } from "@/lib/finance-stripe";
import { akahuConfigured, syncAkahu } from "@/lib/bank-akahu";
import { autoMatchBankTransactions } from "@/lib/bank-db";
import { releaseExpired } from "@/lib/jersey-db";

export const runtime = "nodejs";

// Nightly: import Stripe payments, fees, refunds and payouts into the
// finance ledger, then pull the ANZ account from Akahu and auto-reconcile —
// so the Financials tab is current even if no admin has opened it lately.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ skipped: true });
  }

  // Each half runs even if the other fails, and reports its own outcome.
  const result: Record<string, unknown> = {};
  let failed = false;
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      result.stripe = await syncStripeFinance();
    } catch (e) {
      failed = true;
      result.stripe = { error: e instanceof Error ? e.message : "Stripe sync failed" };
    }
  }
  if (akahuConfigured()) {
    try {
      result.bank = await syncAkahu();
    } catch (e) {
      failed = true;
      result.bank = { error: e instanceof Error ? e.message : "Bank sync failed" };
    }
  } else {
    // New Stripe payouts may now match CSV/webhook bank lines.
    result.matched = await autoMatchBankTransactions();
  }
  // Early-bird spots unpaid after 48 hours go back to the pool.
  result.jerseyReleased = await releaseExpired().catch(() => 0);
  return NextResponse.json(result, { status: failed ? 503 : 200 });
}
