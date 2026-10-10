import { db, sql } from "@vercel/postgres";
import { ensureFinanceTables } from "./finance-db";
import type { FinanceEntry, FinanceKind } from "./finance";
import {
  payeeKey,
  suggestForLine,
  type MatchEntry,
  type MatchLine,
  type MatchPayout,
  type MatchRule,
  type Suggestion,
} from "./bank-match";

// Bank feed + reconciliation storage. See finance-db.ts for the tables.
//
// Reconciliation model (deliberately simple — one bank account, cash on
// hand, and the Stripe balance):
//
//   every bank line is either
//     matched          → to one or more ledger entries that add up to it
//                        (expense paid by transfer/card, income received by
//                        transfer, two invoices paid in one transfer, …)
//     stripe_payout    → Stripe moving the club's own money to the bank; the
//                        underlying payments are already in the ledger
//     cash_deposit     → cash on hand banked (credit)
//     cash_withdrawal  → cash taken out to hold as cash (debit)
//     internal         → transfer between the club's own accounts
//     ignored          → not club money (e.g. a mistaken payment reversed)
//     unmatched        → still to do
//
// Bank balance  = opening bank balance + every bank line since the opening date
// Cash on hand  = opening cash + unbanked ledger cash in − cash out
//                 − deposits marked "cash deposit" + cash withdrawn
//                 (a deposit MATCHED to cash entries banks exactly those
//                 entries, so they drop out of "unbanked" instead)
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
  entries: { id: number; name: string; date: string }[];
  payoutId: string | null;
  autoMatched: boolean;
  matchReason: string | null;
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
//
// A bank line can be matched to ONE OR MORE ledger entries (bank_matches);
// each entry is matched to at most one bank line. The entries' signed
// amounts must add up to the bank line exactly — any gap is booked as its
// own entry (e.g. a bank fee) so the books always balance to the cent.

// How far either side of a bank line to look for entries to match — wide
// enough for cash that sat in the tin for a few weeks before banking.
const CANDIDATE_DAYS = 60;

type DbClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };

// Runs `fn` inside a transaction so a multi-entry match (and its
// difference entry) lands all together or not at all.
async function inTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client as unknown as DbClient);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export class MatchError extends Error {}

export type MatchAdjustment = { category: string; name: string };

// Matches a bank line to one or more ledger entries. If the entries don't
// add up to the bank amount, `adjustment` books the difference as a new
// entry (dated on the bank line, paid by bank transfer) — otherwise the
// match is refused. Re-checks everything inside the transaction, so two
// admins (or the nightly auto-match) can't double-match an entry.
export async function matchBankLine(
  bankTxnId: number,
  entryIds: number[],
  {
    auto = false,
    reason = null,
    adjustment = null,
  }: { auto?: boolean; reason?: string | null; adjustment?: MatchAdjustment | null } = {},
): Promise<{ adjustmentEntryId: number | null }> {
  await ensureFinanceTables();
  const ids = [...new Set(entryIds)].filter((n) => Number.isSafeInteger(n) && n > 0);
  if (ids.length === 0 && !adjustment) throw new MatchError("Choose at least one entry to match.");

  return inTransaction(async (client) => {
    const { rows: lines } = await client.query(
      `SELECT id, txn_date::text AS d, description, amount_cents, status
       FROM bank_transactions WHERE id = $1 FOR UPDATE;`,
      [bankTxnId],
    );
    const line = lines[0];
    if (!line) throw new MatchError("That bank line no longer exists.");
    if (line.status !== "unmatched") throw new MatchError("That bank line is already reconciled.");
    const bankAmount = toInt(line.amount_cents);

    const { rows: entries } = ids.length
      ? await client.query(
          `SELECT e.id, CASE WHEN e.kind = 'received' THEN e.amount_cents ELSE -e.amount_cents END AS signed,
             EXISTS (SELECT 1 FROM bank_matches m WHERE m.entry_id = e.id) AS taken
           FROM finance_entries e WHERE e.id = ANY($1::int[]) FOR UPDATE;`,
          [ids],
        )
      : { rows: [] as Record<string, unknown>[] };
    if (entries.length !== ids.length) throw new MatchError("One of those entries no longer exists.");
    if (entries.some((e) => e.taken)) {
      throw new MatchError("One of those entries is already matched to another bank line.");
    }

    const sum = entries.reduce((t, e) => t + toInt(e.signed), 0);
    const difference = bankAmount - sum;
    let adjustmentEntryId: number | null = null;
    if (difference !== 0) {
      if (!adjustment) {
        throw new MatchError(
          `Those entries come to ${(sum / 100).toFixed(2)}, but the bank line is ${(bankAmount / 100).toFixed(2)}.`,
        );
      }
      const { rows: created } = await client.query(
        `INSERT INTO finance_entries (kind, name, category, method, entry_date, amount_cents, origin)
         VALUES ($1, $2, $3, 'bank_transfer', $4::date, $5, 'manual') RETURNING id;`,
        [difference > 0 ? "received" : "spent", adjustment.name, adjustment.category, line.d, Math.abs(difference)],
      );
      adjustmentEntryId = created[0].id as number;
      ids.push(adjustmentEntryId);
    }

    await client.query(
      `INSERT INTO bank_matches (bank_txn_id, entry_id) SELECT $1, unnest($2::int[]);`,
      [bankTxnId, ids],
    );
    await client.query(
      `UPDATE bank_transactions SET status = 'matched', auto_matched = $2, match_reason = $3, payout_id = NULL
       WHERE id = $1;`,
      [bankTxnId, auto, reason],
    );
    return { adjustmentEntryId };
  });
}

// Classifies a bank line as something other than a ledger match (or puts
// it back to "unmatched"). Any entry matches it had are released.
export async function setBankTransactionStatus(id: number, status: Exclude<BankStatus, "matched">): Promise<void> {
  await ensureFinanceTables();
  await sql`DELETE FROM bank_matches WHERE bank_txn_id = ${id};`;
  await sql`
    UPDATE bank_transactions SET
      status = ${status},
      payout_id = CASE WHEN ${status} = 'stripe_payout' THEN payout_id ELSE NULL END,
      auto_matched = FALSE,
      match_reason = NULL
    WHERE id = ${id};
  `;
}

// ── Bank rules ────────────────────────────────────────────────────────────

const toRule = (r: Record<string, unknown>): MatchRule => ({
  id: r.id as number,
  pattern: r.pattern as string,
  direction: r.direction as "in" | "out",
  action: r.action as "create" | "classify",
  status: (r.status as string | null) ?? null,
  category: (r.category as string | null) ?? null,
  name: (r.name as string | null) ?? null,
  method: (r.method as string | null) ?? null,
  person: (r.person as string | null) ?? null,
  auto: r.auto as boolean,
  hits: r.hits as number,
});

export async function listBankRules(): Promise<MatchRule[]> {
  await ensureFinanceTables();
  const { rows } = await sql`SELECT * FROM bank_rules ORDER BY hits DESC, last_used_at DESC NULLS LAST;`;
  return rows.map(toRule);
}

// Remembers what the treasurer did with a bank line, keyed on its payee,
// so the next line from the same payee gets the same treatment suggested.
// Repeating the same choice raises its count; a different choice for the
// same payee replaces the old one (the latest decision wins).
export async function learnBankRule(
  description: string,
  amountCents: number,
  action:
    | { action: "classify"; status: BankStatus }
    | { action: "create"; category: string; name: string; method: string | null; person: string | null },
): Promise<void> {
  const pattern = payeeKey(description);
  if (!pattern) return;
  await ensureFinanceTables();
  const direction = amountCents > 0 ? "in" : "out";
  const v =
    action.action === "classify"
      ? { status: action.status, category: null, name: null, method: null, person: null }
      : { status: null, category: action.category, name: action.name, method: action.method, person: action.person };
  await sql`
    INSERT INTO bank_rules (pattern, direction, action, status, category, name, method, person, hits, last_used_at)
    VALUES (${pattern}, ${direction}, ${action.action}, ${v.status}, ${v.category}, ${v.name}, ${v.method}, ${v.person}, 1, NOW())
    ON CONFLICT (pattern, direction) DO UPDATE SET
      hits = CASE
        WHEN bank_rules.action = EXCLUDED.action
          AND COALESCE(bank_rules.status, '') = COALESCE(EXCLUDED.status, '')
          AND COALESCE(bank_rules.category, '') = COALESCE(EXCLUDED.category, '')
        THEN bank_rules.hits + 1 ELSE 1 END,
      auto = CASE
        WHEN bank_rules.action = EXCLUDED.action
          AND COALESCE(bank_rules.status, '') = COALESCE(EXCLUDED.status, '')
          AND COALESCE(bank_rules.category, '') = COALESCE(EXCLUDED.category, '')
        THEN bank_rules.auto ELSE FALSE END,
      action = EXCLUDED.action,
      status = EXCLUDED.status,
      category = EXCLUDED.category,
      name = EXCLUDED.name,
      method = EXCLUDED.method,
      person = EXCLUDED.person,
      last_used_at = NOW();
  `;
}

export async function setBankRuleAuto(id: number, auto: boolean): Promise<void> {
  await sql`UPDATE bank_rules SET auto = ${auto} WHERE id = ${id};`;
}

export async function deleteBankRule(id: number): Promise<void> {
  await sql`DELETE FROM bank_rules WHERE id = ${id};`;
}

// Applies a rule to a bank line: classifies it, or records a new ledger
// entry from the rule (dated on the bank line, for its exact amount) and
// matches the two.
export async function applyBankRule(bankTxnId: number, ruleId: number, { auto = false } = {}): Promise<void> {
  await ensureFinanceTables();
  const [{ rows: lines }, { rows: rules }] = await Promise.all([
    sql`SELECT id, status FROM bank_transactions WHERE id = ${bankTxnId};`,
    sql`SELECT * FROM bank_rules WHERE id = ${ruleId};`,
  ]);
  const line = lines[0];
  const rule = rules[0] ? toRule(rules[0]) : null;
  if (!line || !rule) throw new MatchError("That bank line or rule no longer exists.");
  if (line.status !== "unmatched") throw new MatchError("That bank line is already reconciled.");
  const reason = `${auto ? "Bank rule (automatic)" : "Bank rule"}: “${rule.pattern}”`;

  if (rule.action === "classify" && rule.status && isBankStatus(rule.status) && rule.status !== "matched") {
    await setBankTransactionStatus(bankTxnId, rule.status);
    await sql`UPDATE bank_transactions SET auto_matched = ${auto}, match_reason = ${reason} WHERE id = ${bankTxnId};`;
  } else if (rule.action === "create" && rule.category && rule.name) {
    await matchBankLine(bankTxnId, [], {
      auto,
      reason,
      adjustment: { category: rule.category, name: rule.name },
    });
    // The rule's entry is the "adjustment" for the whole amount; give it
    // the rule's method and person too.
    await sql`
      UPDATE finance_entries e SET method = COALESCE(${rule.method}, e.method), person = ${rule.person}
      FROM bank_matches m WHERE m.bank_txn_id = ${bankTxnId} AND m.entry_id = e.id;
    `;
  } else {
    throw new MatchError("That rule is incomplete.");
  }
  await sql`UPDATE bank_rules SET hits = hits + 1, last_used_at = NOW() WHERE id = ${ruleId};`;
}

// ── Smart suggestions & auto-matching ─────────────────────────────────────

type LineRow = MatchLine & { status: BankStatus };

// Everything the matcher needs: unreconciled lines; unlinked ledger entries
// that reach the bank line by line (transfer / card / other) or inside a
// cash deposit (cash) — Stripe entries arrive as payouts instead; Stripe
// payouts not yet tied to a bank line; and the learned rules.
async function loadMatchingPool(): Promise<{
  lines: LineRow[];
  entries: MatchEntry[];
  payouts: MatchPayout[];
  rules: MatchRule[];
}> {
  const [{ rows: lineRows }, { rows: entryRows }, { rows: payoutRows }, rules] = await Promise.all([
    sql`
      SELECT id, txn_date::text AS d, description, reference, amount_cents, status
      FROM bank_transactions WHERE status = 'unmatched' ORDER BY txn_date, id;
    `,
    sql.query(
      `SELECT e.id, e.entry_date::text AS d, e.name, e.person, e.notes, e.method,
         CASE WHEN e.kind = 'received' THEN e.amount_cents ELSE -e.amount_cents END AS signed
       FROM finance_entries e
       WHERE (e.method IS NULL OR e.method <> 'stripe')
         AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.entry_id = e.id)
         AND e.entry_date >= (SELECT COALESCE(MIN(txn_date), CURRENT_DATE) FROM bank_transactions WHERE status = 'unmatched') - $1::int;`,
      [CANDIDATE_DAYS],
    ),
    sql`
      SELECT p.id, p.amount_cents, p.arrival_date::text AS d FROM stripe_payouts p
      WHERE COALESCE(p.status, 'paid') NOT IN ('failed', 'canceled')
        AND NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE b.payout_id = p.id);
    `,
    listBankRules(),
  ]);
  return {
    lines: lineRows.map((r) => ({
      id: r.id,
      date: r.d,
      description: r.description,
      reference: r.reference,
      amountCents: toInt(r.amount_cents),
      status: r.status,
    })),
    entries: entryRows.map((r) => ({
      id: r.id,
      date: r.d,
      name: r.name,
      person: r.person,
      notes: r.notes,
      method: r.method,
      signedCents: toInt(r.signed),
    })),
    payouts: payoutRows.map((r) => ({ id: r.id, amountCents: toInt(r.amount_cents), arrivalDate: r.d })),
    rules,
  };
}

function nearby(entries: MatchEntry[], date: string): MatchEntry[] {
  const t = Date.parse(`${date}T00:00:00Z`);
  return entries.filter((e) => Math.abs(Date.parse(`${e.date}T00:00:00Z`) - t) <= CANDIDATE_DAYS * 86_400_000);
}

// Runs the matcher over every unreconciled line, oldest first. Whatever a
// suggestion uses (entries, a payout) is taken out of the pool, so two
// lines are never pointed at the same thing.
function suggestAll(pool: Awaited<ReturnType<typeof loadMatchingPool>>): Map<number, Suggestion> {
  let entries = pool.entries;
  let payouts = pool.payouts;
  const out = new Map<number, Suggestion>();
  for (const line of pool.lines) {
    const s = suggestForLine(line, nearby(entries, line.date), pool.rules, payouts);
    if (!s) continue;
    out.set(line.id, s);
    if (s.kind === "entries") entries = entries.filter((e) => !s.entryIds.includes(e.id));
    if (s.kind === "payout") payouts = payouts.filter((p) => p.id !== s.payoutId);
  }
  return out;
}

// Suggestions for every unreconciled line, for the bank page.
export async function getBankSuggestions(): Promise<Map<number, Suggestion>> {
  await ensureFinanceTables();
  return suggestAll(await loadMatchingPool());
}

// Marks a bank credit as a Stripe payout, linked to Stripe's record of it.
export async function markStripePayout(
  bankTxnId: number,
  payoutId: string | null,
  { auto = false, reason = null }: { auto?: boolean; reason?: string | null } = {},
): Promise<void> {
  await ensureFinanceTables();
  const { rowCount } = await sql`
    UPDATE bank_transactions SET status = 'stripe_payout', payout_id = ${payoutId},
      auto_matched = ${auto}, match_reason = ${reason}
    WHERE id = ${bankTxnId} AND status = 'unmatched'
      AND (${payoutId}::text IS NULL OR NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE b.payout_id = ${payoutId}));
  `;
  if (!rowCount) throw new MatchError("That bank line is already reconciled, or the payout is already matched.");
}

// Applies what can be applied with confidence: Stripe payouts (by amount
// and arrival date), clear single matches, and bank rules the treasurer
// switched to automatic. Everything else stays a suggestion on the page.
export async function autoMatchBankTransactions(): Promise<number> {
  await ensureFinanceTables();
  let matched = 0;

  for (const [lineId, s] of suggestAll(await loadMatchingPool())) {
    if (!s.auto) continue;
    try {
      const reason = s.reasons.join(" · ");
      if (s.kind === "entries") await matchBankLine(lineId, s.entryIds, { auto: true, reason });
      else if (s.kind === "payout") await markStripePayout(lineId, s.payoutId, { auto: true, reason });
      else if (s.kind === "rule") await applyBankRule(lineId, s.rule.id, { auto: true });
      else continue;
      matched++;
    } catch (err) {
      // Lost a race with a human (or another run) — leave it for the page.
      if (!(err instanceof MatchError)) throw err;
    }
  }

  // A credit that says "Stripe" but matches no imported payout (e.g. the
  // payout predates the Stripe import) is still a payout, not income.
  const { rowCount } = await sql`
    UPDATE bank_transactions SET status = 'stripe_payout', auto_matched = TRUE,
      match_reason = 'Description mentions Stripe'
    WHERE status = 'unmatched' AND amount_cents > 0
      AND (description ILIKE '%stripe%' OR COALESCE(reference, '') ILIKE '%stripe%');
  `;
  return matched + (rowCount ?? 0);
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
       b.amount_cents, b.balance_cents, b.status, b.payout_id, b.auto_matched, b.match_reason,
       COALESCE(json_agg(json_build_object('id', e.id, 'name', e.name, 'date', e.entry_date::text))
         FILTER (WHERE e.id IS NOT NULL), '[]') AS entries
     FROM bank_transactions b
     LEFT JOIN bank_matches m ON m.bank_txn_id = b.id
     LEFT JOIN finance_entries e ON e.id = m.entry_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     GROUP BY b.id
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
    entries: (r.entries as { id: number; name: string; date: string }[]) ?? [],
    payoutId: r.payout_id,
    autoMatched: r.auto_matched,
    matchReason: r.match_reason,
  }));
}

function toEntry(r: Record<string, unknown>): FinanceEntry {
  return {
    id: r.id as number,
    kind: r.kind as FinanceKind,
    name: r.name as string,
    category: r.category as string,
    method: r.method as string | null,
    person: r.person as string | null,
    entryDate: r.entry_date as string,
    amountCents: toInt(r.amount_cents),
    notes: r.notes as string | null,
    origin: r.origin as "manual" | "stripe",
    hasReceipt: false,
    receiptContentType: null,
    externalUrl: r.external_url as string | null,
    bankDate: null,
  };
}

// Unlinked ledger entries a bank line could be matched to, for the manual
// "match" controls. Every method is eligible — a deposit may be cash
// takings, a payout may be Stripe payments — ranked so the likeliest come
// first: exact amount; then entries that travel through the bank the way
// this line did (bank-paid in the same direction, or cash takings before a
// deposit); then by date. Stripe entries come last (their payouts are the
// normal match) but are still there for the odd case.
export async function findMatchCandidates(
  amountCents: number,
  date: string,
  limit = 80,
): Promise<(FinanceEntry & { exact: boolean })[]> {
  const { rows } = await sql.query(
    `SELECT e.id, e.kind, e.name, e.category, e.method, e.person, e.entry_date::text AS entry_date,
       e.amount_cents, e.notes, e.origin, e.external_url,
       ((CASE WHEN e.kind = 'received' THEN e.amount_cents ELSE -e.amount_cents END) = $1) AS exact,
       CASE
         WHEN e.method = 'stripe' THEN 3
         WHEN e.method = 'cash' AND $1 > 0 AND e.entry_date <= $2::date THEN 1
         WHEN e.method = 'cash' THEN 2
         WHEN e.kind = $4 THEN 0
         ELSE 2
       END AS rank
     FROM finance_entries e
     WHERE ABS(e.entry_date - $2::date) <= $3
       AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.entry_id = e.id)
     ORDER BY exact DESC, rank, ABS(e.entry_date - $2::date), e.id
     LIMIT $5;`,
    [amountCents, date, 120, amountCents > 0 ? "received" : "spent", limit],
  );
  return rows.map((r) => ({ ...toEntry(r), exact: r.exact as boolean }));
}

export async function getEntriesByIds(ids: number[]): Promise<FinanceEntry[]> {
  if (ids.length === 0) return [];
  const { rows } = await sql.query(
    `SELECT id, kind, name, category, method, person, entry_date::text AS entry_date,
       amount_cents, notes, origin, external_url
     FROM finance_entries WHERE id = ANY($1::int[]);`,
    [ids],
  );
  return rows.map(toEntry);
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
       AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.entry_id = e.id)
     ORDER BY e.entry_date DESC, e.id DESC
     LIMIT 200;`,
    from ? [from] : [],
  );
  return rows.map(toEntry);
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
    // Cash takings matched to a bank deposit have left the tin — they're in
    // the bank now — so only unbanked cash entries count here.
    const { rows: cash } = await sql`
      SELECT COALESCE(SUM(CASE WHEN kind = 'received' THEN amount_cents ELSE -amount_cents END), 0) AS net
      FROM finance_entries e WHERE method = 'cash' AND entry_date >= ${opening.date}::date
        AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.entry_id = e.id);
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
      (SELECT COALESCE(SUM(CASE WHEN e.kind = 'received' THEN e.amount_cents ELSE -e.amount_cents END), 0)
        FROM finance_entries e WHERE e.method = 'cash'
          AND e.entry_date >= ${opening.date}::date AND e.entry_date < ${date}::date
          -- takings already banked by this date have left the tin
          AND NOT EXISTS (
            SELECT 1 FROM bank_matches m JOIN bank_transactions b ON b.id = m.bank_txn_id
            WHERE m.entry_id = e.id AND b.txn_date < ${date}::date
          )) AS cash_net,
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
