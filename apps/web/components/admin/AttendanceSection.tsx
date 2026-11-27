import { SubmitButton } from "@/components/admin/SubmitButton";
import { Badge, EmptyState, kit } from "@/components/admin/kit";
import { addAttendanceByEmail, markAttended, markNotAttended } from "@/app/admin/(console)/play-days/attendance-actions";
import { listAttendanceForDate } from "@/lib/stats-db";
import type { RosterEntry } from "@/lib/db";
import { adminText } from "@/lib/admin-lang";
import type { AdminKey } from "@luvallplay/i18n/admin";

const SOURCE_KEY: Record<string, AdminKey> = {
  board: "att_src_board",
  minigame: "att_src_minigame",
  admin: "att_src_admin",
  booking_history: "att_src_booking_history",
  api: "att_src_api",
};

/**
 * Who actually played on a date, for player stats and the leaderboard.
 * Filled in automatically from the court board (≥1 finished game) and the
 * round robin; tick or untick anyone here for days the board wasn't used.
 */
export async function AttendanceSection({ date, roster }: { date: string; roster: RosterEntry[] }) {
  const { t } = await adminText();
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
        {t("att_intro")}
      </p>
      {people.size === 0 ? (
        <EmptyState>{t("att_empty")}</EmptyState>
      ) : (
        <div className={kit.tableWrap}>
          <table className={kit.table}>
            <caption className={kit.srOnly}>{t("att_caption", { date })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("play_col_player")}</th>
                <th scope="col">{t("att_col_played")}</th>
                <th scope="col">
                  <span className={kit.srOnly}>{t("play_col_actions")}</span>
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
                    <td data-label={t("play_col_player")}>
                      <div>
                        {name}
                        <span className={kit.sub}>{email}</span>
                      </div>
                    </td>
                    <td data-label={t("att_col_played")}>
                      {played ? (
                        <Badge tone="good">{t("att_played", { source: SOURCE_KEY[rec!.source] ? t(SOURCE_KEY[rec!.source]) : rec!.source })}</Badge>
                      ) : toConfirm ? (
                        <Badge tone="warn">{t("att_to_confirm")}</Badge>
                      ) : (
                        <span className={kit.muted}>{t("att_not_recorded")}</span>
                      )}
                    </td>
                    <td data-label="">
                      {played ? (
                        <form action={markNotAttended.bind(null, date, email)}>
                          <SubmitButton className={kit.btnSecondary} loadingText={t("common_saving")}>
                            {t("att_didnt_play")}
                          </SubmitButton>
                        </form>
                      ) : (
                        <form action={markAttended.bind(null, date, email)}>
                          <SubmitButton className={kit.btn} loadingText={t("common_saving")}>
                            {toConfirm ? t("att_confirm") : t("att_played_btn")}
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
          {t("att_someone_else")}
          <input name="email" type="email" placeholder={t("att_their_email")} required className={kit.input} />
        </label>
        <SubmitButton className={kit.btnSecondary} loadingText={t("play_adding")}>
          {t("att_add")}
        </SubmitButton>
      </form>
    </section>
  );
}
