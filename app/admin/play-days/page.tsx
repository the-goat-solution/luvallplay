import { ensureTables, getRosterForDate, getUpcomingSessionDates } from "@/lib/db";
import { formatDateLong, getDayName } from "@/lib/dates";

export const dynamic = "force-dynamic";

const PLAN_LABEL = {
  casual: "Casual",
  monthly: "Monthly member",
  quarterly: "Quarterly member",
} as const;

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default async function PlayDaysAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;

  const sessionKeys = process.env.POSTGRES_URL
    ? await (async () => {
        await ensureTables();
        return getUpcomingSessionDates(60);
      })()
    : [];

  const selectedDate =
    dateParam && sessionKeys.includes(dateParam) ? dateParam : sessionKeys[0];

  let roster: Awaited<ReturnType<typeof getRosterForDate>> = [];
  if (process.env.POSTGRES_URL && selectedDate) {
    roster = await getRosterForDate(selectedDate);
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "40px auto", padding: "0 20px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Play day roster</h1>
      <p style={{ color: "#666", marginBottom: 20 }}>
        Casual bookings and members whose subscription period covers the selected session date.
      </p>

      {!process.env.POSTGRES_URL ? (
        <p>Database is not configured.</p>
      ) : sessionKeys.length === 0 ? (
        <p>No upcoming sessions synced from the calendar yet.</p>
      ) : (
        <>
          <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
            {sessionKeys.map((key) => {
              const date = parseDateKey(key);
              const isSelected = key === selectedDate;
              return (
                <a
                  key={key}
                  href={`/admin/play-days?date=${key}`}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid #ccc",
                    textDecoration: "none",
                    color: isSelected ? "#fff" : "#111",
                    background: isSelected ? "#1a2a4a" : "#fff",
                    fontSize: 13,
                  }}
                >
                  {getDayName(date, "en")}, {formatDateLong(date, "en")}
                </a>
              );
            })}
          </nav>

          <p style={{ fontWeight: 600, marginBottom: 8 }}>
            {roster.length} player{roster.length === 1 ? "" : "s"} signed up for {selectedDate}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
                <th style={{ padding: "6px 8px" }}>Name</th>
                <th style={{ padding: "6px 8px" }}>Email</th>
                <th style={{ padding: "6px 8px" }}>Phone</th>
                <th style={{ padding: "6px 8px" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {roster.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: "10px 8px", color: "#888" }}>
                    No signups yet.
                  </td>
                </tr>
              ) : (
                roster.map((p, i) => (
                  <tr key={`${p.email}-${i}`} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "6px 8px" }}>{p.name}</td>
                    <td style={{ padding: "6px 8px" }}>{p.email}</td>
                    <td style={{ padding: "6px 8px" }}>{p.phone ?? ""}</td>
                    <td style={{ padding: "6px 8px" }}>{PLAN_LABEL[p.type]}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
