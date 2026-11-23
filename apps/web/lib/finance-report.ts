import {
  chartMonths,
  lastDayOfMonth,
  ytdRange,
  type CategoryBreakdown,
  type FinanceEntry,
  type FinanceFilters,
  type FinanceTotals,
} from "./finance";
import { getCategoryBreakdown, getEarliestEntryDate, getFinanceTotals, getMonthlyTotals, listFinanceEntries } from "./finance-db";

export type FinanceReport = {
  entries: FinanceEntry[];
  totals: FinanceTotals;
  ytd: FinanceTotals;
  ytdRange: { from: string; to: string };
  breakdown: CategoryBreakdown[];
  monthly: { month: string; receivedCents: number; spentCents: number }[];
};

// Everything the Financials page and its Excel export show, loaded the same
// way for both so the spreadsheet always matches the screen.
//
// YTD (financial year to date, 1 Apr → today) keeps the non-date filters
// (type / source / method / search) and only swaps the date range, so
// "Court hire, this month" sits next to "Court hire, year to date". With no
// filters it's the club's whole financial year to date.
export async function loadFinanceReport(
  filters: FinanceFilters,
  today: string,
): Promise<FinanceReport> {
  const ytd = ytdRange(today);
  const earliest = filters.from ? null : await getEarliestEntryDate();
  const months = chartMonths(filters, today, earliest);
  const chartRange = {
    from: `${months[0]}-01`,
    to: lastDayOfMonth(months[months.length - 1]),
  };
  const [entries, totals, ytdTotals, breakdown, monthlyRows] = await Promise.all([
    listFinanceEntries(filters),
    getFinanceTotals(filters, filters),
    getFinanceTotals(filters, ytd),
    getCategoryBreakdown(filters),
    getMonthlyTotals(filters, chartRange),
  ]);
  const byMonth = new Map(monthlyRows.map((r) => [r.month, r]));
  const monthly = months.map(
    (month) => byMonth.get(month) ?? { month, receivedCents: 0, spentCents: 0 },
  );
  return { entries, totals, ytd: ytdTotals, ytdRange: ytd, breakdown, monthly };
}
