import { CLUB_TIME_ZONE } from "@/lib/constants";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import adminStyles from "@/components/admin/admin.module.css";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { Badge, EmptyState, PageHeader, Section, kit } from "@/components/admin/kit";
import { WEEKDAYS, WEEKDAY_LABEL, type Weekday } from "@/lib/constants";
import {
  deleteDayRequest,
  getPausedDays,
  getPendingDayRequests,
  isWeekday,
  listDayRequests,
  markDayRequestsNotified,
  setDayPaused,
  type DayRequest,
} from "@/lib/day-requests";
import { getUpcomingSessionDates } from "@/lib/db";
import { sendDayOpenEmail } from "@/lib/email";
import { clubLocale } from "@/lib/club-brand";
import { adminText } from "@/lib/admin-lang";
import type { AdminKey } from "@luvallplay/i18n/admin";

type T = Awaited<ReturnType<typeof adminText>>["t"];
const dayName = (t: T, day: Weekday) => t(`weekday_${day}` as AdminKey);
const peopleOf = (t: T, n: number) => t(n === 1 ? "sch_people_one" : "sch_people_many", { n });

export const dynamic = "force-dynamic";

// Schedule: which weekdays take sign-ups, and the people who asked to hear
// when a paused day reopens. (Moved here from /admin/day-requests.)

function back(param: "toast" | "toastError", message: string): never {
  redirect(`/admin/play-days/schedule?${param}=${encodeURIComponent(message)}`);
}

// Emails everyone still waiting on `day` that it's open, marking each request
// notified only once its email actually sends — a failed send stays pending
// so the next click retries it rather than losing it.
async function emailPending(day: Weekday): Promise<{ sent: number; failed: number }> {
  const pending = await getPendingDayRequests(day);
  const sentIds: number[] = [];
  for (const r of pending) {
    try {
      await sendDayOpenEmail(r.email, r.name, WEEKDAY_LABEL[day]);
      sentIds.push(r.id);
    } catch (err) {
      console.error("Failed to send day-open email", r.id, err);
    }
  }
  await markDayRequestsNotified(sentIds);
  return { sent: sentIds.length, failed: pending.length - sentIds.length };
}

function emailSummary(t: T, day: Weekday, sent: number, failed: number): string {
  const label = dayName(t, day);
  if (sent === 0 && failed === 0) return t("sch_none_waiting_on", { day: label });
  const base = t(sent === 1 ? "sch_emailed_summary_one" : "sch_emailed_summary_many", { n: sent, day: label });
  return failed > 0 ? `${base} ${t("sch_failed", { n: failed })}` : base;
}

// Reopens sign-ups for a paused day and emails everyone who asked to hear
// when it's back.
async function resumeAndNotify(day: Weekday) {
  "use server";
  const { t } = await adminText();
  await setDayPaused(day, false);
  revalidatePath("/");
  const { sent, failed } = await emailPending(day);
  revalidatePath("/admin/play-days/schedule");
  const message = t("sch_reopened_summary", { day: dayName(t, day), summary: emailSummary(t, day, sent, failed) });
  back(failed > 0 ? "toastError" : "toast", message);
}

async function resumeQuietly(day: Weekday) {
  "use server";
  const { t } = await adminText();
  await setDayPaused(day, false);
  revalidatePath("/");
  revalidatePath("/admin/play-days/schedule");
  back("toast", t("sch_reopened_quiet", { day: dayName(t, day) }));
}

async function notifyDay(day: Weekday) {
  "use server";
  const { t } = await adminText();
  const { sent, failed } = await emailPending(day);
  revalidatePath("/admin/play-days/schedule");
  back(failed > 0 ? "toastError" : "toast", emailSummary(t, day, sent, failed));
}

async function pauseDay(day: Weekday) {
  "use server";
  const { t } = await adminText();
  if (!isWeekday(day)) back("toastError", t("sch_pick_day"));
  await setDayPaused(day, true);
  revalidatePath("/");
  revalidatePath("/admin/play-days/schedule");
  back("toast", t("sch_paused_done", { day: dayName(t, day) }));
}

async function removeRequest(id: number) {
  "use server";
  const { t } = await adminText();
  await deleteDayRequest(id);
  revalidatePath("/admin/play-days/schedule");
  back("toast", t("sch_request_removed"));
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(clubLocale(), { timeZone: CLUB_TIME_ZONE, day: "numeric", month: "short" });
}

function WaitingList({ day, paused, requests, t }: { day: Weekday; paused: boolean; requests: DayRequest[]; t: T }) {
  const label = dayName(t, day);
  const pending = requests.filter((r) => r.notifiedAt === null);
  return (
    <Section title={t("sch_waiting_for", { day: label })} id={`waiting-${day}`}>
      <p className={kit.muted} style={{ fontSize: 13, marginTop: -4 }}>
        {paused ? t("sch_wait_paused", { day: label }) : t("sch_wait_open", { day: label })}
      </p>
      <div className={kit.rowActions} style={{ marginBottom: 12 }}>
        {paused ? (
          <>
            <form action={resumeAndNotify.bind(null, day)}>
              <SubmitButton
                className={kit.btn}
                loadingText={t("sch_reopening")}
                confirmMessage={t("sch_reopen_email_confirm", { day: label, people: peopleOf(t, pending.length) })}
              >
                {t("sch_reopen_email", { day: label, people: peopleOf(t, pending.length) })}
              </SubmitButton>
            </form>
            <form action={resumeQuietly.bind(null, day)}>
              <SubmitButton className={kit.btnSecondary} loadingText={t("sch_reopening")} confirmMessage={t("sch_reopen_quiet_confirm", { day: label })}>
                {t("sch_reopen_quiet")}
              </SubmitButton>
            </form>
          </>
        ) : pending.length > 0 ? (
          <form action={notifyDay.bind(null, day)}>
            <SubmitButton
              className={kit.btn}
              loadingText={t("sch_sending")}
              confirmMessage={t("sch_email_open_confirm", { people: peopleOf(t, pending.length), day: label })}
            >
              {t("sch_email_open", { people: peopleOf(t, pending.length), day: label })}
            </SubmitButton>
          </form>
        ) : null}
      </div>
      <div className={kit.tableWrap}>
        <table className={kit.table}>
          <caption className={kit.srOnly}>{t("sch_caption_waiting", { day: label })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("play_col_person")}</th>
              <th scope="col">{t("sch_col_asked")}</th>
              <th scope="col">{t("play_col_status")}</th>
              <th scope="col">
                <span className={kit.srOnly}>{t("play_col_actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td data-label={t("play_col_person")}>
                  <div>
                    {r.name}
                    <span className={kit.sub}>{r.email}</span>
                  </div>
                </td>
                <td data-label={t("sch_col_asked")}>{shortDate(r.createdAt)}</td>
                <td data-label={t("play_col_status")}>{r.notifiedAt ? <Badge tone="good">{t("sch_emailed_on", { date: shortDate(r.notifiedAt) })}</Badge> : <Badge tone="warn">{t("play_waiting")}</Badge>}</td>
                <td data-label="">
                  <form action={removeRequest.bind(null, r.id)}>
                    <SubmitButton className={kit.btnSecondary} loadingText={t("play_removing")} confirmMessage={t("sch_remove_confirm", { name: r.name, day: label })}>
                      {t("play_remove")}
                    </SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export default async function SchedulePage() {
  const { t } = await adminText();
  const hasDb = Boolean(process.env.POSTGRES_URL);
  if (!hasDb) {
    return (
      <div className={adminStyles.page}>
        <PageHeader title={t("sch_title")} />
        <EmptyState>{t("play_no_db")}</EmptyState>
      </div>
    );
  }
  const [pausedDays, requests, upcoming] = await Promise.all([getPausedDays(), listDayRequests(), getUpcomingSessionDates(56)]);
  const upcomingByDay = new Map<Weekday, number>();
  for (const d of upcoming) {
    const day = WEEKDAYS[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7];
    upcomingByDay.set(day, (upcomingByDay.get(day) ?? 0) + 1);
  }
  // Days with people waiting: paused ones first, then in weekday order.
  const withRequests = [
    ...WEEKDAYS.filter((d) => pausedDays.includes(d) && requests.some((r) => r.day === d)),
    ...WEEKDAYS.filter((d) => !pausedDays.includes(d) && requests.some((r) => r.day === d)),
  ];

  return (
    <div className={adminStyles.page}>
      <PageHeader
        title={t("sch_title")}
        subtitle={t("sch_subtitle")}
      />

      <Section title={t("sch_weekly")} id="weekly">
        <div className={kit.tableWrap}>
          <table className={kit.table}>
            <caption className={kit.srOnly}>{t("sch_caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("sch_col_day")}</th>
                <th scope="col">{t("sch_col_signups")}</th>
                <th scope="col">{t("sch_col_ahead")}</th>
                <th scope="col">{t("sch_col_waiting")}</th>
                <th scope="col">
                  <span className={kit.srOnly}>{t("play_col_actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((day) => {
                const paused = pausedDays.includes(day);
                const waiting = requests.filter((r) => r.day === day && r.notifiedAt === null).length;
                const ahead = upcomingByDay.get(day) ?? 0;
                const label = dayName(t, day);
                return (
                  <tr key={day}>
                    <td data-label={t("sch_col_day")}>
                      <strong>{label}</strong>
                    </td>
                    <td data-label={t("sch_col_signups")}>{paused ? <Badge tone="warn">{t("sch_paused")}</Badge> : <Badge tone="good">{t("sch_open")}</Badge>}</td>
                    <td data-label={t("sch_col_ahead")}>{ahead ? t("sch_ahead", { n: ahead }) : <span className={kit.muted}>{t("sch_none_ahead")}</span>}</td>
                    <td data-label={t("sch_col_waiting")}>{waiting ? <a href={`#waiting-${day}`}>{peopleOf(t, waiting)}</a> : <span className={kit.muted}>—</span>}</td>
                    <td data-label="">
                      {!paused ? (
                        <form action={pauseDay.bind(null, day)}>
                          <SubmitButton
                            className={kit.btnSecondary}
                            loadingText={t("sch_pausing")}
                            confirmMessage={t("sch_pause_confirm", { day: label })}
                          >
                            {t("sch_pause")}
                          </SubmitButton>
                        </form>
                      ) : waiting > 0 ? (
                        <a href={`#waiting-${day}`} className={kit.btnSecondary}>
                          {t("sch_reopen_ellipsis")}
                        </a>
                      ) : (
                        <form action={resumeQuietly.bind(null, day)}>
                          <SubmitButton className={kit.btn} loadingText={t("sch_reopening")} confirmMessage={t("sch_reopen_confirm", { day: label })}>
                            {t("sch_reopen")}
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
      </Section>

      {withRequests.length === 0 ? (
        <EmptyState>{t("sch_nobody")}</EmptyState>
      ) : (
        withRequests.map((day) => (
          <WaitingList key={day} t={t} day={day} paused={pausedDays.includes(day)} requests={requests.filter((r) => r.day === day)} />
        ))
      )}
    </div>
  );
}
