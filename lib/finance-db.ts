import { sql } from "./database";
import type {
  CategoryBreakdown,
  FinanceEntry,
  FinanceFilters,
  FinanceKind,
  FinanceTotals,
} from "./finance";
import { ensureTables } from "./db";
import { onceThisDeploy } from "./schema-gate";

// The club's money ledger. One row per movement of money:
//
// - origin 'manual'  — typed in by an admin on /admin/financials (expenses,
//   plus any income that never touched Stripe, e.g. a sponsor's bank
//   transfer). Editable and deletable.
// - origin 'stripe'  — imported by lib/finance-stripe.ts from Stripe balance
//   transactions (card payments, their fees, refunds) and from cash invoices
//   the admin recorded as paid out-of-band. Read-only in the UI; keyed by
//   external_id so re-syncing never double-counts.
//
// amount_cents is always a positive magnitude; `kind` carries the direction.
let ensurePromise: Promise<void> | null = null;

export function ensureFinanceTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = onceThisDeploy("finance", ensureFinanceTablesImpl).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function ensureFinanceTablesImpl() {
  // The page also reads member names for the "associated person" picker.
  await ensureTables();
  await sql`
    CREATE TABLE IF NOT EXISTS finance_entries (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('received', 'spent')),
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      method TEXT,
      person TEXT,
      entry_date DATE NOT NULL,
      amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
      notes TEXT,
      origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'stripe')),
      external_id TEXT UNIQUE,
      external_url TEXT,
      receipt_url TEXT,
      receipt_access TEXT,
      receipt_content_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS finance_entries_date_idx ON finance_entries (entry_date);`;
  // Stripe payouts (Stripe balance → the club's bank account). Not income
  // or expense — kept so a bank credit from Stripe can be reconciled
  // against the exact payout it came from.
  await sql`
    CREATE TABLE IF NOT EXISTS stripe_payouts (
      id TEXT PRIMARY KEY,
      amount_cents BIGINT NOT NULL,
      created_date DATE NOT NULL,
      arrival_date DATE NOT NULL,
      status TEXT
    );
  `;
  // Lines from the club's bank account (ANZ via Akahu, CSV statement
  // import, or the inbound webhook). amount_cents is SIGNED here, as the
  // bank reports it: + money in, − money out. `status` records how the line
  // is reconciled: matched to a ledger entry, or classified as a movement
  // between the club's own pots of money (not income/expense).
  await sql`
    CREATE TABLE IF NOT EXISTS bank_transactions (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL UNIQUE,
      account TEXT,
      txn_date DATE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      reference TEXT,
      amount_cents BIGINT NOT NULL,
      balance_cents BIGINT,
      status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN (
        'unmatched', 'matched', 'stripe_payout', 'cash_deposit',
        'cash_withdrawal', 'internal', 'ignored'
      )),
      entry_id INT UNIQUE REFERENCES finance_entries(id) ON DELETE SET NULL,
      payout_id TEXT,
      auto_matched BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS bank_transactions_date_idx ON bank_transactions (txn_date);`;
  // Why a line was reconciled the way it was ("same amount · 1 day apart",
  // "Bank rule: “pioneer stadium”") — shown on the bank page.
  await sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS match_reason TEXT;`;
  // Bank line ↔ ledger entries. Many entries can make up one bank line
  // (two invoices paid in one transfer); an entry belongs to at most one
  // bank line. Supersedes the single bank_transactions.entry_id column.
  await sql`
    CREATE TABLE IF NOT EXISTS bank_matches (
      bank_txn_id INT NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
      entry_id INT NOT NULL UNIQUE REFERENCES finance_entries(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (bank_txn_id, entry_id)
    );
  `;
  // One-time carry-over of matches made before bank_matches existed;
  // idempotent (the old column is cleared once copied).
  await sql`
    INSERT INTO bank_matches (bank_txn_id, entry_id)
    SELECT id, entry_id FROM bank_transactions WHERE entry_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  `;
  await sql`UPDATE bank_transactions SET entry_id = NULL WHERE entry_id IS NOT NULL;`;
  // Learned "bank rules": what the treasurer did with a payee's lines.
  await sql`
    CREATE TABLE IF NOT EXISTS bank_rules (
      id SERIAL PRIMARY KEY,
      pattern TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      action TEXT NOT NULL CHECK (action IN ('create', 'classify')),
      status TEXT,
      category TEXT,
      name TEXT,
      method TEXT,
      person TEXT,
      auto BOOLEAN NOT NULL DEFAULT FALSE,
      hits INT NOT NULL DEFAULT 0,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (pattern, direction)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS finance_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS finance_sync_state (
      key TEXT PRIMARY KEY,
      last_started_at TIMESTAMPTZ,
      last_finished_at TIMESTAMPTZ,
      last_error TEXT
    );
  `;
}

// ── Filtering ─────────────────────────────────────────────────────────────

// Builds a parameterized WHERE clause for the non-date filters plus an
// optional date range. Values only ever go in as bind params.
function buildWhere(
  filters: Pick<FinanceFilters, "kind" | "category" | "method" | "q">,
  range: { from: string | null; to: string | null },
): { where: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const add = (clause: (p: string) => string, value: string | number) => {
    params.push(value);
    clauses.push(clause(`$${params.length}`));
  };

  if (range.from) add((p) => `entry_date >= ${p}::date`, range.from);
  if (range.to) add((p) => `entry_date <= ${p}::date`, range.to);
  if (filters.kind) add((p) => `kind = ${p}`, filters.kind);
  if (filters.category) add((p) => `category = ${p}`, filters.category);
  if (filters.method) add((p) => `method = ${p}`, filters.method);
  if (filters.q) {
    // Escape LIKE wildcards so a search for "50%" means the literal text.
    const pattern = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    add(
      (p) => `(name ILIKE ${p} OR COALESCE(person, '') ILIKE ${p} OR COALESCE(notes, '') ILIKE ${p})`,
      pattern,
    );
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

const ORDER_BY: Record<FinanceFilters["sort"], string> = {
  // id as the tiebreaker keeps same-day rows in a stable, entry order.
  "date-desc": "entry_date DESC, id DESC",
  "date-asc": "entry_date ASC, id ASC",
  "amount-desc": "amount_cents DESC, entry_date DESC, id DESC",
  "amount-asc": "amount_cents ASC, entry_date DESC, id DESC",
};

type EntryRow = {
  id: number;
  kind: FinanceKind;
  name: string;
  category: string;
  method: string | null;
  person: string | null;
  entry_date: string;
  amount_cents: string | number;
  notes: string | null;
  origin: "manual" | "stripe";
  has_receipt: boolean;
  receipt_content_type: string | null;
  external_url: string | null;
  bank_date: string | null;
};

// BIGINT comes back from the driver as a string. Every amount this app
// handles is far below 2^53, but check rather than assume — a silently
// rounded total is worse than a loud error.
function toSafeInt(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Amount out of safe range: ${value}`);
  }
  return n;
}

function mapEntry(r: EntryRow): FinanceEntry {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    category: r.category,
    method: r.method,
    person: r.person,
    entryDate: r.entry_date,
    amountCents: toSafeInt(r.amount_cents),
    notes: r.notes,
    origin: r.origin,
    hasReceipt: r.has_receipt,
    receiptContentType: r.receipt_content_type,
    externalUrl: r.external_url,
    bankDate: r.bank_date,
  };
}

const ENTRY_COLUMNS = `
  id, kind, name, category, method, person, entry_date::text AS entry_date,
  amount_cents, notes, origin, (receipt_url IS NOT NULL) AS has_receipt,
  receipt_content_type, external_url,
  (SELECT b.txn_date::text FROM bank_matches m JOIN bank_transactions b ON b.id = m.bank_txn_id
    WHERE m.entry_id = finance_entries.id) AS bank_date
`;

export async function listFinanceEntries(filters: FinanceFilters): Promise<FinanceEntry[]> {
  const { where, params } = buildWhere(filters, filters);
  const { rows } = await sql.query(
    `SELECT ${ENTRY_COLUMNS} FROM finance_entries ${where} ORDER BY ${ORDER_BY[filters.sort]};`,
    params,
  );
  return (rows as EntryRow[]).map(mapEntry);
}

// Totals are summed in Postgres over the exact same WHERE clause as the
// listing, so the figures on screen and the rows on screen can't disagree.
export async function getFinanceTotals(
  filters: Pick<FinanceFilters, "kind" | "category" | "method" | "q">,
  range: { from: string | null; to: string | null },
): Promise<FinanceTotals> {
  const { where, params } = buildWhere(filters, range);
  const { rows } = await sql.query(
    `SELECT
       COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'received'), 0) AS received,
       COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'spent'), 0) AS spent,
       COUNT(*) FILTER (WHERE kind = 'received')::int AS received_count,
       COUNT(*) FILTER (WHERE kind = 'spent')::int AS spent_count
     FROM finance_entries ${where};`,
    params,
  );
  const r = rows[0] as {
    received: string;
    spent: string;
    received_count: number;
    spent_count: number;
  };
  const receivedCents = toSafeInt(r.received);
  const spentCents = toSafeInt(r.spent);
  return {
    receivedCents,
    spentCents,
    netCents: receivedCents - spentCents,
    receivedCount: r.received_count,
    spentCount: r.spent_count,
  };
}

export async function getCategoryBreakdown(
  filters: FinanceFilters,
): Promise<CategoryBreakdown[]> {
  const { where, params } = buildWhere(filters, filters);
  const { rows } = await sql.query(
    `SELECT
       category,
       COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'received'), 0) AS received,
       COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'spent'), 0) AS spent,
       COUNT(*)::int AS count
     FROM finance_entries ${where}
     GROUP BY category
     ORDER BY
       COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'received'), 0)
       + COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'spent'), 0) DESC;`,
    params,
  );
  return (rows as { category: string; received: string; spent: string; count: number }[]).map(
    (r) => ({
      category: r.category,
      receivedCents: toSafeInt(r.received),
      spentCents: toSafeInt(r.spent),
      count: r.count,
    }),
  );
}

export type MonthlyTotal = { month: string; receivedCents: number; spentCents: number };

// Received / spent per calendar month ('YYYY-MM') over a date range, using
// the same non-date filters as the table. Months with no entries are absent;
// the caller fills the gaps.
export async function getMonthlyTotals(
  filters: Pick<FinanceFilters, "kind" | "category" | "method" | "q">,
  range: { from: string | null; to: string | null },
): Promise<MonthlyTotal[]> {
  const { where, params } = buildWhere(filters, range);
  const { rows } = await sql.query(
    `SELECT to_char(entry_date, 'YYYY-MM') AS month,
       COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'received'), 0) AS received,
       COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'spent'), 0) AS spent
     FROM finance_entries ${where}
     GROUP BY 1 ORDER BY 1;`,
    params,
  );
  return (rows as { month: string; received: string; spent: string }[]).map((r) => ({
    month: r.month,
    receivedCents: toSafeInt(r.received),
    spentCents: toSafeInt(r.spent),
  }));
}

export async function getEarliestEntryDate(): Promise<string | null> {
  const { rows } = await sql`SELECT MIN(entry_date)::text AS d FROM finance_entries;`;
  return (rows[0]?.d as string | null) ?? null;
}

// ── Manual entries ────────────────────────────────────────────────────────

export type ManualEntryInput = {
  kind: FinanceKind;
  name: string;
  category: string;
  method: string | null;
  person: string | null;
  entryDate: string;
  amountCents: number;
  notes: string | null;
};

export async function createManualEntry(input: ManualEntryInput): Promise<number> {
  const { rows } = await sql`
    INSERT INTO finance_entries (kind, name, category, method, person, entry_date, amount_cents, notes, origin)
    VALUES (
      ${input.kind}, ${input.name}, ${input.category}, ${input.method}, ${input.person},
      ${input.entryDate}, ${input.amountCents}, ${input.notes}, 'manual'
    )
    RETURNING id;
  `;
  return rows[0].id as number;
}

// Only manual rows are editable — a Stripe row is a copy of Stripe's record
// and would just be overwritten again on the next sync.
export async function updateManualEntry(id: number, input: ManualEntryInput): Promise<boolean> {
  const { rowCount } = await sql`
    UPDATE finance_entries SET
      kind = ${input.kind},
      name = ${input.name},
      category = ${input.category},
      method = ${input.method},
      person = ${input.person},
      entry_date = ${input.entryDate},
      amount_cents = ${input.amountCents},
      notes = ${input.notes},
      updated_at = NOW()
    WHERE id = ${id} AND origin = 'manual';
  `;
  if (!rowCount) return false;
  // If the edit changed the amount or direction, the bank line it's matched
  // to (alone or with other entries) no longer adds up — release that line
  // so it shows up for reconciling again.
  await sql`
    WITH line AS (
      SELECT m.bank_txn_id AS id FROM bank_matches m WHERE m.entry_id = ${id}
    ), total AS (
      SELECT COALESCE(SUM(CASE WHEN e.kind = 'received' THEN e.amount_cents ELSE -e.amount_cents END), 0) AS s
      FROM bank_matches m JOIN finance_entries e ON e.id = m.entry_id
      WHERE m.bank_txn_id = (SELECT id FROM line)
    )
    UPDATE bank_transactions b SET status = 'unmatched', auto_matched = FALSE, match_reason = NULL
    WHERE b.id = (SELECT id FROM line) AND b.amount_cents <> (SELECT s FROM total);
  `;
  await sql`
    DELETE FROM bank_matches m USING bank_transactions b
    WHERE m.bank_txn_id = b.id AND b.status = 'unmatched';
  `;
  return true;
}

export type ManualEntryRecord = ManualEntryInput & {
  id: number;
  receiptUrl: string | null;
  receiptAccess: string | null;
  receiptContentType: string | null;
};

export async function getManualEntry(id: number): Promise<ManualEntryRecord | null> {
  const { rows } = await sql`
    SELECT id, kind, name, category, method, person, entry_date::text AS entry_date,
      amount_cents, notes, receipt_url, receipt_access, receipt_content_type
    FROM finance_entries WHERE id = ${id} AND origin = 'manual';
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    category: r.category,
    method: r.method,
    person: r.person,
    entryDate: r.entry_date,
    amountCents: toSafeInt(r.amount_cents),
    notes: r.notes,
    receiptUrl: r.receipt_url,
    receiptAccess: r.receipt_access,
    receiptContentType: r.receipt_content_type,
  };
}

export async function deleteManualEntry(
  id: number,
): Promise<{ receiptUrl: string | null; receiptAccess: string | null } | null> {
  // The bank line this entry was matched to (alone or with others) no
  // longer adds up without it — put it back to "unmatched", releasing its
  // other entries too, rather than claim a match that doesn't balance.
  await sql`
    UPDATE bank_transactions SET status = 'unmatched', auto_matched = FALSE, match_reason = NULL
    WHERE id IN (SELECT bank_txn_id FROM bank_matches WHERE entry_id = ${id});
  `;
  await sql`
    DELETE FROM bank_matches WHERE bank_txn_id IN (SELECT bank_txn_id FROM bank_matches WHERE entry_id = ${id});
  `;
  const { rows } = await sql`
    DELETE FROM finance_entries WHERE id = ${id} AND origin = 'manual'
    RETURNING receipt_url, receipt_access;
  `;
  const r = rows[0];
  return r ? { receiptUrl: r.receipt_url, receiptAccess: r.receipt_access } : null;
}

export async function setEntryReceipt(
  id: number,
  receipt: { url: string; access: string; contentType: string } | null,
): Promise<void> {
  await sql`
    UPDATE finance_entries SET
      receipt_url = ${receipt?.url ?? null},
      receipt_access = ${receipt?.access ?? null},
      receipt_content_type = ${receipt?.contentType ?? null},
      updated_at = NOW()
    WHERE id = ${id};
  `;
}

export async function getEntryReceipt(
  id: number,
): Promise<{ url: string; access: string; contentType: string | null } | null> {
  const { rows } = await sql`
    SELECT receipt_url, receipt_access, receipt_content_type
    FROM finance_entries WHERE id = ${id} AND receipt_url IS NOT NULL;
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    url: r.receipt_url,
    access: r.receipt_access ?? "private",
    contentType: r.receipt_content_type,
  };
}

// Names to suggest in the "associated person" field: every member the club
// has had, newest first, plus anyone already used on a ledger entry.
export async function listKnownPeople(): Promise<string[]> {
  const { rows } = await sql`
    SELECT name FROM (
      SELECT TRIM(CONCAT_WS(' ', first_name, last_name)) AS name, MAX(created_at) AS seen
      FROM memberships GROUP BY 1
      UNION ALL
      SELECT TRIM(person) AS name, MAX(created_at) AS seen
      FROM finance_entries WHERE person IS NOT NULL GROUP BY 1
    ) t
    WHERE name <> ''
    GROUP BY name
    ORDER BY MAX(seen) DESC
    LIMIT 300;
  `;
  return rows.map((r) => r.name as string);
}

// ── Stripe sync ───────────────────────────────────────────────────────────

export type StripeLedgerLine = {
  externalId: string;
  kind: FinanceKind;
  name: string;
  category: string;
  method: string;
  person: string | null;
  entryDate: string;
  amountCents: number;
  externalUrl: string | null;
};

// Batched upsert (one statement per chunk via unnest) so a first full-
// history import is a handful of round trips, not one per payment.
// ON CONFLICT refreshes the descriptive fields of an existing Stripe row —
// a manual row can never collide because manual rows have no external_id.
export async function upsertStripeLines(lines: StripeLedgerLine[]): Promise<number> {
  const valid = lines.filter((l) => l.amountCents > 0);
  let inserted = 0;
  for (let i = 0; i < valid.length; i += 200) {
    const chunk = valid.slice(i, i + 200);
    const { rows } = await sql.query(
      `INSERT INTO finance_entries
         (external_id, kind, name, category, method, person, entry_date, amount_cents, external_url, origin)
       SELECT t.external_id, t.kind, t.name, t.category, t.method, t.person, t.entry_date, t.amount_cents, t.external_url, 'stripe'
       FROM unnest(
         $1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
         $6::text[], $7::date[], $8::bigint[], $9::text[]
       ) AS t(external_id, kind, name, category, method, person, entry_date, amount_cents, external_url)
       ON CONFLICT (external_id) DO UPDATE SET
         kind = EXCLUDED.kind,
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         method = EXCLUDED.method,
         person = EXCLUDED.person,
         entry_date = EXCLUDED.entry_date,
         amount_cents = EXCLUDED.amount_cents,
         external_url = EXCLUDED.external_url,
         updated_at = NOW()
       WHERE finance_entries.origin = 'stripe'
       RETURNING (xmax = 0) AS inserted;`,
      [
        chunk.map((l) => l.externalId),
        chunk.map((l) => l.kind),
        chunk.map((l) => l.name),
        chunk.map((l) => l.category),
        chunk.map((l) => l.method),
        chunk.map((l) => l.person),
        chunk.map((l) => l.entryDate),
        chunk.map((l) => String(l.amountCents)),
        chunk.map((l) => l.externalUrl),
      ],
    );
    inserted += rows.filter((r) => r.inserted).length;
  }
  return inserted;
}

export type SyncState = {
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastError: string | null;
};

export async function getSyncState(key: string): Promise<SyncState> {
  const { rows } = await sql`
    SELECT last_started_at, last_finished_at, last_error FROM finance_sync_state WHERE key = ${key};
  `;
  const r = rows[0];
  return {
    lastStartedAt: r?.last_started_at ? new Date(r.last_started_at) : null,
    lastFinishedAt: r?.last_finished_at ? new Date(r.last_finished_at) : null,
    lastError: r?.last_error ?? null,
  };
}

// Records a successful sync. last_started_at doubles as the next sync's
// cursor, so it's only advanced on success — a failed run is retried from
// the same point next time instead of leaving a gap.
export async function markSyncSucceeded(key: string, startedAt: Date): Promise<void> {
  await sql`
    INSERT INTO finance_sync_state (key, last_started_at, last_finished_at, last_error)
    VALUES (${key}, ${startedAt.toISOString()}, NOW(), NULL)
    ON CONFLICT (key) DO UPDATE SET
      last_started_at = EXCLUDED.last_started_at,
      last_finished_at = NOW(),
      last_error = NULL;
  `;
}

export async function markSyncFailed(key: string, error: string): Promise<void> {
  await sql`
    INSERT INTO finance_sync_state (key, last_error)
    VALUES (${key}, ${error})
    ON CONFLICT (key) DO UPDATE SET last_error = EXCLUDED.last_error;
  `;
}
