import { myUpcomingPlayDays, requireScope } from "@/lib/api-v1";

function icsDate(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// Personal calendar feed of the player's upcoming play days. Calendar apps
// can't send headers, so the access key goes in ?token= (needs read:calendar).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const c = await requireScope(request, "read:calendar", url.searchParams.get("token"));
  if (c instanceof Response) return c;
  const days = await myUpcomingPlayDays(c);
  const stamp = icsDate(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Three Wolves Badminton Club//Play days//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Three Wolves play days",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
  ];
  for (const d of days) {
    lines.push("BEGIN:VEVENT", `UID:${d.date}-${c.playerId}@threewolves`, `DTSTAMP:${stamp}`);
    if (d.start) {
      lines.push(`DTSTART:${icsDate(d.start)}`);
      if (d.end) lines.push(`DTEND:${icsDate(d.end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d.date.replace(/-/g, "")}`);
    }
    lines.push("SUMMARY:Badminton · Three Wolves");
    if (d.location) lines.push(`LOCATION:${escape(d.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" },
  });
}
