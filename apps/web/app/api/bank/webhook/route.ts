import { clubClock } from "@/lib/club";
import { NextResponse } from "next/server";
import { z } from "zod";
import { akahuConfigured, dollarsToCents, syncAkahu } from "@/lib/bank-akahu";
import {
  autoMatchBankTransactions,
  insertBankTransactions,
  setReportedBankBalance,
} from "@/lib/bank-db";
import { clubDateKeyForInstant } from "@/lib/dates";
import { isDateKey } from "@/lib/finance";
import { checkRateLimit, getClientIp } from "@/lib/security";

export const runtime = "nodejs";

// Inbound bank feed — the club's "access point" for bank data pushed from
// outside. Two kinds of caller:
//
// 1. Akahu webhooks (full Akahu apps only — personal apps are pull-only and
//    are synced by cron instead). Subscribe with `state` set to
//    BANK_WEBHOOK_SECRET; Akahu echoes it back in every payload. Any
//    TRANSACTION/ACCOUNT event triggers a pull from Akahu's API, so nothing
//    in the webhook body itself is trusted as data.
//
// 2. Anything else that can POST JSON — a future ANZ data-sharing provider,
//    an automation (Zapier/Make), or a script — authenticated with
//    `Authorization: Bearer <BANK_WEBHOOK_SECRET>`:
//
//    {
//      "account": "ANZ 01-0000-0000000-00",          // optional
//      "balance": 1234.56, "balance_as_of": "...",   // optional
//      "transactions": [
//        { "id": "unique-per-line", "date": "2026-10-09",
//          "amount": -45.50, "description": "Pioneer Stadium",
//          "reference": "Court hire", "balance": 1234.56 }
//      ]
//    }
//
//    Amounts are NZD dollars, + in / − out. `id` must be stable: resending
//    the same line is a no-op.

const transactionSchema = z.object({
  id: z.string().min(1).max(200),
  date: z.string().min(10).max(40),
  amount: z.number().finite(),
  description: z.string().max(500).default(""),
  reference: z.string().max(500).optional(),
  balance: z.number().finite().optional(),
});

const genericSchema = z.object({
  account: z.string().max(200).optional(),
  balance: z.number().finite().optional(),
  balance_as_of: z.string().max(40).optional(),
  transactions: z.array(transactionSchema).max(2000).default([]),
});

function secretMatches(given: string | null | undefined): boolean {
  const secret = process.env.BANK_WEBHOOK_SECRET;
  if (!secret || !given || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

function toDateKey(raw: string, timezone: string): string | null {
  if (isDateKey(raw)) return raw;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : clubDateKeyForInstant(new Date(t), timezone);
}

export async function POST(request: Request) {
  if (!process.env.BANK_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Bank webhook is not configured" }, { status: 503 });
  }
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }
  if (!checkRateLimit(`bank-webhook:${getClientIp(request)}`, 30)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const raw = await request.text();
  if (raw.length > 2_000_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const isAkahu =
    typeof body === "object" && body !== null && "webhook_type" in body;

  if (isAkahu) {
    const state = (body as { state?: unknown }).state;
    if (!secretMatches(typeof state === "string" ? state : bearer)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const type = String((body as { webhook_type: unknown }).webhook_type);
    if ((type === "TRANSACTION" || type === "ACCOUNT") && akahuConfigured()) {
      try {
        const result = await syncAkahu();
        return NextResponse.json({ received: true, ...result });
      } catch (e) {
        console.error("Bank webhook: Akahu sync failed", e);
        // 200 so Akahu doesn't hammer retries; the nightly cron catches up.
        return NextResponse.json({ received: true, synced: false });
      }
    }
    return NextResponse.json({ received: true });
  }

  if (!secretMatches(bearer)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = genericSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues.slice(0, 10) },
      { status: 400 },
    );
  }
  const { account, balance, balance_as_of, transactions } = parsed.data;

  const rows = [];
  const rejected: string[] = [];
  const { timezone } = await clubClock();
  for (const t of transactions) {
    const date = toDateKey(t.date, timezone);
    if (!date) {
      rejected.push(t.id);
      continue;
    }
    rows.push({
      externalId: `webhook:${t.id}`,
      account: account ?? null,
      date,
      description: t.description || "Bank transaction",
      reference: t.reference ?? null,
      amountCents: dollarsToCents(t.amount),
      balanceCents: t.balance === undefined ? null : dollarsToCents(t.balance),
    });
  }

  const { inserted, duplicates } = await insertBankTransactions("webhook", rows);
  if (balance !== undefined) {
    await setReportedBankBalance({
      cents: dollarsToCents(balance),
      asOf: balance_as_of ?? new Date().toISOString(),
      account: account ?? null,
      source: "Webhook",
    });
  }
  const matched = inserted > 0 ? await autoMatchBankTransactions() : 0;
  return NextResponse.json({ received: true, inserted, duplicates, matched, rejected });
}
