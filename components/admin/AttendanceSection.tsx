import { SubmitButton } from "@/components/admin/SubmitButton";
import { Badge, EmptyState, kit } from "@/components/admin/kit";
import { addAttendanceByEmail, markAttended, markNotAttended } from "@/app/admin/(console)/play-days/attendance-actions";
import { listAttendanceForDate } from "@/lib/stats-db";
import type { RosterEntry } from "@/lib/db";

const SOURCE_LABEL: Record<string, string> = {
  board: "from the court board",
  minigame: "from the round robin",
  admin: "marked by an admin",
  booking_history: "from past bookings",
  api: "from a connected app",
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
    <section id="attendance">
      <p className={kit.muted} style={{ fontSize: 13, marginTop: 0 }}>
        Who played counts toward stats and the leaderboard. It&apos;s filled in automatically from the court board (anyone with a finished game) and the
        round robin; fix it here for days they weren&apos;t used. Members who said they can&apos;t make it aren&apos;t listed.
      </p>
      {people.size === 0 ? (
        <EmptyState>Nobody to show yet: no one signed up and nothing was recorded.</EmptyState>
      ) : (
        <div className={kit.tableWrap}>
          <table className={kit.table}>
            <caption className={kit.srOnly}>Attendance on {date}</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Played?</th>
                <th scope="col">
                  <span className={kit.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...people.entries()].map(([email, name]) => {
                const rec = byEmail.get(email);
                const played = Boolean(rec && !rec.removed && rec.verified);
                const toConfirm = Boolean(rec && !rec.verified && !rec.removed);
                return (
                  <tr key={email}>
                    <td data-label="Player">
                      <div>
                        {name}
                        <span className={kit.sub}>{email}</span>
                      </div>
                    </td>
                    <td data-label="Played?">
                      {played ? (
                        <Badge tone="good">✓ Played, {SOURCE_LABEL[rec!.source] ?? rec!.source}</Badge>
                      ) : toConfirm ? (
                        <Badge tone="warn">Checked in from an app: confirm?</Badge>
                      ) : (
                        <span className={kit.muted}>Not recorded</span>
                      )}
                    </td>
                    <td data-label="">
                      {played ? (
                        <form action={markNotAttended.bind(null, date, email)}>
                          <SubmitButton className={kit.btnSecondary} loadingText="Saving…">
                            Didn&apos;t play
                          </SubmitButton>
                        </form>
                      ) : (
                        <form action={markAttended.bind(null, date, email)}>
                          <SubmitButton className={kit.btn} loadingText="Saving…">
                            {toConfirm ? "Confirm" : "Played"}
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
      )}
      <form action={addAttendanceByEmail.bind(null, date)} className={kit.toolbar} style={{ marginTop: 12 }}>
        <label className={kit.field} style={{ flex: "1 1 260px" }}>
          Someone else who played
          <input name="email" type="email" placeholder="Their email" required className={kit.input} />
        </label>
        <SubmitButton className={kit.btnSecondary} loadingText="Adding…">
          Add
        </SubmitButton>
      </form>
    </section>
  );
}
