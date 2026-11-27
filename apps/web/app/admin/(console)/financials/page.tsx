import { clubClock } from "@/lib/club";
import { redirect } from "next/navigation";
import { ExportButton } from "@/components/admin/finance/ExportButton";
import { AdminLink } from "@/components/admin/AdminLink";
import { revalidatePath } from "next/cache";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { DeleteEntryButton } from "@/components/admin/finance/DeleteEntryButton";
import {
  EntryForm,
  type EntryFormInitial,
  type EntryFormPrefill,
  type EntryFormState,
} from "@/components/admin/finance/EntryForm";
import { FinanceFilters } from "@/components/admin/finance/FinanceFilters";
import { MonthlyChart } from "@/components/admin/finance/MonthlyChart";
import styles from "@/components/admin/finance/financials.module.css";
import { PageHeader } from "@/components/admin/kit";
import { getClubToday } from "@/lib/dates";
import {
  centsToInputValue,
  financeFiltersToSearchParams,
  formatCents,
  financialYearLabel,
  financialYearOf,
  isDateKey,
  isFinanceCategory,
  isFinanceMethod,
  parseAmountToCents,
  parseFinanceFilters,
  signedCents,
  type FinanceFilters as Filters,
  type FinanceKind,
  type FinanceTotals,
} from "@/lib/finance";
import { createManualEntry, deleteManualEntry, getManualEntry, listKnownPeople, setEntryReceipt, updateManualEntry, type ManualEntryInput } from "@/lib/finance-db";
import { loadFinanceReport } from "@/lib/finance-report";
import { MatchError, getBankTransaction, learnBankRule, matchBankLine } from "@/lib/bank-db";
import {
  deleteReceipt,
  receiptsConfigured,
  uploadReceipt,
} from "@/lib/finance-receipts";
import {
  AUTO_SYNC_AFTER_MS,
  getStripeSyncState,
  syncStripeFinance,
} from "@/lib/finance-stripe";
import { clubRoundAmount } from "@/lib/club-brand";
import { adminText } from "@/lib/admin-lang";
import { categoryLabelIn, describeNonDateFiltersIn, formatDateKeyIn, formatRangeIn, methodLabelIn, monthLabelIn, presetLabelIn } from "@/lib/finance-text";

type T = Awaited<ReturnType<typeof adminText>>["t"];

export const dynamic = "force-dynamic";

// Only these keys survive a round trip through a server action's
// "returnTo", so a crafted value can't smuggle anything else into the
// redirect URL.
function sanitizeReturnTo(raw: FormDataEntryValue | null, today: string): string {
  const params = new URLSearchParams(typeof raw === "string" ? raw : "");
  const filters = parseFinanceFilters(Object.fromEntries(params), today);
  return financeFiltersToSearchParams(filters).toString();
}

function backTo(returnTo: string, extra: Record<string, string>): string {
  const params = new URLSearchParams(returnTo);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `/admin/financials?${params.toString()}`;
}

function text(formData: FormData, key: string, max: number): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

async function saveEntry(
  _prev: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  "use server";

  const { t, lang } = await adminText();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), getClubToday(new Date(), await clubClock()).dateKey);
  const values: Record<string, string> = {};
  for (const key of ["entryDate", "amount", "method", "name", "person", "notes"]) {
    values[key] = String(formData.get(key) ?? "");
  }
  const fail = (error: string): EntryFormState => ({ error, values });

  const rawId = formData.get("id");
  const id = rawId ? Number(rawId) : null;
  if (rawId && (!Number.isSafeInteger(id) || (id as number) <= 0)) {
    return fail(t("fin_err_gone"));
  }

  const kind: FinanceKind = formData.get("kind") === "received" ? "received" : "spent";
  const name = text(formData, "name", 200);
  const category = text(formData, "category", 50);
  const method = text(formData, "method", 50);
  const person = text(formData, "person", 200);
  const notes = text(formData, "notes", 1000);
  const entryDate = text(formData, "entryDate", 10);
  const amountCents = parseAmountToCents(String(formData.get("amount") ?? ""));

  if (!name) return fail(t("fin_err_name"));
  if (!isFinanceCategory(category)) return fail(t("fin_err_source"));
  if (!isDateKey(entryDate)) return fail(t("fin_err_date"));
  if (amountCents === null) {
    return fail(t("fin_err_amount", { zero: clubRoundAmount(0), max: clubRoundAmount(1_000_000) }));
  }
  if (method && !isFinanceMethod(method)) return fail(t("fin_err_method"));

  const file = formData.get("receipt");
  const receiptFile = file instanceof File && file.size > 0 ? file : null;
  if (receiptFile && !receiptsConfigured()) {
    return fail(t("fin_err_receipts_off"));
  }

  const input: ManualEntryInput = {
    kind,
    name,
    category,
    method: method || null,
    person: person || null,
    entryDate,
    amountCents,
    notes: notes || null,
  };

  let entryId: number;
  let previousReceipt: string | null = null;
  if (id) {
    const existing = await getManualEntry(id);
    if (!existing) return fail(t("fin_err_gone2"));
    if (!(await updateManualEntry(id, input))) {
      return fail(t("fin_err_cant_edit"));
    }
    entryId = id;
    previousReceipt = existing.receiptUrl;
    if (formData.get("removeReceipt") && !receiptFile && existing.receiptUrl) {
      await setEntryReceipt(id, null);
      await deleteReceipt(existing.receiptUrl);
    }
  } else {
    entryId = await createManualEntry(input);
  }

  // Created from an unreconciled bank line → match the two, as long as the
  // amounts still agree (otherwise the treasurer reconciles it by hand).
  // Also remembers the payee as a bank rule, so the next line from them
  // is suggested (or, once switched on, recorded automatically).
  let bankNote: string | null = null;
  const bankTxnId = Number(formData.get("bankTxnId"));
  if (!id && Number.isSafeInteger(bankTxnId) && bankTxnId > 0) {
    const line = await getBankTransaction(bankTxnId);
    const signed = kind === "received" ? amountCents : -amountCents;
    if (line && line.status === "unmatched" && line.amountCents === signed) {
      try {
        await matchBankLine(bankTxnId, [entryId], { reason: "Recorded from this bank line" });
        await learnBankRule(line.description, line.amountCents, {
          action: "create",
          category,
          name,
          method: method || null,
          person: person || null,
        });
      } catch (err) {
        if (!(err instanceof MatchError)) throw err;
        bankNote = t("fin_note_not_matched", { error: err.message });
      }
    } else if (line) {
      bankNote = t("fin_note_amount_differs");
    }
  }

  let receiptError: string | null = null;
  if (receiptFile) {
    try {
      const stored = await uploadReceipt(entryId, receiptFile);
      await setEntryReceipt(entryId, stored);
      if (previousReceipt) await deleteReceipt(previousReceipt);
    } catch (err) {
      receiptError = err instanceof Error ? err.message : t("fin_err_receipt_upload");
    }
  }

  revalidatePath("/admin/financials");
  const extra = {
    saved: id ? "updated" : "new",
    ...(receiptError
      ? { financeError: t("fin_err_receipt_saved", { error: receiptError }) }
      : bankNote
        ? { financeError: bankNote }
        : {}),
  };
  if (formData.get("after") === "bank") {
    // Say where the entry went: it's dated on the bank line, which is often
    // outside the ledger's default "This month" view.
    const notice = t("fin_notice_added", { name, date: formatDateKeyIn(lang, entryDate) });
    const { saved: _saved, ...rest } = extra;
    void _saved;
    redirect(`/admin/financials/bank?${new URLSearchParams({ notice, ...rest }).toString()}`);
  }
  redirect(backTo(returnTo, extra));
}

async function deleteEntry(formData: FormData) {
  "use server";

  const { t } = await adminText();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), getClubToday(new Date(), await clubClock()).dateKey);
  const id = Number(formData.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) {
    redirect(backTo(returnTo, { financeError: t("fin_err_gone") }));
  }
  const deleted = await deleteManualEntry(id);
  if (!deleted) {
    redirect(backTo(returnTo, { financeError: t("fin_err_gone_or_locked") }));
  }
  await deleteReceipt(deleted.receiptUrl);
  revalidatePath("/admin/financials");
  redirect(backTo(returnTo, { deleted: "1" }));
}

async function syncNow(formData: FormData) {
  "use server";

  const { t } = await adminText();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), getClubToday(new Date(), await clubClock()).dateKey);
  let destination: string;
  try {
    const result = await syncStripeFinance({ full: formData.get("full") === "1" });
    destination = backTo(returnTo, { synced: String(result.imported) });
  } catch (err) {
    const message = err instanceof Error ? err.message : t("fin_err_sync");
    destination = backTo(returnTo, { financeError: t("fin_err_sync_msg", { error: message }) });
  }
  revalidatePath("/admin/financials");
  redirect(destination);
}

function timeAgo(t: T, date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return t("fin_ago_now");
  if (minutes < 60) return t("fin_ago_min", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t(hours === 1 ? "fin_ago_hour_one" : "fin_ago_hour_many", { n: hours });
  const days = Math.round(hours / 24);
  return t(days === 1 ? "fin_ago_day_one" : "fin_ago_day_many", { n: days });
}

function SummaryCard({
  title,
  subtitle,
  totals,
  t,
}: {
  title: string;
  subtitle: string;
  totals: FinanceTotals;
  t: T;
}) {
  const entries = (n: number) => t(n === 1 ? "fin_entry_one" : "fin_entry_many", { n });
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardSub}>{subtitle}</span>
      </div>
      <div className={styles.stats}>
        <div>
          <div className={styles.statLabel}>{t("fin_received")}</div>
          <div className={`${styles.statValue} ${styles.pos}`}>{formatCents(totals.receivedCents)}</div>
          <div className={styles.statCount}>
            {entries(totals.receivedCount)}
          </div>
        </div>
        <div>
          <div className={styles.statLabel}>{t("fin_spent")}</div>
          <div className={`${styles.statValue} ${styles.neg}`}>{formatCents(totals.spentCents)}</div>
          <div className={styles.statCount}>
            {entries(totals.spentCount)}
          </div>
        </div>
        <div>
          <div className={styles.statLabel}>{t("fin_net")}</div>
          <div
            className={`${styles.statValue} ${totals.netCents < 0 ? styles.neg : totals.netCents > 0 ? styles.pos : ""}`}
          >
            {formatCents(totals.netCents, { signed: true })}
          </div>
          <div className={styles.statCount}>{t("fin_received_minus_spent")}</div>
        </div>
      </div>
    </section>
  );
}

function SortHeader({
  label,
  field,
  filters,
  alignRight,
}: {
  label: string;
  field: "date" | "amount";
  filters: Filters;
  alignRight?: boolean;
}) {
  const current = filters.sort.startsWith(field) ? filters.sort : null;
  const next = current === `${field}-desc` ? `${field}-asc` : `${field}-desc`;
  const qs = financeFiltersToSearchParams(filters, { sort: next as Filters["sort"] }).toString();
  const arrow = current === `${field}-desc` ? " ↓" : current === `${field}-asc` ? " ↑" : "";
  return (
    <th className={alignRight ? styles.right : undefined} aria-sort={current ? (current.endsWith("asc") ? "ascending" : "descending") : "none"}>
      <AdminLink className={styles.sortLink} href={qs ? `/admin/financials?${qs}` : "/admin/financials"} scroll={false}>
        {label}
        {arrow}
      </AdminLink>
    </th>
  );
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, lang } = await adminText();
  const params = await searchParams;
  const { dateKey: today } = getClubToday(new Date(), await clubClock());
  const filters = parseFinanceFilters(params, today);
  const returnTo = financeFiltersToSearchParams(filters).toString();
  const selfHref = returnTo ? `/admin/financials?${returnTo}` : "/admin/financials";
  const editParam = Array.isArray(params.edit) ? params.edit[0] : params.edit;
  const editId = editParam && /^\d+$/.test(editParam) ? Number(editParam) : null;
  // ?focus=ID highlights one entry (linked from the bank page).
  const focusParam = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const focusId = focusParam && /^\d+$/.test(focusParam) ? Number(focusParam) : null;
  const fromBankParam = Array.isArray(params.fromBank) ? params.fromBank[0] : params.fromBank;
  const fromBankId = fromBankParam && /^\d+$/.test(fromBankParam) ? Number(fromBankParam) : null;

  const header = (
    <PageHeader
      title={t("fin_title")}
      subtitle={t("fin_subtitle")}
    />
  );

  if (!process.env.POSTGRES_URL) {
    return (
      <div className={styles.page}>
        {header}
        <p>{t("play_no_db")}</p>
      </div>
    );
  }

  // Keep the Stripe side fresh: if nobody (and no cron) has synced in the
  // last few minutes, sync now before reading. An incremental sync only
  // re-scans the last few days, so this is quick.
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
  let syncState = stripeConfigured ? await getStripeSyncState() : null;
  let syncError: string | null = null;
  if (
    syncState &&
    // eslint-disable-next-line react-hooks/purity -- async Server Component: runs once per request, never re-renders on the client
    (!syncState.lastFinishedAt || Date.now() - syncState.lastFinishedAt.getTime() > AUTO_SYNC_AFTER_MS)
  ) {
    try {
      await syncStripeFinance();
    } catch (err) {
      syncError = err instanceof Error ? err.message : t("fin_err_sync");
    }
    syncState = await getStripeSyncState();
  }

  const [report, people, editing, bankLine] = await Promise.all([
    loadFinanceReport(filters, today),
    listKnownPeople(),
    editId ? getManualEntry(editId) : Promise.resolve(null),
    fromBankId && !editId ? getBankTransaction(fromBankId) : Promise.resolve(null),
  ]);

  const prefill: EntryFormPrefill | null =
    bankLine && bankLine.status === "unmatched"
      ? {
          kind: bankLine.amountCents > 0 ? "received" : "spent",
          amount: centsToInputValue(Math.abs(bankLine.amountCents)),
          entryDate: bankLine.date,
          name: bankLine.description,
          notes: bankLine.reference,
          bankTxnId: bankLine.id,
        }
      : null;

  const initial: EntryFormInitial | null = editing
    ? {
        id: editing.id,
        kind: editing.kind,
        name: editing.name,
        category: editing.category,
        method: editing.method,
        person: editing.person,
        entryDate: editing.entryDate,
        amount: centsToInputValue(editing.amountCents),
        notes: editing.notes,
        hasReceipt: Boolean(editing.receiptUrl),
        receiptIsImage: Boolean(editing.receiptContentType?.startsWith("image/")),
      }
    : null;

  const nonDateFilters = describeNonDateFiltersIn(lang, filters);
  const rangeText = formatRangeIn(lang, filters.from, filters.to);
  const exportHref = `/api/admin/finance/export${returnTo ? `?${returnTo}` : ""}`;
  const { entries, totals, ytd, breakdown } = report;

  return (
    <div className={styles.page}>
      {header}

      {stripeConfigured && syncState ? (
        <div className={styles.syncBar}>
          <span>
            <span
              className={`${styles.syncDot} ${syncError || syncState.lastError ? styles.syncDotWarn : ""}`}
            />
            {syncState.lastFinishedAt
              ? t("fin_stripe_synced", { ago: timeAgo(t, syncState.lastFinishedAt) })
              : t("fin_stripe_not_synced")}
          </span>
          <form action={syncNow} style={{ display: "inline" }}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <SubmitButton loadingText={t("fin_syncing")} className={styles.buttonGhost}>
              {t("fin_sync_now")}
            </SubmitButton>
          </form>
          <details className={styles.advanced}>
            <summary>{t("fin_advanced")}</summary>
            <form action={syncNow}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="full" value="1" />
              <SubmitButton
                loadingText={t("fin_reimporting")}
                className={styles.buttonGhost}
                confirmMessage={t("fin_reimport_confirm")}
              >
                {t("fin_reimport")}
              </SubmitButton>
            </form>
          </details>
        </div>
      ) : null}

      {!stripeConfigured ? (
        <p className={styles.banner}>
          {t("fin_no_stripe")}
        </p>
      ) : syncError || syncState?.lastError ? (
        <p className={styles.banner}>
          {t("fin_sync_problem_a", { error: syncError ?? syncState?.lastError ?? "" })}
          {t("fin_sync_now")}
          {t("fin_sync_problem_b")}
        </p>
      ) : null}

      <FinanceFilters filters={filters} today={today} />

      <div className={styles.toolbar}>
        <span className={styles.rangeText}>
          {rangeText}
          {filters.preset !== "custom" ? (
            <span className={styles.rangePreset}>· {presetLabelIn(lang, filters.preset)}</span>
          ) : null}
        </span>
        <ExportButton href={exportHref}>{t("fin_export")}</ExportButton>
      </div>

      <div className={styles.summary}>
        <SummaryCard
          title={nonDateFilters.length ? t("fin_filtered_total") : t("fin_selected_period")}
          subtitle={rangeText}
          totals={totals}
          t={t}
        />
        <SummaryCard
          title={t("fin_ytd", { fy: financialYearLabel(financialYearOf(today)) })}
          subtitle={`${formatRangeIn(lang, report.ytdRange.from, report.ytdRange.to)}${
            nonDateFilters.length ? t("fin_same_filters") : ""
          }`}
          totals={ytd}
          t={t}
        />
      </div>

      <MonthlyChart
        months={report.monthly}
        title={t("fin_trend", {
          from: monthLabelIn(lang, report.monthly[0].month, { year: true }),
          to: monthLabelIn(lang, report.monthly[report.monthly.length - 1].month, { year: true }),
        })}
      />

      {breakdown.length > 0 ? (
        <details className={styles.breakdown} open={breakdown.length > 1}>
          <summary>{t("fin_breakdown")}</summary>
          <div className={styles.breakdownScroll}>
          <table className={styles.breakdownTable}>
            <thead>
              <tr>
                <th>{t("fin_col_category")}</th>
                <th>{t("fin_received")}</th>
                <th>{t("fin_spent")}</th>
                <th>{t("fin_net")}</th>
                <th>{t("fin_col_entries")}</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((b) => {
                const net = b.receivedCents - b.spentCents;
                const qs = financeFiltersToSearchParams(filters, { category: b.category }).toString();
                return (
                  <tr key={b.category}>
                    <td>
                      <AdminLink className={styles.sortLink} href={`/admin/financials?${qs}`} scroll={false}>
                        {categoryLabelIn(lang, b.category)}
                      </AdminLink>
                    </td>
                    <td className={styles.num}>{b.receivedCents ? formatCents(b.receivedCents) : "—"}</td>
                    <td className={styles.num}>{b.spentCents ? formatCents(b.spentCents) : "—"}</td>
                    <td className={`${styles.num} ${net < 0 ? styles.neg : net > 0 ? styles.pos : ""}`}>
                      {formatCents(net, { signed: true })}
                    </td>
                    <td className={styles.num}>{b.count}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>{t("fin_total")}</td>
                <td className={styles.num}>{formatCents(totals.receivedCents)}</td>
                <td className={styles.num}>{formatCents(totals.spentCents)}</td>
                <td className={styles.num}>{formatCents(totals.netCents, { signed: true })}</td>
                <td className={styles.num}>{totals.receivedCount + totals.spentCount}</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </details>
      ) : null}

      <EntryForm
        key={editing?.id ?? (prefill ? `bank-${prefill.bankTxnId}` : "new")}
        action={saveEntry}
        initial={initial}
        prefill={prefill}
        today={today}
        people={people}
        receiptsEnabled={receiptsConfigured()}
        returnTo={returnTo}
        cancelHref={prefill ? "/admin/financials/bank" : selfHref}
        defaultOpen={Boolean(editing || prefill)}
      />

      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.ledgerStack}`}>
          <thead>
            <tr>
              <th>{t("fin_col_no")}</th>
              <SortHeader label={t("fin_sort_date")} field="date" filters={filters} />
              <th>{t("fin_col_name")}</th>
              <th>{t("fin_col_type")}</th>
              <th>{t("fin_col_category")}</th>
              <th>{t("fin_col_person")}</th>
              <SortHeader label={t("fin_sort_amount")} field="amount" filters={filters} alignRight />
              <th>{t("fin_col_invoice")}</th>
              <th aria-label={t("fin_col_actions")} />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={9} className={styles.empty}>
                  {nonDateFilters.length ? t("fin_none_filtered") : t("fin_none_period")}
                </td>
              </tr>
            ) : (
              entries.map((e, i) => {
                const signed = signedCents(e);
                const editQs = new URLSearchParams(returnTo);
                editQs.set("edit", String(e.id));
                return (
                  <tr
                    key={e.id}
                    id={`entry-${e.id}`}
                    className={
                      editing?.id === e.id ? styles.rowEditing : focusId === e.id ? styles.rowFocus : undefined
                    }
                  >
                    <td className={`${styles.rowNo} ${styles.num}`}>{i + 1}</td>
                    <td className={styles.num}>{formatDateKeyIn(lang, e.entryDate)}</td>
                    <td>
                      <div className={styles.entryName}>{e.name}</div>
                      {e.notes ? <div className={styles.entryNotes}>{e.notes}</div> : null}
                    </td>
                    <td>
                      <span className={`${styles.pill} ${e.kind === "received" ? styles.pillReceived : styles.pillSpent}`}>
                        {e.kind === "received" ? t("fin_received") : t("fin_spent")}
                      </span>
                    </td>
                    <td>
                      {categoryLabelIn(lang, e.category)}
                      {e.method ? <span className={styles.method}>{methodLabelIn(lang, e.method)}</span> : null}
                    </td>
                    <td>{e.person ?? <span className={styles.hint}>—</span>}</td>
                    <td className={`${styles.right} ${styles.num} ${e.kind === "received" ? styles.amountIn : styles.amountOut}`}>
                      {formatCents(signed, { signed: true })}
                    </td>
                    <td>
                      {e.hasReceipt ? (
                        <a
                          href={`/api/admin/finance/receipts/${e.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t("fin_open_receipt")}
                        >
                          {e.receiptContentType?.startsWith("image/") && !e.receiptContentType.includes("hei") ? (
                            <img
                              src={`/api/admin/finance/receipts/${e.id}`}
                              alt={t("fin_receipt_for", { name: e.name })}
                              loading="lazy"
                              className={styles.thumb}
                            />
                          ) : (
                            <span className={styles.fileChip}>
                              {e.receiptContentType === "application/pdf" ? "PDF" : "FILE"}
                            </span>
                          )}
                        </a>
                      ) : e.externalUrl ? (
                        <a className={styles.extLink} href={e.externalUrl} target="_blank" rel="noopener noreferrer">
                          Stripe ↗
                        </a>
                      ) : (
                        <span className={styles.hint}>—</span>
                      )}
                    </td>
                    <td>
                      {e.bankDate ? (
                        <div className={styles.actions} style={{ marginBottom: 4 }}>
                          <span
                            className={`${styles.badge} ${styles.badgeBank}`}
                            title={t("fin_bank_reconciled", { date: formatDateKeyIn(lang, e.bankDate) })}
                          >
                            {t("fin_bank_badge")}
                          </span>
                        </div>
                      ) : null}
                      {e.origin === "manual" ? (
                        <div className={styles.actions}>
                          <AdminLink className={styles.actionLink} href={`/admin/financials?${editQs.toString()}`}>
                            {t("fin_edit")}
                          </AdminLink>
                          <DeleteEntryButton action={deleteEntry} id={e.id} label={e.name} returnTo={returnTo} />
                        </div>
                      ) : (
                        <div className={styles.actions}>
                          <span className={styles.badge} title={t("fin_from_stripe_title")}>
                            {t("fin_from_stripe")}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {entries.length > 0 ? (
            <tfoot>
              <tr>
                <td colSpan={9}>
                  <div className={styles.footTotals}>
                    <span>
                      {t(entries.length === 1 ? "fin_entry_one" : "fin_entry_many", { n: entries.length })}
                    </span>
                    <span>
                      {t("fin_received")} <span className={`${styles.num} ${styles.pos}`}>{formatCents(totals.receivedCents)}</span>
                    </span>
                    <span>
                      {t("fin_spent")} <span className={`${styles.num} ${styles.neg}`}>{formatCents(totals.spentCents)}</span>
                    </span>
                    <span>
                      {t("fin_net")}{" "}
                      <span className={`${styles.num} ${totals.netCents < 0 ? styles.neg : styles.pos}`}>
                        {formatCents(totals.netCents, { signed: true })}
                      </span>
                    </span>
                  </div>
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
