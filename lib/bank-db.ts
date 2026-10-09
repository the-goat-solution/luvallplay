import { sql } from "@vercel/postgres";
import { ensureFinanceTables } from "./finance-db";
import type { FinanceEntry, FinanceKind } from "./finance";

// Bank feed + reconciliation storage. See finance-db.ts for the tables.
//
// Reconciliation model (deliberately simple — one bank account, cash on
// hand, and the Stripe balance):
//
//   every bank line is either
//     matched          → to one ledger entry (expense paid by transfer/card,
//                        income received by transfer, …)
//     stripe_payout    → Stripe moving the club's own money to the bank; the
//                        underlying payments are already in the ledger
//     cash_deposit     → cash on hand banked (credit)
//     cash_withdrawal  → cash taken out to hold as cash (debit)
//     internal         → transfer between the club's own accounts
//     ignored          → not club money (e.g. a mistaken payment reversed)
//     unmatched        → still to do
//
// Bank balance  = opening bank balance + every bank line since the opening date
// Cash on hand  = opening cash + ledger cash in − ledger cash out
//                 − cash deposited + cash withdrawn
// Stripe        = live balance from Stripe (available + pending)

export type BankStatus =
  | "unmatched"
  | "matched"
  | "stripe_payout"
  | "cash_deposit"
  | "cash_withdrawal"
  | "internal"
  | "ignored";

export const BANK_STATUS_LABELS: Record<BankStatus, string> = {
  unmatched: "Not reconciled",
  matched: "Matched to entry",
  stripe_payout: "Stripe payout",
  cash_deposit: "Cash deposit",
  cash_withdrawal: "Cash withdrawal",
  internal: "Transfer between club accounts",
  ignored: "Ignored",
};

export function isBankStatus(value: string): value is BankStatus {
  return value in BANK_STATUS_LABELS;
}

export type BankTransactionInput = {
  externalId: string;
  account: string | null;
  date: string;
  description: string;
  reference: string | null;
  amountCents: number;
  balanceCents: number | null;
};

export type BankTransaction = {
  id: number;
  source: string;
  account: string | null;
  date: string;
  description: string;
  reference: string | null;
  amountCents: number;
  balanceCents: number | null;
  status: BankStatus;
  entryId: number | null;
  entryName: string | null;
  payoutId: string | null;
  autoMatched: boolean;
};

const toInt = (v: unknown): number => {
  const n = Number(v ?? 0);
  if (!Number.isSafeInteger(n)) throw new Error(`Amount out of safe range: ${v}`);
  return n;
};

// ── Settings ──────────────────────────────────────────────────────────────

export type OpeningBalances = { date: string; bankCents: number; cashCents: number };
export type ReportedBankBalance = {
  cents: number;
  asOf: string;
  account: string | null;
  source: string;
};

async function getSetting<T>(key: string): Promise<T | null> {
  const { rows } = await sql`SELECT value FROM finance_settings WHERE key = ${key};`;
  return (rows[0]?.value as T | undefined) ?? null;
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await sql`
    INSERT INTO finance_settings (key, value, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  `;
}

export async function getOpeningBalances(): Promise<OpeningBalances | null> {
  await ensureFinanceTables();
  return getSetting<OpeningBalances>("opening");
}

export async function setOpeningBalances(value: OpeningBalances): Promise<void> {
  await ensureFinanceTables();
  await setSetting("opening", value);
}

export async function getReportedBankBalance(): Promise<ReportedBankBalance | null> {
  await ensureFinanceTables();
  return getSetting<ReportedBankBalance>("bank_balance");
}

export async function setReportedBankBalance(value: ReportedBankBalance): Promise<void> {
  await ensureFinanceTables();
  await setSetting("bank_balance", value);
}

// ── Import ────────────────────────────────────────────────────────────────

// Inserts new bank lines, skipping:
//  - any external_id already stored (re-importing is harmless), and
//  - lines that duplicate one already imported from a DIFFERENT source
//    (e.g. a CSV export overlapping the Akahu feed). Descriptions differ
//    between sources, so that check is by (date, amount) as a multiset:
//    if the DB already holds two −$45.00 lines on 3 Oct from Akahu, the
//    first two −$45.00 lines on 3 Oct in a CSV are taken as those same two.
export async function insertBankTransactions(
  source: string,
  rows: BankTransactionInput[],
): Promise<{ inserted: number; duplicates: number }> {
  await ensureFinanceTables();
  if (rows.length === 0) return { inserted: 0, duplicates: 0 };

  const ids = rows.map((r) => r.externalId);
  const dates = [...new Set(rows.map((r) => r.date))];
  const [{ rows: known }, { rows: others }] = await Promise.all([
    sql.query(`SELECT external_id FROM bank_transactions WHERE external_id = ANY($1::text[]);`, [ids]),
    sql.query(
      `SELECT txn_date::text AS d, amount_cents, COUNT(*)::int AS n
       FROM bank_transactions
       WHERE source <> $1 AND txn_date = ANY($2::date[])
       GROUP BY 1, 2;`,
      [source, dates],
    ),
  ]);
  const knownIds = new Set(known.map((r) => r.external_id as string));
  const otherSource = new Map<string, number>();
  for (const r of others) otherSource.set(`${r.d}|${r.amount_cents}`, r.n as number);

  const fresh: BankTransactionInput[] = [];
  let duplicates = 0;
  const seenInBatch = new Set<string>();
  for (const row of rows) {
    if (knownIds.has(row.externalId) || seenInBatch.has(row.externalId) || row.amountCents === 0) {
      duplicates++;
      continue;
    }
    seenInBatch.add(row.externalId);
    const key = `${row.date}|${row.amountCents}`;
    const left = otherSource.get(key) ?? 0;
    if (left > 0) {
      otherSource.set(key, left - 1);
      duplicates++;
      continue;
    }
    fresh.push(row);
  }

  for (let i = 0; i < fresh.length; i += 200) {
    const chunk = fresh.slice(i, i + 200);
    await sql.query(
      `INSERT INTO bank_transactions
         (source, external_id, account, txn_date, description, reference, amount_cents, balance_cents)
       SELECT $1, t.external_id, t.account, t.txn_date, t.description, t.reference, t.amount_cents, t.balance_cents
       FROM unnest($2::text[], $3::text[], $4::date[], $5::text[], $6::text[], $7::bigint[], $8::bigint[])
         AS t(external_id, account, txn_date, description, reference, amount_cents, balance_cents)
       ON CONFLICT (external_id) DO NOTHING;`,
      [
        source,
        chunk.map((r) => r.externalId),
        chunk.map((r) => r.account),
        chunk.map((r) => r.date),
        chunk.map((r) => r.description),
        chunk.map((r) => r.reference),
        chunk.map((r) => String(r.amountCents)),
        chunk.map((r) => (r.balanceCents === null ? null : String(r.balanceCents))),
      ],
    );
  }

  return { inserted: fresh.length, duplicates };
}

export async function upsertStripePayouts(
  payouts: { id: string; amountCents: number; createdDate: string; arrivalDate: string; status: string | null }[],
): Promise<void> {
  if (payouts.length === 0) return;
  await sql.query(
    `INSERT INTO stripe_payouts (id, amount_cents, created_date, arrival_date, status)
     SELECT * FROM unnest($1::text[], $2::bigint[], $3::date[], $4::date[], $5::text[])
     ON CONFLICT (id) DO UPDATE SET
       amount_cents = EXCLUDED.amount_cents,
       arrival_date = EXCLUDED.arrival_date,
       status = EXCLUDED.status;`,
    [
      payouts.map((p) => p.id),
      payouts.map((p) => String(p.amountCents)),
      payouts.map((p) => p.createdDate),
      payouts.map((p) => p.arrivalDate),
      payouts.map((p) => p.status),
    ],
  );
}

// ── Matching ──────────────────────────────────────────────────────────────

// Ledger methods whose money moves through the bank account.
const BANK_METHODS = ["bank_transfer", "card", "other"];
const AUTO_MATCH_DAYS = 10;
const STRIPE_PAYOUT_DAYS = 5;

// Matches what can be matched with confidence, leaving anything ambiguous
// for the treasurer:
//  - a credit whose description mentions Stripe → that Stripe payout (same
//    amount, arriving within a few days), or a payout without a link if
//    Stripe's record of it isn't imported yet;
//  - otherwise, exactly one unlinked ledger entry paid by bank/card with
//    the same signed amount within 10 days (closest date wins; a tie is
//    left for a human).
export async function autoMatchBankTransactions(): Promise<number> {
  await ensureFinanceTables();
  const { rows } = await sql`
    SELECT id, txn_date::text AS d, description, amount_cents
    FROM bank_transactions WHERE status = 'unmatched'
    ORDER BY txn_date, id;
  `;
  let matched = 0;

  for (const r of rows) {
    const id = r.id as number;
    const amount = toInt(r.amount_cents);
    const date = r.d as string;

    if (amount > 0 && /stripe/i.test(r.description as string)) {
      const { rows: payouts } = await sql.query(
        `SELECT id FROM stripe_payouts p
         WHERE p.amount_cents = $1
           AND ABS(p.arrival_date - $2::date) <= $3
           AND NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE b.payout_id = p.id)
         ORDER BY ABS(p.arrival_date - $2::date) LIMIT 1;`,
        [amount, date, STRIPE_PAYOUT_DAYS],
      );
      await sql`
        UPDATE bank_transactions SET status = 'stripe_payout', payout_id = ${payouts[0]?.id ?? null},
          auto_matched = TRUE
        WHERE id = ${id} AND status = 'unmatched';
      `;
      matched++;
      continue;
    }

    const { rows: candidates } = await sql.query(
      `SELECT e.id, ABS(e.entry_date - $2::date) AS gap
       FROM finance_entries e
       WHERE (CASE WHEN e.kind = 'received' THEN e.amount_cents ELSE -e.amount_cents END) = $1
         AND (e.method IS NULL OR e.method = ANY($3::text[]))
         AND ABS(e.entry_date - $2::date) <= $4
         AND NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE b.entry_id = e.id)
       ORDER BY gap, e.id
       LIMIT 2;`,
      [amount, date, BANK_METHODS, AUTO_MATCH_DAYS],
    );
    if (candidates.length === 0) continue;
    if (candidates.length === 2 && candidates[0].gap === candidates[1].gap) continue;
    const { rowCount } = await sql`
      UPDATE bank_transactions SET status = 'matched', entry_id = ${candidates[0].id as number},
        auto_matched = TRUE
      WHERE id = ${id} AND status = 'unmatched';
    `;
    if (rowCount) matched++;
  }
  return matched;
}

export async function setBankTransactionStatus(
  id: number,
  status: BankStatus,
  entryId: number | null = null,
): Promise<void> {
  await ensureFinanceTables();
  if (status === "matched" && !entryId) throw new Error("Choose the entry to match.");
  await sql`
    UPDATE bank_transactions SET
      status = ${status},
      entry_id = ${status === "matched" ? entryId : null},
      payout_id = CASE WHEN ${status} = 'stripe_payout' THEN payout_id ELSE NULL END,
      auto_matched = FALSE
    WHERE id = ${id};
  `;
}

export async function getBankTransaction(id: number): Promise<BankTransaction | null> {
  const list = await listBankTransactions({ id });
  return list[0] ?? null;
}

export async function listBankTransactions({
  id,
  status,
  from,
  reconciled,
  limit = 500,
}: {
  id?: number;
  status?: BankStatus;
  from?: string | null;
  reconciled?: boolean;
  limit?: number;
}): Promise<BankTransaction[]> {
  await ensureFinanceTables();
  const where: string[] = [];
  const params: (string | number)[] = [];
  const add = (clause: (p: string) => string, v: string | number) => {
    params.push(v);
    where.push(clause(`$${params.length}`));
  };
  if (id) add((p) => `b.id = ${p}`, id);
  if (status) add((p) => `b.status = ${p}`, status);
  if (from) add((p) => `b.txn_date >= ${p}::date`, from);
  if (reconciled === true) where.push(`b.status <> 'unmatched'`);
  params.push(limit);
  const { rows } = await sql.query(
    `SELECT b.id, b.source, b.account, b.txn_date::text AS d, b.description, b.reference,
       b.amount_cents, b.balance_cents, b.status, b.entry_id, e.name AS entry_name,
       b.payout_id, b.auto_matched
     FROM bank_transactions b
     LEFT JOIN finance_entries e ON e.id = b.entry_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY b.txn_date ${reconciled ? "DESC" : "ASC"}, b.id ${reconciled ? "DESC" : "ASC"}
     LIMIT $${params.length};`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    account: r.account,
    date: r.d,
    description: r.description,
    reference: r.reference,
    amountCents: toInt(r.amount_cents),
    balanceCents: r.balance_cents === null ? null : toInt(r.balance_cents),
    status: r.status,
    entryId: r.entry_id,
    entryName: r.entry_name,
    payoutId: r.payout_id,
    autoMatched: r.auto_matched,
  }));
}

// Unlinked ledger entries a bank line could be matched to: same signed
// amount first, then anything nearby in date, so the treasurer can also
// match a line whose amount was typed slightly differently (and fix it).
export async function findMatchCandidates(
  amountCents: number,
  date: string,
): Promise<(FinanceEntry & { exact: boolean })[]> {
  const kind: FinanceKind = amountCents > 0 ? "received" : "spent";
  const { rows } = await sql.query(
    `SELECT e.id, e.kind, e.name, e.category, e.method, e.person, e.entry_date::text AS entry_date,
       e.amount_cents, e.notes, e.origin, e.external_url,
       (e.amount_cents = $1) AS exact
     FROM finance_entries e
     WHERE e.kind = $2
       AND ABS(e.entry_date - $3::date) <= 45
       AND (e.method IS NULL OR e.method <> 'stripe')
       AND NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE b.entry_id = e.id)
     ORDER BY (e.amount_cents = $1) DESC, ABS(e.entry_date - $3::date), e.id
     LIMIT 8;`,
    [Math.abs(amountCents), kind, date],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    category: r.category,
    method: r.method,
    person: r.person,
    entryDate: r.entry_date,
    amountCents: toInt(r.amount_cents),
    notes: r.notes,
    origin: r.origin,
    hasReceipt: false,
    receiptContentType: null,
    externalUrl: r.external_url,
    exact: r.exact,
  }));
}

// Ledger entries paid through the bank (transfer / card) since `from` that
// no bank line has been matched to yet — either not cleared yet, or
// recorded with the wrong amount/method.
export async function listEntriesMissingFromBank(from: string | null): Promise<FinanceEntry[]> {
  const { rows } = await sql.query(
    `SELECT e.id, e.kind, e.name, e.category, e.method, e.person, e.entry_date::text AS entry_date,
       e.amount_cents, e.notes, e.origin, e.external_url
     FROM finance_entries e
     WHERE e.method IN ('bank_transfer', 'card')
       ${from ? "AND e.entry_date >= $1::date" : ""}
       AND NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE b.entry_id = e.id)
     ORDER BY e.entry_date DESC, e.id DESC
     LIMIT 200;`,
    from ? [from] : [],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    category: r.category,
    method: r.method,
    person: r.person,
    entryDate: r.entry_date,
    amountCents: toInt(r.amount_cents),
    notes: r.notes,
    origin: r.origin,
    hasReceipt: false,
    receiptContentType: null,
    externalUrl: r.external_url,
  }));
}

// ── Money held ────────────────────────────────────────────────────────────

export type FundsSummary = {
  opening: OpeningBalances | null;
  bankComputedCents: number | null;
  bankReported: ReportedBankBalance | null;
  latestStatementBalance: { cents: number; date: string } | null;
  cashOnHandCents: number | null;
  bankLines: number;
  unreconciledLines: number;
  unreconciledCents: number;
};

export async function getFundsSummary(): Promise<FundsSummary> {
  await ensureFinanceTables();
  const [opening, bankReported] = await Promise.all([getOpeningBalances(), getReportedBankBalance()]);
  const from = opening?.date ?? null;

  const { rows: bankRows } = await sql.query(
    `SELECT
       COALESCE(SUM(amount_cents), 0) AS total,
       COUNT(*)::int AS n,
       COUNT(*) FILTER (WHERE status = 'unmatched')::int AS open_n,
       COALESCE(SUM(ABS(amount_cents)) FILTER (WHERE status = 'unmatched'), 0) AS open_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('cash_deposit', 'cash_withdrawal')), 0) AS cash_moves
     FROM bank_transactions
     ${from ? "WHERE txn_date >= $1::date" : ""};`,
    from ? [from] : [],
  );
  const b = bankRows[0];

  const { rows: latest } = await sql`
    SELECT txn_date::text AS d, balance_cents FROM bank_transactions
    WHERE balance_cents IS NOT NULL
    ORDER BY txn_date DESC, id DESC LIMIT 1;
  `;

  let cashOnHandCents: number | null = null;
  if (opening) {
    const { rows: cash } = await sql`
      SELECT COALESCE(SUM(CASE WHEN kind = 'received' THEN amount_cents ELSE -amount_cents END), 0) AS net
      FROM finance_entries WHERE method = 'cash' AND entry_date >= ${opening.date}::date;
    `;
    // A deposit is a + bank line (cash leaves the tin), a withdrawal a −
    // line (cash arrives in the tin) — both are "minus the bank amount".
    cashOnHandCents = opening.cashCents + toInt(cash[0].net) - toInt(b.cash_moves);
  }

  return {
    opening,
    bankComputedCents: opening ? opening.bankCents + toInt(b.total) : null,
    bankReported,
    latestStatementBalance: latest[0]
      ? { cents: toInt(latest[0].balance_cents), date: latest[0].d }
      : null,
    cashOnHandCents,
    bankLines: b.n,
    unreconciledLines: b.open_n,
    unreconciledCents: toInt(b.open_cents),
  };
}

// The club's money at the START of `date` (bank, cash on hand, Stripe),
// rebuilt from the opening balances forward. Null before the opening date —
// there's nothing to build from.
//
// Stripe's balance at a date is everything the ledger recorded through
// Stripe before it (payments − fees − refunds), minus the payouts already
// sent to the bank. That relies on the Stripe import holding full history,
// which the first sync does.
export async function getFundsAt(
  date: string,
): Promise<{ bankCents: number; cashCents: number; stripeCents: number } | null> {
  const opening = await getOpeningBalances();
  if (!opening || date < opening.date) return null;
  const { rows } = await sql`
    SELECT
      (SELECT COALESCE(SUM(amount_cents), 0) FROM bank_transactions
        WHERE txn_date >= ${opening.date}::date AND txn_date < ${date}::date) AS bank,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM bank_transactions
        WHERE status IN ('cash_deposit', 'cash_withdrawal')
          AND txn_date >= ${opening.date}::date AND txn_date < ${date}::date) AS cash_moves,
      (SELECT COALESCE(SUM(CASE WHEN kind = 'received' THEN amount_cents ELSE -amount_cents END), 0)
        FROM finance_entries WHERE method = 'cash'
          AND entry_date >= ${opening.date}::date AND entry_date < ${date}::date) AS cash_net,
      (SELECT COALESCE(SUM(CASE WHEN kind = 'received' THEN amount_cents ELSE -amount_cents END), 0)
        FROM finance_entries WHERE method = 'stripe' AND entry_date < ${date}::date) AS stripe_net,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM stripe_payouts
        WHERE created_date < ${date}::date AND COALESCE(status, 'paid') NOT IN ('failed', 'canceled')) AS payouts;
  `;
  const r = rows[0];
  return {
    bankCents: opening.bankCents + toInt(r.bank),
    cashCents: opening.cashCents + toInt(r.cash_net) - toInt(r.cash_moves),
    stripeCents: toInt(r.stripe_net) - toInt(r.payouts),
  };
}
