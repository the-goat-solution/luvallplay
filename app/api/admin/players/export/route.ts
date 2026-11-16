import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getClubToday } from "@/lib/dates";
import { buildPlayers, loadPlayerRecords } from "@/lib/players-export";
import { checkRateLimit, getClientIp, isAdminRequest } from "@/lib/security";

export const runtime = "nodejs";

const NAVY = "FF184467";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
const FLAG_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle" };
}

// Downloads everyone who has played with the club as a workbook: one row per
// person (de-duplicated by email), the people to double-check for being the
// same person under two emails, and every underlying record.
export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!checkRateLimit(`admin-players-export:${getClientIp(request)}`, 30)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }

  const today = getClubToday().dateKey;
  const records = await loadPlayerRecords(today);
  const { players, clashes } = buildPlayers(records);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Three Wolves Badminton Club";
  wb.created = new Date();

  // ── Players ─────────────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Players", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Name", key: "name", width: 26 },
    { header: "Email", key: "email", width: 34 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Player type", key: "type", width: 22 },
    { header: "Membership", key: "membership", width: 18 },
    { header: "Play days (total)", key: "total", width: 16 },
    { header: "Casual", key: "casual", width: 9 },
    { header: "Member", key: "member", width: 9 },
    { header: "Fill-in", key: "fillin", width: 9 },
    { header: "First played", key: "first", width: 13 },
    { header: "Last played", key: "last", width: 13 },
    { header: "Other emails used", key: "otherEmails", width: 34 },
    { header: "Other names used", key: "otherNames", width: 26 },
    { header: "Same name, different email", key: "clash", width: 34 },
  ];
  styleHeader(ws.getRow(1));
  for (const p of players) {
    const type = [p.isMember && "Member", p.isCasual && "Casual", p.isFillIn && "Fill-in"]
      .filter(Boolean)
      .join(" + ");
    const row = ws.addRow({
      name: p.name,
      email: p.email,
      phone: p.phone,
      type,
      membership: p.membership,
      total: p.totalSessions,
      casual: p.casualSessions,
      member: p.memberSessions,
      fillin: p.fillInSessions,
      first: p.firstPlayed,
      last: p.lastPlayed,
      otherEmails: p.otherEmails.join("; "),
      otherNames: p.otherNames.join("; "),
      clash: p.sameNameEmails.join("; "),
    });
    if (p.sameNameEmails.length) row.fill = FLAG_FILL;
  }
  ws.autoFilter = { from: "A1", to: "N1" };

  // ── Possible duplicates ─────────────────────────────────────────────────
  const dup = wb.addWorksheet("Check same name", { views: [{ state: "frozen", ySplit: 1 }] });
  dup.columns = [
    { header: "Name", key: "name", width: 26 },
    { header: "Email", key: "email", width: 34 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Play days", key: "total", width: 11 },
    { header: "Last played", key: "last", width: 13 },
  ];
  styleHeader(dup.getRow(1));
  for (const c of clashes) {
    for (const p of c.players) {
      dup.addRow({ name: p.name, email: p.email, phone: p.phone, total: p.totalSessions, last: p.lastPlayed });
    }
    dup.addRow([]);
  }

  // ── Every record ────────────────────────────────────────────────────────
  const rec = wb.addWorksheet("All records", { views: [{ state: "frozen", ySplit: 1 }] });
  rec.columns = [
    { header: "Source", key: "source", width: 10 },
    { header: "Name", key: "name", width: 26 },
    { header: "Email", key: "email", width: 34 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Detail", key: "detail", width: 12 },
    { header: "Status", key: "status", width: 11 },
    { header: "Membership start", key: "start", width: 16 },
    { header: "Membership end", key: "end", width: 16 },
    { header: "Play days", key: "n", width: 10 },
    { header: "First played", key: "first", width: 13 },
    { header: "Last played", key: "last", width: 13 },
  ];
  styleHeader(rec.getRow(1));
  for (const r of records) {
    rec.addRow({
      source: r.source === "casual" ? "Casual" : r.source === "member" ? "Member" : "Fill-in",
      name: `${r.firstName} ${r.lastName}`.trim(),
      email: r.email,
      phone: r.phone ?? "",
      detail: r.detail,
      status: r.status ?? "",
      start: r.periodStart ?? "",
      end: r.periodEnd ?? "",
      n: r.dates.length,
      first: r.dates[0] ?? "",
      last: r.dates[r.dates.length - 1] ?? "",
    });
  }
  rec.autoFilter = { from: "A1", to: "K1" };

  // ── Notes ───────────────────────────────────────────────────────────────
  const nt = wb.addWorksheet("Notes");
  nt.columns = [{ width: 110 }];
  nt.addRow([`Three Wolves players — as of ${today}`]).font = { bold: true, size: 14 };
  nt.addRow([]);
  for (const line of [
    `${players.length} people have played (one row per email). ${clashes.length} name(s) appear under more than one email.`,
    "Players: one row per person. Emails are compared ignoring case, Gmail dots and +tags (jo.smith+x@gmail.com = josmith@gmail.com).",
    "Same email, different names: kept as one person; the other spellings are in 'Other names used'.",
    "Same name, different emails: NOT merged, because they could be two people. They are shaded yellow and listed on 'Check same name'.",
    "Included: confirmed casual bookings and fill-ins on or before today, and every membership that has started.",
    "A day a fill-in took someone's place counts for the fill-in, not for the person they replaced.",
    "Cancelled or expired memberships are counted up to their end date.",
    "Left out: future bookings, unpaid/pending memberships, waitlist, donations, jersey orders, walk-ins added by name on the court board (no email).",
    "Member play days = sessions on the member's day (Fri/Wed) inside their membership. The club does not record attendance, so this is 'entitled to play', not 'turned up'.",
    "Play days (total) counts each date once, even if the person was booked and a member on the same day.",
  ]) nt.addRow([line]).alignment = { wrapText: true, vertical: "top" };

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="three-wolves-players-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
