import { AdminNav } from "@/components/admin/AdminNav";
import { ExportButton } from "@/components/admin/finance/ExportButton";
import { PlainSubmitButton } from "@/components/admin/PlainSubmitButton";
import { FinanceSubNav } from "@/components/admin/finance/FinanceSubNav";
import { PrintButton } from "@/components/admin/finance/PrintButton";
import styles from "@/components/admin/finance/financials.module.css";
import { getClubToday } from "@/lib/dates";
import {
  FINANCE_CATEGORIES,
  categoryLabel,
  financeFiltersToSearchParams,
  financialYearLabel,
  financialYearOf,
  financialYearRange,
  formatCents,
  formatDateKey,
  monthLabel,
  monthsBetween,
  parseFinanceFilters,
  type CategoryBreakdown,
} from "@/lib/finance";
import {
  ensureFinanceTables,
  getCategoryBreakdown,
  getEarliestEntryDate,
  getMonthlyTotals,
} from "@/lib/finance-db";
import { getFundsAt, getOpeningBalances } from "@/lib/bank-db";

export const dynamic = "force-dynamic";

const NO_FILTERS = { kind: null, category: null, method: null, q: "" } as const;

function nextDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// Accounting style: negatives in brackets, as statements are usually shown.
function acct(cents: number): string {
  return cents < 0 ? `(${formatCents(-cents)})` : formatCents(cents);
}

// Category order on the statement follows the master list (income first),
// with anything unknown at the end.
const ORDER = new Map(FINANCE_CATEGORIES.map((c, i) => [c.value, i]));

function lines(
  current: CategoryBreakdown[],
  prior: CategoryBreakdown[],
  pick: (b: CategoryBreakdown) => number,
) {
  const cats = new Set<string>();
  for (const b of [...current, ...prior]) if (pick(b) !== 0) cats.add(b.category);
  const get = (list: CategoryBreakdown[], c: string) => {
    const b = list.find((x) => x.category === c);
    return b ? pick(b) : 0;
  };
  return [...cats]
    .sort((a, b) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99))
    .map((c) => ({ category: c, current: get(current, c), prior: get(prior, c) }));
}

const sum = (list: CategoryBreakdown[], pick: (b: CategoryBreakdown) => number) =>
  list.reduce((t, b) => t + pick(b), 0);

// Annual financial report for the AGM, in the shape NZ's Tier 4 not-for-
// profit standard (PBE SFR-C) uses for small cash-basis clubs: a Statement
// of Receipts and Payments with last year alongside, then the club's cash
// and bank position at the start and end of the year.
export default async function AnnualReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { dateKey: today } = getClubToday();
  const currentFy = financialYearOf(today);

  if (!process.env.POSTGRES_URL) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Financials</h1>
        <p className={styles.subtitle}>The year&apos;s accounts, laid out for the AGM. Print it or save it as a PDF.</p>
        <AdminNav active="financials" />
        <FinanceSubNav active="report" />
        <p>Database is not configured.</p>
      </div>
    );
  }
  await ensureFinanceTables();

  const earliest = await getEarliestEntryDate();
  const firstFy = earliest ? Math.min(financialYearOf(earliest), currentFy) : currentFy;
  const fyOptions: number[] = [];
  for (let fy = currentFy; fy >= firstFy; fy--) fyOptions.push(fy);

  // Default to the last COMPLETED financial year — what an AGM reports on —
  // unless the club has no history before this one.
  const rawFy = Number(Array.isArray(params.fy) ? params.fy[0] : params.fy);
  const fy = fyOptions.includes(rawFy) ? rawFy : fyOptions.includes(currentFy - 1) ? currentFy - 1 : currentFy;
  const inProgress = fy === currentFy;

  const range = financialYearRange(fy);
  const to = inProgress ? today : range.to;
  const prior = financialYearRange(fy - 1);
  const priorTo = inProgress ? sameDayLastYear(today) : prior.to;

  const [current, previous, monthly, opening, fundsStart, fundsEnd] = await Promise.all([
    getCategoryBreakdown(parseFinanceFilters({ preset: "custom", from: range.from, to }, today)),
    getCategoryBreakdown(parseFinanceFilters({ preset: "custom", from: prior.from, to: priorTo }, today)),
    getMonthlyTotals(NO_FILTERS, { from: range.from, to }),
    getOpeningBalances(),
    getFundsAt(range.from),
    getFundsAt(nextDay(to)),
  ]);

  const receipts = lines(current, previous, (b) => b.receivedCents);
  const payments = lines(current, previous, (b) => b.spentCents);
  const totalIn = sum(current, (b) => b.receivedCents);
  const totalOut = sum(current, (b) => b.spentCents);
  const priorIn = sum(previous, (b) => b.receivedCents);
  const priorOut = sum(previous, (b) => b.spentCents);
  const surplus = totalIn - totalOut;
  const priorSurplus = priorIn - priorOut;

  const fundsTotal = (f: { bankCents: number; cashCents: number; stripeCents: number }) =>
    f.bankCents + f.cashCents + f.stripeCents;
  const expectedClose = fundsStart ? fundsTotal(fundsStart) + surplus : null;
  const difference = fundsEnd && expectedClose !== null ? fundsTotal(fundsEnd) - expectedClose : null;

  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  const months = monthsBetween(range.from, to).map(
    (month) => byMonth.get(month) ?? { month, receivedCents: 0, spentCents: 0 },
  );

  const exportQs = financeFiltersToSearchParams(
    parseFinanceFilters({ preset: "custom", from: range.from, to }, today),
  ).toString();
  const periodTitle = inProgress
    ? `Year to date — 1 April ${fy} to ${formatDateKey(today)}`
    : `Year ended 31 March ${fy + 1}`;
  const thisCol = `FY ${financialYearLabel(fy)}${inProgress ? " (to date)" : ""}`;
  const lastCol = `FY ${financialYearLabel(fy - 1)}${inProgress ? " (same period)" : ""}`;

  return (
    <div className={styles.page}>
      <div className={styles.noPrint}>
        <h1 className={styles.title}>Financials</h1>
        <p className={styles.subtitle}>The year&apos;s accounts, laid out for the AGM. Print it or save it as a PDF.</p>
        <AdminNav active="financials" />
        <FinanceSubNav active="report" />
        <form method="get" className={styles.toolbar} style={{ marginTop: 0 }}>
          <label className={styles.field}>
            <span className={styles.label}>Financial year</span>
            <select name="fy" defaultValue={String(fy)} className={styles.select}>
              {fyOptions.map((o) => (
                <option key={o} value={o}>
                  FY {financialYearLabel(o)} (1 Apr {o} – 31 Mar {o + 1}){o === currentFy ? " — in progress" : ""}
                </option>
              ))}
            </select>
          </label>
          <PlainSubmitButton loadingText="Loading…" className={styles.button} style={{ alignSelf: "flex-end" }}>
            Show
          </PlainSubmitButton>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignSelf: "flex-end" }}>
            <ExportButton href={`/api/admin/finance/export?${exportQs}`}>⤓ Excel (all transactions)</ExportButton>
            <PrintButton />
          </span>
        </form>
      </div>

      <article className={styles.report}>
        <header className={styles.reportHead}>
          <div className={styles.reportClub}>Three Wolves Badminton Club</div>
          <h2 className={styles.reportTitle}>Annual financial report</h2>
          <div className={styles.cardSub}>{periodTitle}</div>
        </header>

        <table className={styles.statement}>
          <caption>Statement of Receipts and Payments</caption>
          <thead>
            <tr>
              <th />
              <th>{thisCol}</th>
              <th>{lastCol}</th>
            </tr>
          </thead>
          <tbody>
            <tr className={styles.stmtGroup}>
              <td colSpan={3}>Receipts</td>
            </tr>
            {receipts.length === 0 ? (
              <tr className={styles.stmtIndent}>
                <td>No receipts</td>
                <td>{acct(0)}</td>
                <td>{acct(0)}</td>
              </tr>
            ) : (
              receipts.map((l) => (
                <tr key={`in-${l.category}`} className={styles.stmtIndent}>
                  <td>{categoryLabel(l.category)}</td>
                  <td>{acct(l.current)}</td>
                  <td>{acct(l.prior)}</td>
                </tr>
              ))
            )}
            <tr className={styles.stmtTotal}>
              <td>Total receipts</td>
              <td>{acct(totalIn)}</td>
              <td>{acct(priorIn)}</td>
            </tr>

            <tr className={styles.stmtGroup}>
              <td colSpan={3}>Payments</td>
            </tr>
            {payments.length === 0 ? (
              <tr className={styles.stmtIndent}>
                <td>No payments</td>
                <td>{acct(0)}</td>
                <td>{acct(0)}</td>
              </tr>
            ) : (
              payments.map((l) => (
                <tr key={`out-${l.category}`} className={styles.stmtIndent}>
                  <td>{categoryLabel(l.category)}</td>
                  <td>{acct(l.current)}</td>
                  <td>{acct(l.prior)}</td>
                </tr>
              ))
            )}
            <tr className={styles.stmtTotal}>
              <td>Total payments</td>
              <td>{acct(totalOut)}</td>
              <td>{acct(priorOut)}</td>
            </tr>
            <tr className={styles.stmtGrand}>
              <td>{surplus < 0 ? "Deficit" : "Surplus"} for the year (receipts − payments)</td>
              <td>{acct(surplus)}</td>
              <td>{acct(priorSurplus)}</td>
            </tr>
          </tbody>
        </table>

        <table className={styles.statement}>
          <caption>Cash and bank</caption>
          {fundsStart && fundsEnd ? (
            <>
              <thead>
                <tr>
                  <th />
                  <th>Start · {formatDateKey(range.from)}</th>
                  <th>End · {formatDateKey(to)}</th>
                </tr>
              </thead>
              <tbody>
                <tr className={styles.stmtIndent}>
                  <td>Bank (ANZ)</td>
                  <td>{acct(fundsStart.bankCents)}</td>
                  <td>{acct(fundsEnd.bankCents)}</td>
                </tr>
                <tr className={styles.stmtIndent}>
                  <td>Held by Stripe (awaiting payout)</td>
                  <td>{acct(fundsStart.stripeCents)}</td>
                  <td>{acct(fundsEnd.stripeCents)}</td>
                </tr>
                <tr className={styles.stmtIndent}>
                  <td>Cash on hand</td>
                  <td>{acct(fundsStart.cashCents)}</td>
                  <td>{acct(fundsEnd.cashCents)}</td>
                </tr>
                <tr className={styles.stmtGrand}>
                  <td>Total cash and bank</td>
                  <td>{acct(fundsTotal(fundsStart))}</td>
                  <td>{acct(fundsTotal(fundsEnd))}</td>
                </tr>
                <tr className={styles.stmtGroup}>
                  <td colSpan={3}>Check</td>
                </tr>
                <tr className={styles.stmtIndent}>
                  <td>Funds at start + {surplus < 0 ? "deficit" : "surplus"}</td>
                  <td />
                  <td>{acct(expectedClose!)}</td>
                </tr>
                <tr className={styles.stmtIndent}>
                  <td>
                    {difference === 0
                      ? "✓ Agrees with funds at end of year"
                      : "⚠ Unexplained difference — reconcile the bank before the AGM"}
                  </td>
                  <td />
                  <td>{acct(difference ?? 0)}</td>
                </tr>
              </tbody>
            </>
          ) : (
            <tbody>
              <tr>
                <td className={styles.hint} style={{ textAlign: "left" }}>
                  {opening
                    ? `Opening balances start on ${formatDateKey(opening.date)}, after the start of this year — set them to 1 April ${fy} or earlier on the Bank & reconciliation page to show the year's cash and bank position.`
                    : "Set opening balances on the Bank & reconciliation page to show the club's cash and bank position here."}
                </td>
              </tr>
            </tbody>
          )}
        </table>

        <table className={styles.statement}>
          <caption>By month</caption>
          <thead>
            <tr>
              <th>Month</th>
              <th>Receipts</th>
              <th>Payments</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <td>{monthLabel(m.month, { year: true })}</td>
                <td>{acct(m.receivedCents)}</td>
                <td>{acct(m.spentCents)}</td>
                <td>{acct(m.receivedCents - m.spentCents)}</td>
              </tr>
            ))}
            <tr className={styles.stmtTotal}>
              <td>Total</td>
              <td>{acct(totalIn)}</td>
              <td>{acct(totalOut)}</td>
              <td>{acct(surplus)}</td>
            </tr>
          </tbody>
        </table>

        <ol className={styles.reportNotes}>
          <li>
            Prepared on a cash basis (receipts and payments), as allowed for small not-for-profit entities under PBE
            SFR-C (NFP). Money is recorded when it is received or paid.
          </li>
          <li>
            Card payments are shown at their full amount. Stripe&apos;s processing fees and any refunds are shown as
            payments.
          </li>
          <li>The club is not registered for GST. All amounts are in New Zealand dollars.</li>
          <li>Financial year: 1 April to 31 March.</li>
        </ol>
      </article>
    </div>
  );
}

// For an in-progress year, compare against the same stretch of last year
// (1 Apr → this date last year), not last year's whole 12 months.
function sameDayLastYear(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y - 1, m - 1, d));
  // 29 Feb → 28 Feb last year.
  if (date.getUTCMonth() !== m - 1) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}
