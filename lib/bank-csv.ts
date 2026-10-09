import type { BankTransactionInput } from "./bank-db";

// Parses a bank statement CSV export into bank lines. Built for ANZ NZ's
// internet-banking export (Type, Details, Particulars, Code, Reference,
// Amount, Date, ForeignCurrencyAmount, ConversionCharge — dates d/m/yyyy)
// but reads columns by header name, so other NZ bank exports (separate
// Debit/Credit columns, a Balance column, ISO dates) work too.

export class CsvImportError extends Error {}

// RFC 4180-ish: quoted fields, doubled quotes, CRLF/LF, commas in quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// "-1,234.56", "$45", "(12.00)", "12.00 DR" → signed cents, via string
// arithmetic (no float rounding).
export function parseMoneyToCents(raw: string): number | null {
  let s = raw.trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/DR$/i.test(s)) {
    negative = true;
    s = s.slice(0, -2);
  } else if (/CR$/i.test(s)) s = s.slice(0, -2);
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

// d/m/yyyy, dd/mm/yy, d-m-yyyy, yyyy-mm-dd, yyyy/mm/dd, "3 Oct 2026".
// NZ banks write day-first, so a slash date is always read as d/m.
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function parseStatementDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else if ((match = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{2}|\d{4})$/.exec(s))) {
    d = Number(match[1]);
    m = MONTHS[match[2].toLowerCase()] ?? 0;
    y = Number(match[3]);
    if (y < 100) y += 2000;
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

function findCol(headers: string[], ...names: string[]): number {
  const n = headers.map(norm);
  for (const name of names) {
    const i = n.indexOf(name);
    if (i !== -1) return i;
  }
  return -1;
}

// Small stable 64-bit string hash (two 32-bit FNV-style halves) for
// building an id from a row's content — no crypto needed, just stability.
function hash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function parseBankCsv(
  text: string,
  account: string | null = null,
): BankTransactionInput[] {
  const rows = parseCsv(text);
  // The header is the first row naming both a date and an amount-ish column
  // (some exports put account details above it).
  const headerIndex = rows.findIndex((r) => {
    const n = r.map(norm);
    return (
      n.some((h) => h.includes("date")) &&
      n.some((h) => h === "amount" || h === "debit" || h === "credit" || h.startsWith("amount"))
    );
  });
  if (headerIndex === -1) {
    throw new CsvImportError(
      "Couldn't find the column headings — the file needs at least a Date and an Amount (or Debit/Credit) column.",
    );
  }
  const headers = rows[headerIndex];
  const col = {
    date: findCol(headers, "date", "transactiondate", "processeddate", "posteddate", "postingdate"),
    amount: findCol(headers, "amount", "amountnzd"),
    debit: findCol(headers, "debit", "withdrawals", "withdrawal", "debitamount"),
    credit: findCol(headers, "credit", "deposits", "deposit", "creditamount"),
    type: findCol(headers, "type", "transactiontype", "trantype"),
    details: findCol(headers, "details", "description", "payee", "transactiondetails", "memo", "narrative", "otherparty"),
    particulars: findCol(headers, "particulars"),
    code: findCol(headers, "code", "analysiscode"),
    reference: findCol(headers, "reference"),
    balance: findCol(headers, "balance", "runningbalance"),
  };
  if (col.date === -1 || (col.amount === -1 && col.debit === -1 && col.credit === -1)) {
    throw new CsvImportError("The file needs a Date column and an Amount (or Debit/Credit) column.");
  }

  const out: BankTransactionInput[] = [];
  const occurrences = new Map<string, number>();
  const problems: number[] = [];
  rows.slice(headerIndex + 1).forEach((r, i) => {
    const get = (c: number) => (c >= 0 ? (r[c] ?? "").trim() : "");
    const date = parseStatementDate(get(col.date));
    let amount: number | null = null;
    if (col.amount >= 0 && get(col.amount)) {
      amount = parseMoneyToCents(get(col.amount));
    } else {
      const debit = get(col.debit) ? parseMoneyToCents(get(col.debit)) : 0;
      const credit = get(col.credit) ? parseMoneyToCents(get(col.credit)) : 0;
      if (debit !== null && credit !== null) amount = Math.abs(credit) - Math.abs(debit);
    }
    if (!date || amount === null) {
      problems.push(headerIndex + i + 2);
      return;
    }
    if (amount === 0) return;
    const description = [get(col.type), get(col.details)].filter(Boolean).join(" · ") || "Bank transaction";
    const reference = [get(col.particulars), get(col.code), get(col.reference)].filter(Boolean).join(" / ") || null;
    const balanceRaw = get(col.balance);
    const balanceCents = balanceRaw ? parseMoneyToCents(balanceRaw) : null;
    // Identical rows on the same day (two $10 cash deposits) get #1, #2 …
    // so both survive, while re-importing the same file maps onto the same ids.
    const base = hash([date, amount, description, reference ?? "", balanceRaw].join("|"));
    const n = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, n);
    out.push({
      externalId: `csv:${base}#${n}`,
      account,
      date,
      description,
      reference,
      amountCents: amount,
      balanceCents,
    });
  });

  if (out.length === 0) {
    throw new CsvImportError(
      problems.length
        ? `No readable transactions — check rows ${problems.slice(0, 5).join(", ")} (date or amount not recognised).`
        : "The file has no transactions.",
    );
  }
  return out;
}
