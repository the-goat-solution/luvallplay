import { CLUB_TIME_ZONE } from "@/lib/constants";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getClubToday } from "@/lib/dates";
import { FLAG_LABEL, JERSEY_SIZES } from "@/lib/jersey";
import { listJerseyRegistrations } from "@/lib/jersey-db";
import { checkRateLimit, getClientIp, isAdminRequest } from "@/lib/security";

export const runtime = "nodejs";

const NAVY = "FF184467";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
const PAID_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F4E8" } };
const MONEY = '"$"#,##0.00';

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle" };
}

// Downloads the jersey registrations as a workbook: every registration,
// the order list for the printer, and a summary with live formulas.
// ?filter=paid|unpaid narrows the Registrations sheet.
export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!checkRateLimit(`admin-jersey-export:${getClientIp(request)}`, 30)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }

  const filter = new URL(request.url).searchParams.get("filter");
  const all = await listJerseyRegistrations();
  const live = all.filter((r) => r.status === "pending" || r.status === "paid");
  const shown = all.filter((r) =>
    filter === "paid" ? r.status === "paid" : filter === "unpaid" ? r.status === "pending" : true,
  );
  const nz = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("en-NZ", { timeZone: CLUB_TIME_ZONE, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
      : "";

  const wb = new ExcelJS.Workbook();
  wb.creator = "Three Wolves Badminton Club";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  // ── Registrations ───────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Registrations", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Code", key: "code", width: 9 },
    { header: "Registered", key: "created", width: 20 },
    { header: "First name", key: "first", width: 16 },
    { header: "Last name", key: "last", width: 16 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Size", key: "size", width: 7 },
    { header: "Print name", key: "pname", width: 14 },
    { header: "Print no.", key: "pnum", width: 9 },
    { header: "Print country", key: "pcountry", width: 14 },
    { header: "Price", key: "price", width: 10, style: { numFmt: MONEY } },
    { header: "Early bird", key: "early", width: 10 },
    { header: "Status", key: "status", width: 11 },
    { header: "Paid", key: "paid", width: 10, style: { numFmt: MONEY } },
    { header: "Paid on", key: "paidAt", width: 20 },
    { header: "Paid by", key: "paidBy", width: 9 },
    { header: "Flags", key: "flags", width: 50 },
  ];
  styleHeader(ws.getRow(1));
  for (const r of shown) {
    const row = ws.addRow({
      code: r.refCode ?? "",
      created: nz(r.createdAt),
      first: r.firstName,
      last: r.lastName,
      email: r.email,
      phone: r.phone,
      size: r.size,
      pname: r.printName ?? "",
      pnum: r.printNumber ?? "",
      pcountry: r.printCountry ?? "",
      price: r.priceCents / 100,
      early: r.earlyBird ? "Yes" : "No",
      status: r.status,
      paid: r.paidCents === null ? null : r.paidCents / 100,
      paidAt: nz(r.paidAt),
      paidBy: r.paidBy ?? "",
      flags: r.flags.map((f) => FLAG_LABEL[f] ?? f).join("; "),
    });
    if (r.status === "paid") row.fill = PAID_FILL;
  }
  ws.autoFilter = { from: "A1", to: "Q1" };

  // ── Printer order ───────────────────────────────────────────────────────
  const pr = wb.addWorksheet("Printer order", { views: [{ state: "frozen", ySplit: 1 }] });
  pr.columns = [
    { header: "Size", key: "size", width: 8 },
    { header: "Print name", key: "pname", width: 16 },
    { header: "Number", key: "pnum", width: 9 },
    { header: "Country", key: "pcountry", width: 14 },
    { header: "For (internal)", key: "who", width: 26 },
    { header: "Paid?", key: "paid", width: 8 },
  ];
  styleHeader(pr.getRow(1));
  const sizeIdx = (s: string) => JERSEY_SIZES.indexOf(s as (typeof JERSEY_SIZES)[number]);
  for (const r of [...live].sort((a, b) => sizeIdx(a.size) - sizeIdx(b.size) || a.id - b.id)) {
    pr.addRow({
      size: r.size,
      pname: r.printName ?? "",
      pnum: r.printNumber ?? "",
      pcountry: r.printCountry ?? "",
      who: `${r.firstName} ${r.lastName}`,
      paid: r.status === "paid" ? "Yes" : "No",
    });
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const sm = wb.addWorksheet("Summary");
  sm.columns = [{ width: 34 }, { width: 14 }, { width: 14 }, { width: 14 }];
  const n = Math.max(shown.length, 1) + 1;
  sm.addRow([`Three Wolves jersey registrations — ${getClubToday().dateKey}`]).font = { bold: true, size: 14 };
  sm.addRow([]);
  styleHeader(sm.addRow(["Totals (Registrations sheet)", "Count", "$ amount"]));
  const R = (col: string) => `Registrations!$${col}$2:$${col}$${n}`;
  sm.addRow(["Registered (pending + paid)", { formula: `COUNTIF(${R("M")},"pending")+COUNTIF(${R("M")},"paid")` }]);
  sm.addRow(["Paid (including free entries)", { formula: `COUNTIF(${R("M")},"paid")` }, { formula: `SUMIF(${R("M")},"paid",${R("K")})` }]);
  sm.addRow(["Awaiting payment", { formula: `COUNTIF(${R("M")},"pending")` }, { formula: `SUMIF(${R("M")},"pending",${R("K")})` }]);
  sm.addRow(["Received in total", null, { formula: `SUMIF(${R("M")},"paid",${R("N")})` }]);
  sm.addRow(["Over the price (club funds)", null, { formula: `SUMIF(${R("M")},"paid",${R("N")})-SUMIF(${R("M")},"paid",${R("K")})` }]);
  sm.addRow(["Early birds", { formula: `COUNTIF(${R("L")},"Yes")` }]);
  sm.addRow(["Free entries (no payment)", { formula: `COUNTIF(${R("P")},"free")` }]);
  sm.addRow([]);
  styleHeader(sm.addRow(["Size", "Count"]));
  for (const s of JERSEY_SIZES) sm.addRow([s, { formula: `COUNTIF('Printer order'!$A:$A,"${s}")` }]);
  sm.eachRow((row) => row.eachCell((c, i) => { if (i === 3 && typeof c.value === "object") c.numFmt = MONEY; }));
  for (const row of [6, 7, 8]) sm.getCell(`C${row}`).numFmt = MONEY;

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="three-wolves-jersey-${getClubToday().dateKey}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
