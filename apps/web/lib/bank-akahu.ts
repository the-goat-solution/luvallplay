import { clubDateKeyForInstant } from "./dates";
import {
  autoMatchBankTransactions,
  getOpeningBalances,
  insertBankTransactions,
  setReportedBankBalance,
  type BankTransactionInput,
} from "./bank-db";
import { getSyncState, markSyncFailed, markSyncSucceeded } from "./finance-db";
import { sideEffectAllowed } from "./side-effects.ts";
import { clubMinor } from "./money";

// ANZ → the club, via Akahu (https://akahu.nz).
//
// ANZ NZ only shares account data with MBIE-accredited third parties under
// the Customer and Product Data Act, so the club can't call an ANZ API
// directly. Akahu is an accredited NZ open-banking provider, and its free
// "personal app" lets an account holder read their OWN accounts with two
// tokens — no app review needed. That's what this uses:
//
//   AKAHU_APP_TOKEN   "App ID Token"      (sent as X-Akahu-Id)
//   AKAHU_USER_TOKEN  "User Access Token" (sent as Bearer)
//   AKAHU_ACCOUNT_ID  the club account's Akahu id (acc_…); optional when
//                     only one account is connected
//
// Personal apps refresh from the bank about once a day, so a pull-based
// daily sync (cron + "Sync now") is the right shape; push webhooks are only
// available to full Akahu apps — app/api/bank/webhook accepts those too, if
// the club ever upgrades.

const API = "https://api.akahu.io/v1";
const SYNC_KEY = "akahu";
// Re-read a little history each time: banks back-date and settle lines a
// few days late. Already-stored ids are skipped.
const OVERLAP_DAYS = 14;
// First sync with no opening date set: how far back to read.
const FIRST_SYNC_DAYS = 400;

export function akahuConfigured(): boolean {
  // The bank feed is only read from production (lib/side-effects.ts).
  if (!sideEffectAllowed("akahu")) return false;
  return Boolean(process.env.AKAHU_APP_TOKEN && process.env.AKAHU_USER_TOKEN);
}

type AkahuAccount = {
  _id: string;
  name: string;
  formatted_account?: string;
  status: string;
  type: string;
  connection?: { name?: string };
  balance?: { currency: string; current: number; available?: number };
  refreshed?: { balance?: string; transactions?: string };
};

type AkahuTransaction = {
  _id: string;
  _account: string;
  date: string;
  description: string;
  amount: number;
  balance?: number;
  type: string;
  meta?: { particulars?: string; code?: string; reference?: string; other_account?: string };
  merchant?: { name?: string };
};

async function akahu<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.AKAHU_USER_TOKEN}`,
      "X-Akahu-Id": process.env.AKAHU_APP_TOKEN ?? "",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string } & T;
  if (!res.ok || body.success === false) {
    throw new Error(`Akahu ${res.status}: ${body.message ?? res.statusText}`);
  }
  return body;
}

// Akahu amounts are dollars as JSON numbers (e.g. -45.5). Round through a
// fixed 2-dp string so 0.1 + 0.2-style float noise can't shift a cent.
export function dollarsToCents(amount: number): number {
  return clubMinor(Number(amount.toFixed(2)));
}

export async function listAkahuAccounts(): Promise<AkahuAccount[]> {
  const { items } = await akahu<{ items: AkahuAccount[] }>("/accounts");
  return items;
}

async function pickAccount(): Promise<AkahuAccount> {
  const accounts = (await listAkahuAccounts()).filter((a) => a.status === "ACTIVE");
  const wanted = process.env.AKAHU_ACCOUNT_ID?.trim();
  if (wanted) {
    const found = accounts.find((a) => a._id === wanted);
    if (!found) throw new Error(`Akahu account ${wanted} isn't connected (or isn't active).`);
    return found;
  }
  if (accounts.length === 1) return accounts[0];
  throw new Error(
    accounts.length === 0
      ? "No bank accounts are connected in Akahu yet."
      : `Several accounts are connected in Akahu — set AKAHU_ACCOUNT_ID to the club's one (${accounts
          .map((a) => `${a.name} ${a.formatted_account ?? ""} = ${a._id}`)
          .join("; ")}).`,
  );
}

function accountLabel(a: AkahuAccount): string {
  return [a.connection?.name, a.name, a.formatted_account].filter(Boolean).join(" · ");
}

export function mapAkahuTransaction(t: AkahuTransaction, account: string | null): BankTransactionInput {
  const ref = [t.meta?.particulars, t.meta?.code, t.meta?.reference].filter(Boolean).join(" / ");
  const description = [t.type && t.type !== "DEBIT" && t.type !== "CREDIT" ? t.type : null, t.merchant?.name ?? t.description]
    .filter(Boolean)
    .join(" · ");
  return {
    externalId: `akahu:${t._id}`,
    account,
    // Akahu timestamps are UTC; the statement date is the NZ day.
    date: clubDateKeyForInstant(new Date(t.date)),
    description: description || "Bank transaction",
    reference: [ref, t.meta?.other_account].filter(Boolean).join(" · ") || null,
    amountCents: dollarsToCents(t.amount),
    balanceCents: typeof t.balance === "number" ? dollarsToCents(t.balance) : null,
  };
}

export type AkahuSyncResult = { inserted: number; duplicates: number; matched: number; account: string };

export async function syncAkahu(): Promise<AkahuSyncResult> {
  if (!akahuConfigured()) throw new Error("Akahu isn't set up (AKAHU_APP_TOKEN / AKAHU_USER_TOKEN).");
  const startedAt = new Date();
  try {
    const account = await pickAccount();
    const label = accountLabel(account);

    const [state, opening] = await Promise.all([getSyncState(SYNC_KEY), getOpeningBalances()]);
    const sinceMs = state.lastStartedAt
      ? state.lastStartedAt.getTime() - OVERLAP_DAYS * 86_400_000
      : opening
        ? Date.parse(`${opening.date}T00:00:00Z`) - 2 * 86_400_000
        : Date.now() - FIRST_SYNC_DAYS * 86_400_000;

    const rows: BankTransactionInput[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const params = new URLSearchParams({ start: new Date(sinceMs).toISOString() });
      if (cursor) params.set("cursor", cursor);
      const page: { items: AkahuTransaction[]; cursor?: { next?: string | null } } = await akahu(
        `/accounts/${encodeURIComponent(account._id)}/transactions?${params}`,
      );
      rows.push(...page.items.map((t) => mapAkahuTransaction(t, label)));
      cursor = page.cursor?.next ?? null;
    } while (cursor && ++pages < 50);

    const { inserted, duplicates } = await insertBankTransactions("akahu", rows);

    if (account.balance && account.balance.currency === "NZD") {
      await setReportedBankBalance({
        cents: dollarsToCents(account.balance.current),
        asOf: account.refreshed?.balance ?? startedAt.toISOString(),
        account: label,
        source: "Akahu",
      });
    }

    const matched = await autoMatchBankTransactions();
    await markSyncSucceeded(SYNC_KEY, startedAt);
    return { inserted, duplicates, matched, account: label };
  } catch (err) {
    await markSyncFailed(SYNC_KEY, err instanceof Error ? err.message : String(err)).catch(() => {});
    throw err;
  }
}

export async function getAkahuSyncState() {
  return getSyncState(SYNC_KEY);
}
