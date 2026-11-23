import { clubMajor, minorToDecimal, toMinor } from "./money";
import { CLUB_CURRENCY } from "./constants";
// Shared (server + client) building blocks for the admin Financials tab:
// the category/method vocabularies, the date-range presets, money parsing
// and formatting, and the filter shape the page, the Excel export and the
// DB queries all agree on.
//
// Money is ALWAYS integer cents. Amounts are stored as a positive magnitude
// with a separate `kind` ('received' | 'spent'); the sign is only applied
// when summing or displaying. Never multiply a parsed float by 100 — see
// parseAmountToCents.

export type FinanceKind = "received" | "spent";

export const FINANCE_KINDS: { value: FinanceKind; label: string }[] = [
  { value: "received", label: "Received" },
  { value: "spent", label: "Spent" },
];

export type FinanceCategory = {
  value: string;
  label: string;
  // Which side of the ledger this category normally sits on — drives the
  // add-entry form's category list. Stripe fee/refund lines can still land
  // on the "other" side (a refunded fee is money back), which is fine.
  kind: FinanceKind;
};

export const FINANCE_CATEGORIES: FinanceCategory[] = [
  // Money in
  { value: "casual", label: "Casual sessions", kind: "received" },
  { value: "membership", label: "Memberships", kind: "received" },
  { value: "donation", label: "Donations", kind: "received" },
  { value: "sponsorship", label: "Sponsorship", kind: "received" },
  { value: "grant", label: "Grants & fundraising", kind: "received" },
  { value: "merchandise", label: "Jersey & merchandise", kind: "received" },
  { value: "other_income", label: "Other income", kind: "received" },
  // Money out
  { value: "court_hire", label: "Court hire", kind: "spent" },
  { value: "shuttlecocks", label: "Shuttlecocks", kind: "spent" },
  { value: "equipment", label: "Equipment", kind: "spent" },
  { value: "events", label: "Events & prizes", kind: "spent" },
  { value: "food", label: "Food & drinks", kind: "spent" },
  { value: "affiliation", label: "Affiliation & insurance", kind: "spent" },
  { value: "software", label: "Website & software", kind: "spent" },
  { value: "marketing", label: "Marketing & printing", kind: "spent" },
  { value: "stripe_fees", label: "Stripe fees", kind: "spent" },
  { value: "refunds", label: "Refunds", kind: "spent" },
  { value: "bank_fees", label: "Bank fees", kind: "spent" },
  { value: "other_expense", label: "Other expense", kind: "spent" },
];

const CATEGORY_LABELS = new Map(FINANCE_CATEGORIES.map((c) => [c.value, c.label]));

export function categoryLabel(value: string): string {
  return CATEGORY_LABELS.get(value) ?? value;
}

export function isFinanceCategory(value: string): boolean {
  return CATEGORY_LABELS.has(value);
}

export const FINANCE_METHODS: { value: string; label: string }[] = [
  { value: "stripe", label: "Online (Stripe)" },
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Club card / EFTPOS" },
  { value: "other", label: "Other" },
];

const METHOD_LABELS = new Map(FINANCE_METHODS.map((m) => [m.value, m.label]));

export function methodLabel(value: string | null | undefined): string {
  if (!value) return "";
  return METHOD_LABELS.get(value) ?? value;
}

export function isFinanceMethod(value: string): boolean {
  return METHOD_LABELS.has(value);
}

// ── Money ─────────────────────────────────────────────────────────────────

// Largest single entry accepted from the form — well above anything a club
// this size records, and keeps sums comfortably inside JS's safe integers.
export const MAX_ENTRY_CENTS = 100_000_000; // $1,000,000.00

// "12", "12.5", "12.50", "$1,234.56" → cents. Parsed as text on purpose:
// 0.1 + 0.2-style float error is exactly the kind of bug a finance tool
// can't have, and Number("19.99") * 100 is 1998.9999999999998.
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  // "12." is accepted as 12, as before.
  const total = toMinor(cleaned.replace(/\.$/, ""), CLUB_CURRENCY);
  if (total === null || !Number.isSafeInteger(total) || total <= 0 || total > MAX_ENTRY_CENTS) {
    return null;
  }
  return total;
}

const nzd = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: CLUB_CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Formats cents as "$1,234.56". With `signed`, positive values get a "+"
// and negative ones a true minus sign, so a column of mixed amounts lines up.
export function formatCents(cents: number, { signed = false } = {}): string {
  const formatted = nzd.format(clubMajor(Math.abs(cents)));
  if (cents < 0) return `−${formatted}`;
  if (signed && cents > 0) return `+${formatted}`;
  return formatted;
}

export function centsToInputValue(cents: number): string {
  return minorToDecimal(cents, CLUB_CURRENCY);
}

// ── Dates ─────────────────────────────────────────────────────────────────
// All date math is on 'YYYY-MM-DD' keys in UTC, so it never depends on the
// server's or browser's own timezone. "Today" is supplied by the caller as
// the club-local date (lib/dates.ts getClubToday).

export function isDateKey(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function keyFromUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// First day of the month `offset` months from (y, m) — m is 1-based.
function monthStart(y: number, m: number, offset = 0): string {
  return keyFromUTC(new Date(Date.UTC(y, m - 1 + offset, 1)));
}

// Last day of the month `offset` months from (y, m) — day 0 of the next
// month, so month lengths and leap years are handled by Date itself.
function monthEnd(y: number, m: number, offset = 0): string {
  return keyFromUTC(new Date(Date.UTC(y, m + offset, 0)));
}

export type FinancePreset =
  | "this-month"
  | "last-month"
  | "last-3-months"
  | "last-6-months"
  | "last-12-months"
  | "ytd"
  | "last-year"
  | "all"
  | "custom";

export const FINANCE_PRESETS: { value: FinancePreset; label: string }[] = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "last-3-months", label: "Last 3 months" },
  { value: "last-6-months", label: "Last 6 months" },
  { value: "last-12-months", label: "Last 12 months" },
  { value: "ytd", label: "Financial year to date" },
  { value: "last-year", label: "Last financial year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

export const DEFAULT_PRESET = "this-month" satisfies FinancePreset;

export function isFinancePreset(value: string | null | undefined): value is FinancePreset {
  return FINANCE_PRESETS.some((p) => p.value === value);
}

export function presetLabel(value: FinancePreset): string {
  return FINANCE_PRESETS.find((p) => p.value === value)?.label ?? value;
}

// Inclusive date range for a preset. "Last N months" are whole calendar
// months including the current one (Last 3 months in October = 1 Aug –
// 31 Oct), so a month is never half-counted. `null` bounds mean unbounded
// (All time).
export function resolvePresetRange(
  preset: Exclude<FinancePreset, "custom">,
  today: string,
): { from: string | null; to: string | null } {
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "this-month":
      return { from: monthStart(y, m), to: monthEnd(y, m) };
    case "last-month":
      return { from: monthStart(y, m, -1), to: monthEnd(y, m, -1) };
    case "last-3-months":
      return { from: monthStart(y, m, -2), to: monthEnd(y, m) };
    case "last-6-months":
      return { from: monthStart(y, m, -5), to: monthEnd(y, m) };
    case "last-12-months":
      return { from: monthStart(y, m, -11), to: monthEnd(y, m) };
    case "ytd":
      return ytdRange(today);
    case "last-year":
      return financialYearRange(financialYearOf(today) - 1);
    case "all":
      return { from: null, to: null };
  }
}

// ── Financial year ────────────────────────────────────────────────────────
// The club's financial year runs 1 April – 31 March (the usual NZ balance
// date for incorporated societies). A financial year is named by the
// calendar year it STARTS in: FY 2026 = 1 Apr 2026 – 31 Mar 2027, shown as
// "2026/27".

export const FINANCIAL_YEAR_START_MONTH = 4; // April

export function financialYearOf(dateKey: string): number {
  const [y, m] = dateKey.split("-").map(Number);
  return m >= FINANCIAL_YEAR_START_MONTH ? y : y - 1;
}

export function financialYearRange(fy: number): { from: string; to: string } {
  return {
    from: monthStart(fy, FINANCIAL_YEAR_START_MONTH),
    // Last day of the month before the start month, a year later.
    to: monthEnd(fy + 1, FINANCIAL_YEAR_START_MONTH, -1),
  };
}

export function financialYearLabel(fy: number): string {
  return `${fy}/${String((fy + 1) % 100).padStart(2, "0")}`;
}

// Financial year to date: 1 April of the current financial year → today.
export function ytdRange(today: string): { from: string; to: string } {
  return { from: financialYearRange(financialYearOf(today)).from, to: today };
}

// Every 'YYYY-MM' from the month of `from` to the month of `to`, inclusive.
export function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

// 'YYYY-MM' → its last day as 'YYYY-MM-DD'.
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return monthEnd(y, m);
}

export function monthLabel(month: string, { year = false } = {}): string {
  const [y, m] = month.split("-").map(Number);
  return year ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
}

// The months the trend chart covers: the selected period when it spans at
// least two months (capped to the latest 24), otherwise the current
// financial year so far — a single month on its own isn't a trend.
export function chartMonths(
  range: { from: string | null; to: string | null },
  today: string,
  earliest: string | null,
): string[] {
  const from = range.from ?? earliest ?? today;
  const to = range.to ?? today;
  let months = monthsBetween(from <= to ? from : to, to);
  if (months.length < 2) {
    months = monthsBetween(ytdRange(today).from, today);
    if (months.length < 2) months = monthsBetween(monthStart(Number(today.slice(0, 4)), Number(today.slice(5, 7)), -1), today);
  }
  return months.slice(-24);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "9 Oct 2026" — built by hand rather than toLocaleDateString so server and
// client render identically (no hydration mismatch, no timezone drift).
export function formatDateKey(key: string, { weekday = false } = {}): string {
  const [y, m, d] = key.split("-").map(Number);
  const base = `${d} ${MONTHS[m - 1]} ${y}`;
  if (!weekday) return base;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[dow]} ${base}`;
}

export function formatRange(from: string | null, to: string | null): string {
  if (!from && !to) return "All time";
  if (from && !to) return `From ${formatDateKey(from)}`;
  if (!from && to) return `Up to ${formatDateKey(to)}`;
  return `${formatDateKey(from!)} – ${formatDateKey(to!)}`;
}

// ── Filters ───────────────────────────────────────────────────────────────

export type FinanceSort = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";

const SORTS: FinanceSort[] = ["date-desc", "date-asc", "amount-desc", "amount-asc"];

export type FinanceFilters = {
  preset: FinancePreset;
  from: string | null;
  to: string | null;
  kind: FinanceKind | null;
  category: string | null;
  method: string | null;
  q: string;
  sort: FinanceSort;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Turns untrusted query-string params into a validated filter set. Anything
// malformed falls back to the default rather than erroring, so a hand-edited
// or stale bookmark URL still renders something sensible.
export function parseFinanceFilters(params: RawParams, today: string): FinanceFilters {
  const rawPreset = first(params.preset);
  const rawFrom = first(params.from);
  const rawTo = first(params.to);

  let preset: FinancePreset = isFinancePreset(rawPreset) ? rawPreset : DEFAULT_PRESET;
  let from: string | null;
  let to: string | null;

  if (preset === "custom") {
    from = isDateKey(rawFrom) ? rawFrom : null;
    to = isDateKey(rawTo) ? rawTo : null;
    if (!from && !to) {
      preset = DEFAULT_PRESET;
      ({ from, to } = resolvePresetRange(DEFAULT_PRESET, today));
    } else if (from && to && from > to) {
      [from, to] = [to, from];
    }
  } else {
    ({ from, to } = resolvePresetRange(preset, today));
  }

  const rawKind = first(params.kind);
  const kind: FinanceKind | null =
    rawKind === "received" || rawKind === "spent" ? rawKind : null;

  const rawCategory = first(params.category);
  const category = rawCategory && isFinanceCategory(rawCategory) ? rawCategory : null;

  const rawMethod = first(params.method);
  const method = rawMethod && isFinanceMethod(rawMethod) ? rawMethod : null;

  const q = (first(params.q) ?? "").trim().slice(0, 100);

  const rawSort = first(params.sort) as FinanceSort | undefined;
  const sort: FinanceSort = rawSort && SORTS.includes(rawSort) ? rawSort : "date-desc";

  return { preset, from, to, kind, category, method, q, sort };
}

// The inverse of parseFinanceFilters — only non-default values are written,
// so URLs stay short and the default view is just /admin/financials.
export function financeFiltersToSearchParams(
  filters: FinanceFilters,
  overrides: Partial<FinanceFilters> = {},
): URLSearchParams {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (f.preset !== DEFAULT_PRESET) params.set("preset", f.preset);
  if (f.preset === "custom") {
    if (f.from) params.set("from", f.from);
    if (f.to) params.set("to", f.to);
  }
  if (f.kind) params.set("kind", f.kind);
  if (f.category) params.set("category", f.category);
  if (f.method) params.set("method", f.method);
  if (f.q) params.set("q", f.q);
  if (f.sort !== "date-desc") params.set("sort", f.sort);
  return params;
}

// Human-readable summary of the non-date filters, for the Excel header and
// the "YTD uses the same filters" hint.
export function describeNonDateFilters(filters: FinanceFilters): string[] {
  const parts: string[] = [];
  if (filters.kind) parts.push(`Type: ${filters.kind === "received" ? "Received" : "Spent"}`);
  if (filters.category) parts.push(`Category: ${categoryLabel(filters.category)}`);
  if (filters.method) parts.push(`Method: ${methodLabel(filters.method)}`);
  if (filters.q) parts.push(`Search: "${filters.q}"`);
  return parts;
}

// ── Rows & totals ─────────────────────────────────────────────────────────

export type FinanceEntry = {
  id: number;
  kind: FinanceKind;
  name: string;
  category: string;
  method: string | null;
  person: string | null;
  entryDate: string;
  amountCents: number;
  notes: string | null;
  origin: "manual" | "stripe";
  hasReceipt: boolean;
  receiptContentType: string | null;
  externalUrl: string | null;
  // Date of the bank line this entry is reconciled to, if any.
  bankDate: string | null;
};

export type FinanceTotals = {
  receivedCents: number;
  spentCents: number;
  netCents: number;
  receivedCount: number;
  spentCount: number;
};

export type CategoryBreakdown = {
  category: string;
  receivedCents: number;
  spentCents: number;
  count: number;
};

export function signedCents(entry: Pick<FinanceEntry, "kind" | "amountCents">): number {
  return entry.kind === "received" ? entry.amountCents : -entry.amountCents;
}
