import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { btn, btnSecondary, input, pill, td, th } from "@/components/admin/ui";
import { addAttendanceByEmail, markAttended, markNotAttended } from "@/app/admin/(console)/play-days/attendance-actions";
import { listAttendanceForDate } from "@/lib/stats-db";
import type { RosterEntry } from "@/lib/db";

const SOURCE_LABEL: Record<string, string> = {
  board: "Court board",
  minigame: "Round robin",
  admin: "Admin",
  booking_history: "Booking (backfill)",
  api: "Connected app",
};

/**
 * Who actually played on a date, for player stats and the leaderboard.
 * Filled in automatically from the court board (≥1 finished game) and the
 * round robin; tick or untick anyone here for days the board wasn't used.
 */
export async function AttendanceSection({ date, roster }: { date: string; roster: RosterEntry[] }) {
  const records = await listAttendanceForDate(date);
  const byEmail = new Map(records.map((r) => [r.email, r]));
  const people = new Map<string, string>();
  for (const r of roster) {
    const who = r.fillIn ?? r;
    people.set(who.email.trim().toLowerCase(), who.name);
  }
  for (const r of records) if (!people.has(r.email)) people.set(r.email, r.email);

  return (
    <section id="attendance" style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>Attendance for {date}</h2>
      <p style={{ color: "#666", fontSize: 13, marginTop: 0 }}>
        Counts toward play-day stats and the leaderboard. Recorded automatically when the court board is concluded (anyone with a finished game) and from
        the round robin. Members who said they can&apos;t make it aren&apos;t on the roster.
      </p>
      <div className={adminStyles.tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd" }}>
              <th style={th}>Player</th>
              <th style={th}>Played?</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {[...people.entries()].map(([email, name]) => {
              const rec = byEmail.get(email);
              const played = Boolean(rec && !rec.removed && rec.verified);
              return (
                <tr key={email} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={td}>
                    {name}
                    <div style={{ color: "#888", fontSize: 12 }}>{email}</div>
                  </td>
                  <td style={td}>
                    {played ? (
                      <span style={pill("#e9f6ee", "#1d6b3d")}>✓ {SOURCE_LABEL[rec!.source] ?? rec!.source}</span>
                    ) : rec && !rec.verified && !rec.removed ? (
                      <span style={pill("#fff4e5", "#8a4b00")}>Check-in to confirm</span>
                    ) : (
                      <span style={{ color: "#888" }}>Not recorded</span>
                    )}
                  </td>
                  <td style={td}>
                    {played ? (
                      <form action={markNotAttended.bind(null, date, email)}>
                        <SubmitButton loadingText="…" style={btnSecondary}>
                          Didn&apos;t play
                        </SubmitButton>
                      </form>
                    ) : (
                      <form action={markAttended.bind(null, date, email)}>
                        <SubmitButton loadingText="…" style={btn}>
                          {rec && !rec.verified ? "Confirm" : "Played"}
                        </SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form action={addAttendanceByEmail.bind(null, date)} style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <input name="email" type="email" placeholder="Someone else who played (email)" required style={{ ...input, minWidth: 240 }} />
        <SubmitButton loadingText="…" style={btnSecondary}>
          Add
        </SubmitButton>
      </form>
    </section>
  );
}
