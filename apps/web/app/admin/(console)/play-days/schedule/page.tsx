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

function emailSummary(day: Weekday, sent: number, failed: number): string {
  const label = WEEKDAY_LABEL[day];
  if (sent === 0 && failed === 0) return `No one was waiting on ${label}.`;
  const base = `Emailed ${sent} ${sent === 1 ? "person" : "people"} that ${label} is open.`;
  return failed > 0 ? `${base} ${failed} failed — click again to retry.` : base;
}

// Reopens sign-ups for a paused day and emails everyone who asked to hear
// when it's back.
async function resumeAndNotify(day: Weekday) {
  "use server";
  await setDayPaused(day, false);
  revalidatePath("/");
  const { sent, failed } = await emailPending(day);
  revalidatePath("/admin/play-days/schedule");
  const message = `${WEEKDAY_LABEL[day]} sign-ups are open again. ${emailSummary(day, sent, failed)}`;
  back(failed > 0 ? "toastError" : "toast", message);
}

async function resumeQuietly(day: Weekday) {
  "use server";
  await setDayPaused(day, false);
  revalidatePath("/");
  revalidatePath("/admin/play-days/schedule");
  back("toast", `${WEEKDAY_LABEL[day]} sign-ups are open again (no emails sent).`);
}

async function notifyDay(day: Weekday) {
  "use server";
  const { sent, failed } = await emailPending(day);
  revalidatePath("/admin/play-days/schedule");
  back(failed > 0 ? "toastError" : "toast", emailSummary(day, sent, failed));
}

async function pauseDay(day: Weekday) {
  "use server";
  if (!isWeekday(day)) back("toastError", "Pick a day to pause.");
  await setDayPaused(day, true);
  revalidatePath("/");
  revalidatePath("/admin/play-days/schedule");
  back(
    "toast",
    `${WEEKDAY_LABEL[day]} sign-ups are paused. Visitors can ask to be notified when it's back.`,
  );
}

async function removeRequest(id: number) {
  "use server";
  await deleteDayRequest(id);
  revalidatePath("/admin/play-days/schedule");
  back("toast", "Request removed.");
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short" });
}

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

function WaitingList({ day, paused, requests }: { day: Weekday; paused: boolean; requests: DayRequest[] }) {
  const label = WEEKDAY_LABEL[day];
  const pending = requests.filter((r) => r.notifiedAt === null);
  return (
    <Section title={`Waiting for ${label}`} id={`waiting-${day}`}>
      <p className={kit.muted} style={{ fontSize: 13, marginTop: -4 }}>
        {paused
          ? `${label} is paused. These people asked to be emailed when it reopens.`
          : `${label} is open. These people asked to be emailed about ${label} play days.`}
      </p>
      <div className={kit.rowActions} style={{ marginBottom: 12 }}>
        {paused ? (
          <>
            <form action={resumeAndNotify.bind(null, day)}>
              <SubmitButton
                className={kit.btn}
                loadingText="Reopening…"
                confirmMessage={`Reopen ${label} sign-ups and email ${people(pending.length)} that ${label} is back?`}
              >
                Reopen {label} and email {people(pending.length)}
              </SubmitButton>
            </form>
            <form action={resumeQuietly.bind(null, day)}>
              <SubmitButton className={kit.btnSecondary} loadingText="Reopening…" confirmMessage={`Reopen ${label} sign-ups without emailing anyone?`}>
                Reopen without emailing
              </SubmitButton>
            </form>
          </>
        ) : pending.length > 0 ? (
          <form action={notifyDay.bind(null, day)}>
            <SubmitButton
              className={kit.btn}
              loadingText="Sending…"
              confirmMessage={`Email ${people(pending.length)} that ${label} is open? Do this once ${label} play days are on the calendar.`}
            >
              Email {people(pending.length)} that {label} is open
            </SubmitButton>
          </form>
        ) : null}
      </div>
      <div className={kit.tableWrap}>
        <table className={kit.table}>
          <caption className={kit.srOnly}>People waiting for {label}</caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Asked</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className={kit.srOnly}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td data-label="Person">
                  <div>
                    {r.name}
                    <span className={kit.sub}>{r.email}</span>
                  </div>
                </td>
                <td data-label="Asked">{shortDate(r.createdAt)}</td>
                <td data-label="Status">{r.notifiedAt ? <Badge tone="good">Emailed {shortDate(r.notifiedAt)}</Badge> : <Badge tone="warn">Waiting</Badge>}</td>
                <td data-label="">
                  <form action={removeRequest.bind(null, r.id)}>
                    <SubmitButton className={kit.btnSecondary} loadingText="Removing…" confirmMessage={`Remove ${r.name}'s request for ${label}?`}>
                      Remove
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
  const hasDb = Boolean(process.env.POSTGRES_URL);
  if (!hasDb) {
    return (
      <div className={adminStyles.page}>
        <PageHeader title="Schedule" />
        <EmptyState>Database is not configured.</EmptyState>
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
        title="Schedule"
        subtitle="Which weekdays take sign-ups. Pausing a day stops new memberships and casual bookings for it; visitors can ask to be emailed when it reopens."
      />

      <Section title="Weekly sign-ups" id="weekly">
        <div className={kit.tableWrap}>
          <table className={kit.table}>
            <caption className={kit.srOnly}>Sign-ups by weekday</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Sign-ups</th>
                <th scope="col">Play days ahead</th>
                <th scope="col">Waiting</th>
                <th scope="col">
                  <span className={kit.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((day) => {
                const paused = pausedDays.includes(day);
                const waiting = requests.filter((r) => r.day === day && r.notifiedAt === null).length;
                const ahead = upcomingByDay.get(day) ?? 0;
                const label = WEEKDAY_LABEL[day];
                return (
                  <tr key={day}>
                    <td data-label="Day">
                      <strong>{label}</strong>
                    </td>
                    <td data-label="Sign-ups">{paused ? <Badge tone="warn">Paused</Badge> : <Badge tone="good">Open</Badge>}</td>
                    <td data-label="Play days ahead">{ahead ? `${ahead} in the next 8 weeks` : <span className={kit.muted}>none on the calendar</span>}</td>
                    <td data-label="Waiting">{waiting ? <a href={`#waiting-${day}`}>{people(waiting)}</a> : <span className={kit.muted}>—</span>}</td>
                    <td data-label="">
                      {!paused ? (
                        <form action={pauseDay.bind(null, day)}>
                          <SubmitButton
                            className={kit.btnSecondary}
                            loadingText="Pausing…"
                            confirmMessage={`Pause ${label} sign-ups? New memberships and casual bookings for ${label} stop; existing members and bookings are kept.`}
                          >
                            Pause
                          </SubmitButton>
                        </form>
                      ) : waiting > 0 ? (
                        <a href={`#waiting-${day}`} className={kit.btnSecondary}>
                          Reopen…
                        </a>
                      ) : (
                        <form action={resumeQuietly.bind(null, day)}>
                          <SubmitButton className={kit.btn} loadingText="Reopening…" confirmMessage={`Reopen ${label} sign-ups?`}>
                            Reopen
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
        <EmptyState>Nobody is waiting for a day to reopen.</EmptyState>
      ) : (
        withRequests.map((day) => (
          <WaitingList key={day} day={day} paused={pausedDays.includes(day)} requests={requests.filter((r) => r.day === day)} />
        ))
      )}
    </div>
  );
}
