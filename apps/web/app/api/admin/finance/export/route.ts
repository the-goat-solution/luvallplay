import { clubClock } from "@/lib/club";
import { CLUB_TIME_ZONE } from "@/lib/constants";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getClubToday } from "@/lib/dates";
import {
  categoryLabel,
  describeNonDateFilters,
  financialYearLabel,
  financialYearOf,
  formatRange,
  methodLabel,
  parseFinanceFilters,
  presetLabel,
  signedCents,
  type FinanceTotals,
} from "@/lib/finance";
import { loadFinanceReport } from "@/lib/finance-report";
import { checkRateLimit, getClientIp, isAdminRequest } from "@/lib/security";
import { clubMajor } from "@/lib/money";

export const runtime = "nodejs";

const MONEY_FORMAT = '"$"#,##0.00;[Red]-"$"#,##0.00';
const NAVY = "FF184467";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2EFE3" } };

// Excel stores money as floating point dollars; cents → dollars here is
// exact for every 2-decimal amount, and the cell's number format does the
// rest. All arithmetic before this point is integer cents.
const dollars = (cents: number) => clubMajor(cents);

// A 'YYYY-MM-DD' key as a real Excel date. exceljs converts Dates using UTC,
// so UTC midnight lands on exactly that calendar day in every timezone.
function excelDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Downloads the Financials table — with exactly the filters currently
// applied on the page — as an .xlsx workbook: a Transactions sheet (live
// SUMIF totals, frozen header, autofilter) and a Summary sheet (period vs
// year-to-date, plus a breakdown by source).
export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ip = getClientIp(request);
  if (!checkRateLimit(`admin-finance-export:${ip}`, 30)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const { dateKey: today } = getClubToday(new Date(), await clubClock());
  const filters = parseFinanceFilters(Object.fromEntries(url.searchParams), today);
  const report = await loadFinanceReport(filters, today);

  const periodText = `${formatRange(filters.from, filters.to)}${
    filters.preset !== "custom" ? ` (${presetLabel(filters.preset)})` : ""
  }`;
  const filterText = describeNonDateFilters(filters).join(" · ") || "None";
  const generatedText = new Intl.DateTimeFormat("en-NZ", {
    timeZone: CLUB_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  const wb = new ExcelJS.Workbook();
  wb.creator = "Three Wolves Badminton Club";
  wb.created = new Date();
  // Recalculate the SUMIF totals when the file is opened.
  wb.calcProperties.fullCalcOnLoad = true;

  // ── Transactions ────────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Transactions", {
    views: [{ state: "frozen", ySplit: 6 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { key: "no", width: 6 },
    { key: "date", width: 13 },
    { key: "name", width: 42 },
    { key: "type", width: 11 },
    { key: "source", width: 22 },
    { key: "method", width: 17 },
    { key: "person", width: 24 },
    { key: "amount", width: 15 },
    { key: "receipt", width: 16 },
    { key: "notes", width: 36 },
  ];

  ws.mergeCells("A1:J1");
  ws.getCell("A1").value = "Three Wolves Badminton Club — Financial report";
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.getCell("A2").value = `Period: ${periodText}`;
  ws.getCell("A3").value = `Filters: ${filterText}`;
  ws.getCell("A4").value = `Generated: ${generatedText} (NZ time)`;
  for (const ref of ["A2", "A3", "A4"]) ws.getCell(ref).font = { color: { argb: "FF555555" } };

  const HEADER_ROW = 6;
  const header = ws.getRow(HEADER_ROW);
  header.values = [
    "No.",
    "Date",
    "Name",
    "Type",
    "Source",
    "Method",
    "Associated person",
    "Amount (NZD)",
    "Invoice / receipt",
    "Notes",
  ];
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle" };
  header.height = 20;
  header.getCell(8).alignment = { horizontal: "right", vertical: "middle" };

  report.entries.forEach((entry, index) => {
    const row = ws.getRow(HEADER_ROW + 1 + index);
    row.values = [
      index + 1,
      excelDate(entry.entryDate),
      entry.name,
      entry.kind === "received" ? "Received" : "Spent",
      categoryLabel(entry.category),
      methodLabel(entry.method),
      entry.person ?? "",
      dollars(signedCents(entry)),
      "",
      entry.notes ?? "",
    ];
    row.getCell(2).numFmt = "d mmm yyyy";
    row.getCell(8).numFmt = MONEY_FORMAT;
    row.getCell(4).font = {
      color: { argb: entry.kind === "received" ? "FF1A7A3C" : "FFB00020" },
    };
    const link = entry.hasReceipt
      ? { text: "View receipt", hyperlink: `${url.origin}/api/admin/finance/receipts/${entry.id}` }
      : entry.externalUrl
        ? { text: "View in Stripe", hyperlink: entry.externalUrl }
        : null;
    if (link) {
      row.getCell(9).value = link;
      row.getCell(9).font = { color: { argb: "FF1E5A8A" }, underline: true };
    }
  });

  const firstData = HEADER_ROW + 1;
  const lastData = HEADER_ROW + report.entries.length;
  const hasRows = report.entries.length > 0;
  if (hasRows) {
    ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: lastData, column: 10 } };
  }

  // Totals use live formulas (so they stay right if someone edits or
  // filters rows in Excel), each with the server-computed value cached as
  // the result for viewers that don't recalculate.
  const typeRange = `D${firstData}:D${lastData}`;
  const amountRange = `H${firstData}:H${lastData}`;
  const totalsStart = lastData + 2;
  const totalRows: [string, string | null, number][] = [
    ["Total received", hasRows ? `SUMIF(${typeRange},"Received",${amountRange})` : null, report.totals.receivedCents],
    ["Total spent", hasRows ? `-SUMIF(${typeRange},"Spent",${amountRange})` : null, report.totals.spentCents],
    ["Net (received − spent)", hasRows ? `SUM(${amountRange})` : null, report.totals.netCents],
  ];
  totalRows.forEach(([label, formula, cents], i) => {
    const row = ws.getRow(totalsStart + i);
    row.getCell(7).value = label;
    row.getCell(8).value = formula ? { formula, result: dollars(cents) } : dollars(cents);
    row.getCell(8).numFmt = MONEY_FORMAT;
    for (const c of [7, 8]) {
      row.getCell(c).font = { bold: true };
      row.getCell(c).fill = TOTAL_FILL;
    }
  });

  const ytdStart = totalsStart + totalRows.length + 1;
  const ytdLabel = `Year to date (${formatRange(report.ytdRange.from, report.ytdRange.to)})`;
  ws.getRow(ytdStart).getCell(7).value = ytdLabel;
  ws.getRow(ytdStart).getCell(7).font = { bold: true, color: { argb: NAVY } };
  (
    [
      ["YTD received", report.ytd.receivedCents],
      ["YTD spent", report.ytd.spentCents],
      ["YTD net", report.ytd.netCents],
    ] as const
  ).forEach(([label, cents], i) => {
    const row = ws.getRow(ytdStart + 1 + i);
    row.getCell(7).value = label;
    row.getCell(8).value = dollars(cents);
    row.getCell(8).numFmt = MONEY_FORMAT;
  });

  // ── Summary ─────────────────────────────────────────────────────────────
  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 }];
  summary.getCell("A1").value = "Financial summary";
  summary.getCell("A1").font = { bold: true, size: 14, color: { argb: NAVY } };
  summary.getCell("A2").value = `Period: ${periodText}`;
  summary.getCell("A3").value = `Filters: ${filterText}`;

  const head = summary.getRow(5);
  head.values = ["", "Selected period", `Year to date (FY ${financialYearLabel(financialYearOf(report.ytdRange.from))})`];
  styleHeader(head, 3);

  const summaryRows: [string, (t: FinanceTotals) => number, boolean][] = [
    ["Received", (t) => t.receivedCents, true],
    ["Spent", (t) => t.spentCents, true],
    ["Net", (t) => t.netCents, true],
    ["Transactions", (t) => t.receivedCount + t.spentCount, false],
  ];
  summaryRows.forEach(([label, pick, money], i) => {
    const row = summary.getRow(6 + i);
    row.values = [
      label,
      money ? dollars(pick(report.totals)) : pick(report.totals),
      money ? dollars(pick(report.ytd)) : pick(report.ytd),
    ];
    if (money) {
      row.getCell(2).numFmt = MONEY_FORMAT;
      row.getCell(3).numFmt = MONEY_FORMAT;
    }
    if (label === "Net") row.font = { bold: true };
  });

  const bdHeader = summary.getRow(11);
  bdHeader.values = ["By source (selected period)", "Received", "Spent", "Net", "Entries"];
  styleHeader(bdHeader, 5);
  report.breakdown.forEach((b, i) => {
    const row = summary.getRow(12 + i);
    row.values = [
      categoryLabel(b.category),
      dollars(b.receivedCents),
      dollars(b.spentCents),
      dollars(b.receivedCents - b.spentCents),
      b.count,
    ];
    for (const c of [2, 3, 4]) row.getCell(c).numFmt = MONEY_FORMAT;
  });
  const bdTotal = summary.getRow(12 + report.breakdown.length);
  bdTotal.values = [
    "Total",
    dollars(report.totals.receivedCents),
    dollars(report.totals.spentCents),
    dollars(report.totals.netCents),
    report.totals.receivedCount + report.totals.spentCount,
  ];
  bdTotal.font = { bold: true };
  for (const c of [1, 2, 3, 4, 5]) bdTotal.getCell(c).fill = TOTAL_FILL;
  for (const c of [2, 3, 4]) bdTotal.getCell(c).numFmt = MONEY_FORMAT;

  const buffer = await wb.xlsx.writeBuffer();
  const rangePart =
    filters.from || filters.to
      ? `${filters.from ?? "start"}-to-${filters.to ?? today}`
      : "all-time";
  const filename = `three-wolves-financials-${rangePart}.xlsx`;

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function styleHeader(row: ExcelJS.Row, columns: number) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  for (let c = 1; c <= columns; c++) {
    row.getCell(c).fill = HEADER_FILL;
    if (c > 1) row.getCell(c).alignment = { horizontal: "right" };
  }
}
