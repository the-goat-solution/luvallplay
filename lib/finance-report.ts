import {
  ytdRange,
  type CategoryBreakdown,
  type FinanceEntry,
  type FinanceFilters,
  type FinanceTotals,
} from "./finance";
import {
  ensureFinanceTables,
  getCategoryBreakdown,
  getFinanceTotals,
  listFinanceEntries,
} from "./finance-db";

export type FinanceReport = {
  entries: FinanceEntry[];
  totals: FinanceTotals;
  ytd: FinanceTotals;
  ytdRange: { from: string; to: string };
  breakdown: CategoryBreakdown[];
};

// Everything the Financials page and its Excel export show, loaded the same
// way for both so the spreadsheet always matches the screen.
//
// YTD keeps the non-date filters (type / source / method / search) and only
// swaps the date range for 1 Jan → today — so "Court hire, this month" sits
// next to "Court hire, year to date". With no filters it's the club's whole
// year to date.
export async function loadFinanceReport(
  filters: FinanceFilters,
  today: string,
): Promise<FinanceReport> {
  await ensureFinanceTables();
  const ytd = ytdRange(today);
  const [entries, totals, ytdTotals, breakdown] = await Promise.all([
    listFinanceEntries(filters),
    getFinanceTotals(filters, filters),
    getFinanceTotals(filters, ytd),
    getCategoryBreakdown(filters),
  ]);
  return { entries, totals, ytd: ytdTotals, ytdRange: ytd, breakdown };
}
