import { CLUB_TIME_ZONE } from "@/lib/constants";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { isAdminRequest } from "@/lib/security";
import { listOrdersForAdmin, listProductsForAdmin } from "@/lib/shop-db";
import { clubMajor } from "@/lib/money";
import { auditedRoute } from "@/lib/admin-audit";

export const runtime = "nodejs";

const NAVY = "FF184467";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };

// Shop orders (the current filter) plus a stock sheet, for handing over at
// play days and for ordering more from the supplier.
export const GET = auditedRoute("export.shop", async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const f = url.searchParams.get("orders");
  const filter = f === "collected" || f === "all" ? f : "open";
  const [orders, products] = await Promise.all([listOrdersForAdmin(filter), listProductsForAdmin()]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Three Wolves Badminton Club";
  const sheet = wb.addWorksheet("Orders", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Order", key: "id", width: 8 },
    { header: "Name", key: "name", width: 24 },
    { header: "Email", key: "email", width: 30 },
    { header: "Items", key: "items", width: 44 },
    { header: "Amount", key: "amount", width: 10, style: { numFmt: '"$"#,##0.00' } },
    { header: "Payment", key: "method", width: 10 },
    { header: "Status", key: "status", width: 14 },
    { header: "Ordered", key: "created", width: 18 },
    { header: "Held until", key: "hold", width: 18 },
    { header: "Collected", key: "collected", width: 18 },
  ];
  const nz = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-NZ", { timeZone: CLUB_TIME_ZONE, dateStyle: "medium", timeStyle: "short" }) : "";
  for (const o of orders) {
    sheet.addRow({
      id: o.id,
      name: o.name,
      email: o.email,
      items: o.items.map((i) => i.label).join(", "),
      amount: clubMajor(o.totalCents),
      method: o.method,
      status: o.status.replace("_", " "),
      created: nz(o.createdAt),
      hold: o.status === "reserved_cash" ? nz(o.holdExpiresAt) : "",
      collected: nz(o.collectedAt),
    });
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  sheet.autoFilter = { from: "A1", to: "J1" };

  const stock = wb.addWorksheet("Stock", { views: [{ state: "frozen", ySplit: 1 }] });
  stock.columns = [
    { header: "Product", key: "product", width: 34 },
    { header: "Fit", key: "fit", width: 10 },
    { header: "Size", key: "size", width: 8 },
    { header: "In stock", key: "stock", width: 10 },
    { header: "Held", key: "reserved", width: 8 },
    { header: "Available", key: "available", width: 10 },
    { header: "Sold", key: "sold", width: 8 },
  ];
  for (const p of products) {
    for (const v of p.variants) {
      stock.addRow({ product: p.nameEn, fit: v.fit, size: v.size, stock: v.stock, reserved: v.reserved, available: v.available, sold: v.sold });
    }
  }
  const sh = stock.getRow(1);
  sh.font = { bold: true, color: { argb: "FFFFFFFF" } };
  sh.fill = HEADER_FILL;

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="three-wolves-shop-${filter}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
});
