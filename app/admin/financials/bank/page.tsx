import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminLink } from "@/components/admin/AdminLink";
import { AdminNav } from "@/components/admin/AdminNav";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { FinanceSubNav } from "@/components/admin/finance/FinanceSubNav";
import { FinancialsToastBridge } from "@/components/admin/finance/FinancialsToastBridge";
import styles from "@/components/admin/finance/financials.module.css";
import { getClubToday } from "@/lib/dates";
import {
  categoryLabel,
  centsToInputValue,
  formatCents,
  formatDateKey,
  isDateKey,
  isFinanceCategory,
  lastDayOfMonth,
  methodLabel,
} from "@/lib/finance";
import type { Suggestion } from "@/lib/bank-match";
import { MatchManyPanel } from "@/components/admin/finance/MatchManyPanel";
import { ensureFinanceTables } from "@/lib/finance-db";
import { akahuConfigured, getAkahuSyncState, syncAkahu } from "@/lib/bank-akahu";
import { CsvImportError, parseBankCsv, parseMoneyToCents } from "@/lib/bank-csv";
import {
  BANK_STATUS_LABELS,
  MatchError,
  applyBankRule,
  autoMatchBankTransactions,
  deleteBankRule,
  getBankSuggestions,
  getEntriesByIds,
  markStripePayout,
  getBankTransaction,
  learnBankRule,
  listBankRules,
  matchBankLine,
  setBankRuleAuto,
  findMatchCandidates,
  getFundsSummary,
  insertBankTransactions,
  isBankStatus,
  listBankTransactions,
  listEntriesMissingFromBank,
  setBankTransactionStatus,
  setOpeningBalances,
  type BankStatus,
} from "@/lib/bank-db";
import { getStripeBalanceCents } from "@/lib/finance-stripe";

export const dynamic = "force-dynamic";

const PAGE = "/admin/financials/bank";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

async function saveOpening(formData: FormData) {
  "use server";
  const date = String(formData.get("date") ?? "");
  const bank = parseMoneyToCents(String(formData.get("bank") ?? ""));
  const cash = parseMoneyToCents(String(formData.get("cash") ?? "0") || "0");
  if (!isDateKey(date)) back({ financeError: "Please enter the opening date." });
  if (bank === null) back({ financeError: "Please enter the bank balance, like 1520.35." });
  if (cash === null || cash < 0) back({ financeError: "Cash on hand must be $0 or more." });
  await setOpeningBalances({ date, bankCents: bank, cashCents: cash });
  revalidatePath(PAGE);
  back({ notice: "Opening balances saved." });
}

async function importCsv(formData: FormData) {
  "use server";
  const file = formData.get("statement");
  if (!(file instanceof File) || file.size === 0) back({ financeError: "Choose a CSV file to import." });
  if (file.size > 3 * 1024 * 1024) back({ financeError: "That file is too big for a statement (max 3 MB)." });
  let message: string;
  try {
    const rows = parseBankCsv(await file.text(), "ANZ (CSV import)");
    const { inserted, duplicates } = await insertBankTransactions("csv", rows);
    const matched = await autoMatchBankTransactions();
    message = `Imported ${inserted} new line${inserted === 1 ? "" : "s"}${
      duplicates ? ` (${duplicates} already here, skipped)` : ""
    }; ${matched} reconciled automatically.`;
  } catch (err) {
    const msg =
      err instanceof CsvImportError ? err.message : err instanceof Error ? err.message : "Import failed";
    back({ financeError: `CSV import failed: ${msg}` });
  }
  revalidatePath(PAGE);
  back({ notice: message });
}

async function syncBank() {
  "use server";
  let message: string;
  try {
    const r = await syncAkahu();
    message = `Bank synced — ${r.inserted} new line${r.inserted === 1 ? "" : "s"}, ${r.matched} reconciled automatically.`;
  } catch (err) {
    back({ financeError: `Bank sync failed: ${err instanceof Error ? err.message : "unknown error"}` });
  }
  revalidatePath(PAGE);
  back({ notice: message });
}

async function runAutoMatch() {
  "use server";
  const matched = await autoMatchBankTransactions();
  revalidatePath(PAGE);
  back({ notice: matched ? `${matched} line${matched === 1 ? "" : "s"} reconciled automatically.` : "Nothing new to match automatically." });
}

async function reconcile(formData: FormData) {
  "use server";
  const id = Number(formData.get("id"));
  const choice = String(formData.get("choice") ?? "");
  if (!Number.isSafeInteger(id) || id <= 0) back({ financeError: "That bank line no longer exists." });
  if (choice === "new") {
    redirect(`/admin/financials?fromBank=${id}`);
  }
  const entryId = choice.startsWith("entry:") ? Number(choice.slice(6)) : null;
  if (entryId === null && (!isBankStatus(choice) || choice === "matched" || choice === "unmatched")) {
    back({ financeError: "Choose how to reconcile this line." });
  }
  let error: string | null = null;
  try {
    if (entryId !== null) {
      await matchBankLine(id, [entryId], { reason: "Matched by hand" });
    } else {
      const line = await getBankTransaction(id);
      await setBankTransactionStatus(id, choice as ClassifyStatus);
      // Remember the payee: next time it's suggested, or automatic once
      // the treasurer switches the rule on.
      if (line) await learnBankRule(line.description, line.amountCents, { action: "classify", status: choice as BankStatus });
    }
  } catch (err) {
    if (!(err instanceof MatchError)) throw err;
    error = err.message;
  }
  if (error) back({ financeError: error });
  revalidatePath(PAGE);
  back({ notice: "Reconciled." });
}

// Accepts a smart suggestion: one entry, several entries that add up, or a
// learned bank rule.
async function acceptSuggestion(formData: FormData) {
  "use server";
  const id = Number(formData.get("id"));
  const ruleId = Number(formData.get("ruleId"));
  const payoutId = String(formData.get("payoutId") ?? "");
  const status = String(formData.get("status") ?? "");
  const entryIds = formData.getAll("entryId").map(Number);
  const reason = String(formData.get("reason") ?? "").slice(0, 300) || null;
  let error: string | null = null;
  try {
    if (ruleId) await applyBankRule(id, ruleId);
    else if (payoutId) await markStripePayout(id, payoutId, { reason });
    else if (status === "cash_deposit" || status === "cash_withdrawal") {
      await setBankTransactionStatus(id, status);
    } else await matchBankLine(id, entryIds, { reason });
  } catch (err) {
    if (!(err instanceof MatchError)) throw err;
    error = err.message;
  }
  if (error) back({ financeError: error });
  revalidatePath(PAGE);
  back({
    notice: ruleId
      ? "Recorded using the bank rule."
      : payoutId
        ? "Marked as a Stripe payout."
        : status
          ? "Reconciled."
          : "Matched.",
  });
}

async function matchMany(formData: FormData) {
  "use server";
  const id = Number(formData.get("id"));
  const entryIds = formData.getAll("entryId").map(Number);
  const adjust = formData.get("adjust") === "1";
  const category = String(formData.get("adjustCategory") ?? "");
  const name = String(formData.get("adjustName") ?? "").trim().slice(0, 200);
  if (adjust && (!isFinanceCategory(category) || !name)) {
    back({ financeError: "Choose a source and a name for the difference." });
  }
  let error: string | null = null;
  try {
    await matchBankLine(id, entryIds, {
      reason: `Matched to ${entryIds.length} entr${entryIds.length === 1 ? "y" : "ies"} by hand`,
      adjustment: adjust ? { category, name } : null,
    });
  } catch (err) {
    if (!(err instanceof MatchError)) throw err;
    error = err.message;
  }
  if (error) back({ financeError: error });
  revalidatePath(PAGE);
  back({ notice: adjust ? "Matched, and the difference recorded in the ledger." : "Matched." });
}

async function updateRule(formData: FormData) {
  "use server";
  const id = Number(formData.get("ruleId"));
  const op = formData.get("op");
  if (Number.isSafeInteger(id) && id > 0) {
    if (op === "delete") await deleteBankRule(id);
    else await setBankRuleAuto(id, op === "auto-on");
  }
  revalidatePath(PAGE);
  back({
    notice:
      op === "delete"
        ? "Rule deleted."
        : op === "auto-on"
          ? "Rule will now be applied automatically."
          : "Rule switched to suggestion only.",
  });
}

async function unreconcile(formData: FormData) {
  "use server";
  const id = Number(formData.get("id"));
  if (Number.isSafeInteger(id) && id > 0) await setBankTransactionStatus(id, "unmatched");
  revalidatePath(PAGE);
  back({ notice: "Moved back to “not reconciled”." });
}

function timeAgo(date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function Money({ cents, signed }: { cents: number; signed?: boolean }) {
  return (
    <span className={`${styles.num} ${cents < 0 ? styles.amountOut : signed && cents > 0 ? styles.amountIn : ""}`}>
      {formatCents(cents, { signed })}
    </span>
  );
}

function FundCard({
  label,
  cents,
  note,
  total,
}: {
  label: string;
  cents: number | null;
  note: string;
  total?: boolean;
}) {
  return (
    <section className={`${styles.card} ${total ? styles.fundsTotal : ""}`}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{cents === null ? "—" : formatCents(cents)}</div>
      <div className={styles.statCount}>{note}</div>
    </section>
  );
}

type ClassifyStatus = Exclude<BankStatus, "matched" | "unmatched">;

// Opens the ledger on the month an entry is dated in, scrolled to and
// highlighting that entry — entries from a bank line are dated on the bank
// line, often outside the ledger's default "This month".
function ledgerLink(entryId: number, date: string): string {
  const month = date.slice(0, 7);
  const qs = new URLSearchParams({
    preset: "custom",
    from: `${month}-01`,
    to: lastDayOfMonth(month),
    focus: String(entryId),
  });
  return `/admin/financials?${qs.toString()}#entry-${entryId}`;
}

function SuggestionBox({
  lineId,
  suggestion,
  entryInfo,
  lineAmount,
}: {
  lineId: number;
  suggestion: Suggestion;
  entryInfo: Map<number, { name: string; entryDate: string; amountCents: number; kind: string }>;
  lineAmount: number;
}) {
  let title: string;
  if (suggestion.kind === "payout") {
    title = `Stripe payout of ${formatCents(lineAmount)}`;
  } else if (suggestion.kind === "classify") {
    title = `Mark as ${BANK_STATUS_LABELS[suggestion.status]}`;
  } else if (suggestion.kind === "rule") {
    const r = suggestion.rule;
    title =
      r.action === "classify" && r.status
        ? `Mark as ${BANK_STATUS_LABELS[r.status as BankStatus] ?? r.status}`
        : `Record “${r.name}” · ${categoryLabel(r.category ?? "")} · ${formatCents(Math.abs(lineAmount))}`;
  } else {
    const names = suggestion.entryIds.map((id) => entryInfo.get(id)?.name ?? `entry #${id}`);
    const shown = names.slice(0, 3).join(" + ") + (names.length > 3 ? ` + ${names.length - 3} more` : "");
    title = names.length === 1 ? `Match “${names[0]}”` : `Match ${names.length} entries: ${shown}`;
  }
  const confidence =
    suggestion.kind === "entries"
      ? suggestion.score >= 0.8
        ? "High"
        : suggestion.score >= 0.6
          ? "Medium"
          : "Low"
      : suggestion.kind === "payout"
        ? "High"
        : suggestion.kind === "classify"
          ? "Low"
          : "Rule";
  return (
    <form action={acceptSuggestion} className={styles.suggestion}>
      <input type="hidden" name="id" value={lineId} />
      <input type="hidden" name="reason" value={suggestion.reasons.join(" · ")} />
      {suggestion.kind === "rule" ? (
        <input type="hidden" name="ruleId" value={suggestion.rule.id} />
      ) : suggestion.kind === "payout" ? (
        <input type="hidden" name="payoutId" value={suggestion.payoutId} />
      ) : suggestion.kind === "classify" ? (
        <input type="hidden" name="status" value={suggestion.status} />
      ) : (
        suggestion.entryIds.map((id) => <input key={id} type="hidden" name="entryId" value={id} />)
      )}
      <span className={styles.confidence}>{confidence}</span>
      <span className={styles.suggestionTitle}>Suggested: {title}</span>
      <span className={styles.reasons}>{suggestion.reasons.join(" · ")}</span>
      <SubmitButton loadingText="Accepting…" className={styles.button}>
        Accept
      </SubmitButton>
    </form>
  );
}

const CLASSIFY_FOR_CREDIT: ClassifyStatus[] = ["stripe_payout", "cash_deposit", "internal", "ignored"];
const CLASSIFY_FOR_DEBIT: ClassifyStatus[] = ["cash_withdrawal", "internal", "ignored"];

export default async function BankPage() {
  const header = (
    <>
      <h1 className={styles.title}>Financials</h1>
      <p className={styles.subtitle}>
        Opening balances, the ANZ bank feed, and reconciling every bank line against the ledger.
      </p>
      <AdminNav active="financials" />
      <FinanceSubNav active="bank" />
      <FinancialsToastBridge />
    </>
  );

  if (!process.env.POSTGRES_URL) {
    return (
      <div className={styles.page}>
        {header}
        <p>Database is not configured.</p>
      </div>
    );
  }

  await ensureFinanceTables();
  const { dateKey: today } = getClubToday();
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
  const [funds, akahuState, stripeBalance] = await Promise.all([
    getFundsSummary(),
    akahuConfigured() ? getAkahuSyncState() : Promise.resolve(null),
    stripeConfigured ? getStripeBalanceCents().catch(() => null) : Promise.resolve(null),
  ]);
  const from = funds.opening?.date ?? null;
  const [unmatched, missing, recent] = await Promise.all([
    listBankTransactions({ status: "unmatched", from, limit: 150 }),
    listEntriesMissingFromBank(from),
    listBankTransactions({ reconciled: true, from, limit: 40 }),
  ]);
  const [candidates, suggestions, rules] = await Promise.all([
    Promise.all(unmatched.map((t) => findMatchCandidates(t.amountCents, t.date))),
    getBankSuggestions(),
    listBankRules(),
  ]);
  // Names of every entry a suggestion mentions (a cash deposit can cover
  // more takings than the candidate lists show).
  const suggestedIds = [...suggestions.values()].flatMap((s) => (s.kind === "entries" ? s.entryIds : []));
  const entryInfo = new Map(
    [...candidates.flat(), ...(await getEntriesByIds(suggestedIds))].map((c) => [c.id, c]),
  );

  // The bank figure to trust: the bank's own reported balance (Akahu /
  // webhook), else the running balance on the latest statement line, else
  // opening + every imported line.
  const bankActual =
    funds.bankReported?.cents ?? funds.latestStatementBalance?.cents ?? funds.bankComputedCents;
  const bankNote = funds.bankReported
    ? `${funds.bankReported.source} · ${timeAgo(new Date(funds.bankReported.asOf))}`
    : funds.latestStatementBalance
      ? `Statement balance on ${formatDateKey(funds.latestStatementBalance.date)}`
      : funds.opening
        ? "Opening balance + imported lines"
        : "Set an opening balance below";
  const reportedForCheck = funds.bankReported?.cents ?? funds.latestStatementBalance?.cents ?? null;
  const difference =
    reportedForCheck !== null && funds.bankComputedCents !== null
      ? reportedForCheck - funds.bankComputedCents
      : null;
  const total =
    bankActual !== null ? bankActual + (stripeBalance ?? 0) + (funds.cashOnHandCents ?? 0) : null;

  const host = (await headers()).get("host") ?? "your-domain";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const webhookUrl = `${proto}://${host}/api/bank/webhook`;

  return (
    <div className={styles.page}>
      {header}

      <div className={styles.fundsGrid}>
        <FundCard label="Bank (ANZ)" cents={bankActual} note={bankNote} />
        <FundCard
          label="Held by Stripe"
          cents={stripeBalance}
          note={stripeConfigured ? "Available + pending, paid out to the bank automatically" : "Stripe not configured"}
        />
        <FundCard
          label="Cash on hand"
          cents={funds.cashOnHandCents}
          note={funds.opening ? "Opening cash + cash in − cash out − banked" : "Set opening cash below"}
        />
        <FundCard label="Total club funds" cents={total} note={`As of ${formatDateKey(today)}`} total />
      </div>

      {funds.opening ? (
        difference === null ? null : difference === 0 ? (
          <div className={styles.checkOk}>
            ✓ Balance check: opening balance + {funds.bankLines} imported bank lines = {formatCents(funds.bankComputedCents!)},
            which matches the bank.
          </div>
        ) : (
          <div className={styles.checkWarn}>
            ⚠ Balance check: the bank reports {formatCents(reportedForCheck!)}, but the opening balance + imported lines
            come to {formatCents(funds.bankComputedCents!)} — a difference of {formatCents(difference, { signed: true })}.
            Usually that means bank lines are missing from the import (import a statement CSV covering the gap), pending
            payments the feed hasn&apos;t settled yet, or a wrong opening balance.
          </div>
        )
      ) : null}

      {funds.opening ? (
        <div className={funds.unreconciledLines ? styles.checkWarn : styles.checkOk}>
          {funds.unreconciledLines
            ? `⚠ ${funds.unreconciledLines} of ${funds.bankLines} bank lines since ${formatDateKey(funds.opening.date)} still need reconciling (${formatCents(funds.unreconciledCents)} in total).`
            : `✓ All ${funds.bankLines} bank lines since ${formatDateKey(funds.opening.date)} are reconciled.`}
        </div>
      ) : null}

      <h2 className={styles.sectionTitle}>
        Opening balances
        <span className={styles.sectionCount}>
          {funds.opening
            ? `Set: ${formatCents(funds.opening.bankCents)} in the bank and ${formatCents(funds.opening.cashCents)} cash at the start of ${formatDateKey(funds.opening.date)}`
            : "Not set yet — start here"}
        </span>
      </h2>
      <form action={saveOpening} className={`${styles.card} ${styles.inlineForm}`}>
        <label className={styles.field}>
          <span className={styles.label}>Start date</span>
          <input
            type="date"
            name="date"
            required
            className={styles.input}
            defaultValue={funds.opening?.date ?? `${Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) >= 4 ? 0 : 1)}-04-01`}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Bank balance at start of that day</span>
          <input
            name="bank"
            required
            inputMode="decimal"
            placeholder="0.00"
            className={`${styles.input} ${styles.num}`}
            defaultValue={
              funds.opening
                ? `${funds.opening.bankCents < 0 ? "-" : ""}${centsToInputValue(Math.abs(funds.opening.bankCents))}`
                : ""
            }
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Cash on hand at start of that day</span>
          <input
            name="cash"
            inputMode="decimal"
            placeholder="0.00"
            className={`${styles.input} ${styles.num}`}
            defaultValue={funds.opening ? centsToInputValue(funds.opening.cashCents) : ""}
          />
        </label>
        <SubmitButton className={styles.buttonPrimary}>Save opening balances</SubmitButton>
        <span className={styles.hint} style={{ flexBasis: "100%" }}>
          Use the balance from your ANZ statement for the start of the financial year (1 April) or whenever you start
          using this page. Reconciliation counts bank lines from this date on.
        </span>
      </form>

      <h2 className={styles.sectionTitle}>Bank feed</h2>
      <div className={styles.setupGrid}>
        <section className={styles.setupCard}>
          <h3>
            ANZ via Akahu{" "}
            <span className={`${styles.statusPill} ${akahuConfigured() ? styles.statusOn : ""}`}>
              {akahuConfigured() ? "Connected" : "Not set up"}
            </span>
          </h3>
          {akahuConfigured() ? (
            <>
              <span className={styles.hint}>
                {akahuState?.lastFinishedAt ? `Last synced ${timeAgo(akahuState.lastFinishedAt)}` : "Not synced yet"}
                {" · "}syncs nightly. Akahu refreshes from ANZ about once a day.
              </span>
              {akahuState?.lastError ? <span className={styles.hint}>Last error: {akahuState.lastError}</span> : null}
              <form action={syncBank}>
                <SubmitButton loadingText="Syncing…" className={styles.button}>
                  Sync bank now
                </SubmitButton>
              </form>
            </>
          ) : (
            <span className={styles.hint}>
              Free for your own accounts: sign up at akahu.nz, connect the club&apos;s ANZ login, create a Personal App,
              then add <code>AKAHU_APP_TOKEN</code> and <code>AKAHU_USER_TOKEN</code> in Vercel. See README.
            </span>
          )}
        </section>

        <section className={styles.setupCard}>
          <h3>Import ANZ statement (CSV)</h3>
          <span className={styles.hint}>
            ANZ Internet Banking → account → Export → CSV. Re-importing or overlapping the bank feed is safe: lines already
            here are skipped.
          </span>
          <form action={importCsv} className={styles.inlineForm}>
            <input type="file" name="statement" accept=".csv,text/csv" required />
            <SubmitButton loadingText="Importing…" className={styles.button}>
              Import
            </SubmitButton>
          </form>
        </section>

        <section className={styles.setupCard}>
          <h3>
            Inbound webhook{" "}
            <span className={`${styles.statusPill} ${process.env.BANK_WEBHOOK_SECRET ? styles.statusOn : ""}`}>
              {process.env.BANK_WEBHOOK_SECRET ? "Ready" : "Not set up"}
            </span>
          </h3>
          <span className={styles.hint}>
            For bank data pushed to the club: Akahu webhooks (full apps), or any provider or automation posting JSON with
            the secret as a Bearer token.
          </span>
          <div className={styles.code}>POST {webhookUrl}</div>
          {!process.env.BANK_WEBHOOK_SECRET ? (
            <span className={styles.hint}>
              Set <code>BANK_WEBHOOK_SECRET</code> (a long random string) in Vercel to enable it.
            </span>
          ) : null}
        </section>
      </div>

      <h2 className={styles.sectionTitle}>
        To reconcile
        <span className={styles.sectionCount}>
          {unmatched.length} bank line{unmatched.length === 1 ? "" : "s"}
          {from ? ` since ${formatDateKey(from)}` : ""}
        </span>
        <form action={runAutoMatch} style={{ marginLeft: "auto" }}>
          <SubmitButton loadingText="Matching…" className={styles.buttonGhost}>
            Auto-match again
          </SubmitButton>
        </form>
      </h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Bank description</th>
              <th className={styles.right}>Amount</th>
              <th className={styles.right}>Reconcile as</th>
            </tr>
          </thead>
          <tbody>
            {unmatched.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles.empty}>
                  {funds.bankLines === 0
                    ? "No bank lines yet — connect Akahu or import a statement CSV above."
                    : "Nothing to reconcile. 🎉"}
                </td>
              </tr>
            ) : (
              unmatched.map((t, i) => {
                const options = candidates[i];
                const statuses = t.amountCents > 0 ? CLASSIFY_FOR_CREDIT : CLASSIFY_FOR_DEBIT;
                const singles = options.filter((o) => o.kind === (t.amountCents > 0 ? "received" : "spent"));
                const suggestion = suggestions.get(t.id) ?? null;
                return (
                  <tr key={t.id}>
                    <td className={styles.num}>{formatDateKey(t.date)}</td>
                    <td>
                      <div className={styles.entryName}>{t.description}</div>
                      {t.reference ? <div className={styles.entryNotes}>{t.reference}</div> : null}
                      {suggestion ? (
                        <SuggestionBox
                          lineId={t.id}
                          suggestion={suggestion}
                          entryInfo={entryInfo}
                          lineAmount={t.amountCents}
                        />
                      ) : null}
                    </td>
                    <td className={`${styles.right}`}>
                      <Money cents={t.amountCents} signed />
                    </td>
                    <td>
                      <form action={reconcile} className={styles.reconcileForm}>
                        <input type="hidden" name="id" value={t.id} />
                        <select
                          name="choice"
                          className={styles.select}
                          defaultValue="new"
                        >
                          <option value="new">
                            ＋ Record as new {t.amountCents > 0 ? "income" : "expense"}…
                          </option>
                          {singles.length ? (
                            <optgroup label="Match to one ledger entry">
                              {singles.slice(0, 10).map((o) => (
                                <option key={o.id} value={`entry:${o.id}`} disabled={!o.exact}>
                                  {o.exact ? "" : "≠ "}
                                  {formatDateKey(o.entryDate)} · {o.name} · {formatCents(o.amountCents)}
                                  {o.exact ? "" : " (amount differs — use Match several…)"}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                          <optgroup label="Not income or expense">
                            {statuses.map((s) => (
                              <option key={s} value={s}>
                                {BANK_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        <SubmitButton loadingText="Applying…" className={styles.button}>
                          Apply
                        </SubmitButton>
                      </form>
                      <div style={{ textAlign: "right" }}>
                        <MatchManyPanel
                          bankTxnId={t.id}
                          bankAmountCents={t.amountCents}
                          description={t.description}
                          candidates={options.map((o) => ({
                            id: o.id,
                            name: o.name,
                            date: o.entryDate,
                            signedCents: o.kind === "received" ? o.amountCents : -o.amountCents,
                            exact: o.exact,
                            method: o.method,
                          }))}
                          preselected={
                            suggestion?.kind === "entries"
                              ? suggestion.entryIds.filter((id) => options.some((o) => o.id === id))
                              : []
                          }
                          action={matchMany}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className={styles.hint} style={{ marginTop: 8 }}>
        Reconciling links a bank line to entries already in the ledger — it doesn&apos;t add to the ledger by itself. To
        put a bank payment into the ledger, choose “Record as new”, or accept a bank-rule suggestion. Use “Match
        several…” when one payment covers several entries (with any difference, like a bank fee, recorded for you).
        Stripe payouts and cash deposits aren&apos;t income: the payments behind them are already in the ledger. “≠”
        entries have a different amount — fix the entry first, or use “Match several…” to record the difference.
      </p>

      <h2 className={styles.sectionTitle}>
        In the ledger, not yet seen in the bank
        <span className={styles.sectionCount}>
          {missing.length} entr{missing.length === 1 ? "y" : "ies"} paid by bank transfer or card
        </span>
      </h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Name</th>
              <th>Source</th>
              <th className={styles.right}>Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {missing.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  Every bank-paid entry has a matching bank line.
                </td>
              </tr>
            ) : (
              missing.map((e) => (
                <tr key={e.id}>
                  <td className={styles.num}>{formatDateKey(e.entryDate)}</td>
                  <td className={styles.entryName}>{e.name}</td>
                  <td>
                    {categoryLabel(e.category)}
                    <span className={styles.method}>{methodLabel(e.method)}</span>
                  </td>
                  <td className={styles.right}>
                    <Money cents={e.kind === "received" ? e.amountCents : -e.amountCents} signed />
                  </td>
                  <td className={styles.right}>
                    <AdminLink className={styles.actionLink} href={`/admin/financials?preset=all&edit=${e.id}`}>
                      Edit
                    </AdminLink>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className={styles.hint} style={{ marginTop: 8 }}>
        Normal for a payment made in the last day or two. Older ones usually have a wrong amount, date or payment method.
      </p>

      <h2 className={styles.sectionTitle}>
        Recently reconciled <span className={styles.sectionCount}>latest {recent.length}</span>
      </h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Bank description</th>
              <th className={styles.right}>Amount</th>
              <th>Reconciled as</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  Nothing reconciled yet.
                </td>
              </tr>
            ) : (
              recent.map((t) => (
                <tr key={t.id}>
                  <td className={styles.num}>{formatDateKey(t.date)}</td>
                  <td>{t.description}</td>
                  <td className={styles.right}>
                    <Money cents={t.amountCents} signed />
                  </td>
                  <td>
                    {t.status === "matched" && t.entries.length ? (
                      t.entries.map((e) => (
                        <div key={e.id}>
                          ↔{" "}
                          <AdminLink className={styles.sortLink} href={ledgerLink(e.id, e.date)}>
                            {e.name}
                          </AdminLink>{" "}
                          <span className={styles.hint}>({formatDateKey(e.date)})</span>
                        </div>
                      ))
                    ) : (
                      BANK_STATUS_LABELS[t.status]
                    )}
                    <span className={styles.method}>
                      {t.autoMatched ? "Automatic · " : ""}
                      {t.matchReason ?? ""}
                    </span>
                  </td>
                  <td className={styles.right}>
                    <form action={unreconcile}>
                      <input type="hidden" name="id" value={t.id} />
                      <SubmitButton loadingText="Undoing…" className={styles.actionLink}>
                        Undo
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className={styles.sectionTitle}>
        Bank rules
        <span className={styles.sectionCount}>learned from how you reconcile — {rules.length}</span>
      </h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When a bank line from</th>
              <th>Do</th>
              <th className={styles.right}>Used</th>
              <th>Mode</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  No rules yet. Each time you record or classify a bank line, its payee is remembered here.
                </td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={styles.entryName}>“{r.pattern}”</span>
                    <span className={styles.method}>{r.direction === "in" ? "money in" : "money out"}</span>
                  </td>
                  <td>
                    {r.action === "classify" && r.status
                      ? `Mark as ${BANK_STATUS_LABELS[r.status as BankStatus] ?? r.status}`
                      : `Record “${r.name}” as ${categoryLabel(r.category ?? "")}`}
                    {r.action === "create" && r.method ? (
                      <span className={styles.method}>
                        {methodLabel(r.method)}
                        {r.person ? ` · ${r.person}` : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className={`${styles.right} ${styles.num}`}>{r.hits}×</td>
                  <td>
                    <span className={`${styles.statusPill} ${r.auto ? styles.ruleAuto : ""}`}>
                      {r.auto ? "Automatic" : "Suggest only"}
                    </span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <form action={updateRule}>
                        <input type="hidden" name="ruleId" value={r.id} />
                        <input type="hidden" name="op" value={r.auto ? "auto-off" : "auto-on"} />
                        <SubmitButton loadingText="Saving…" className={styles.actionLink}>
                          {r.auto ? "Make suggest-only" : "Make automatic"}
                        </SubmitButton>
                      </form>
                      <form action={updateRule}>
                        <input type="hidden" name="ruleId" value={r.id} />
                        <input type="hidden" name="op" value="delete" />
                        <SubmitButton loadingText="Deleting…" className={`${styles.actionLink} ${styles.actionDanger}`}>
                          Delete
                        </SubmitButton>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className={styles.hint} style={{ marginTop: 8 }}>
        Automatic rules run on every bank sync and nightly — but never over a ledger entry that already matches the
        line, so nothing gets recorded twice. Suggest-only rules just pre-fill the suggestion for you to accept.
      </p>
    </div>
  );
}
