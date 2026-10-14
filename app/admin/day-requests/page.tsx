import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminNav } from "@/components/admin/AdminNav";
import adminStyles from "@/components/admin/admin.module.css";
import { DayRequestsToastBridge } from "@/components/admin/DayRequestsToastBridge";
import { SubmitButton } from "@/components/admin/SubmitButton";
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
import { ensureTables } from "@/lib/db";
import { sendDayOpenEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

function back(param: "toast" | "toastError", message: string): never {
  redirect(`/admin/day-requests?${param}=${encodeURIComponent(message)}`);
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
  await ensureTables();
  await setDayPaused(day, false);
  revalidatePath("/");
  const { sent, failed } = await emailPending(day);
  revalidatePath("/admin/day-requests");
  const message = `${WEEKDAY_LABEL[day]} sign-ups are open again. ${emailSummary(day, sent, failed)}`;
  back(failed > 0 ? "toastError" : "toast", message);
}

async function resumeQuietly(day: Weekday) {
  "use server";
  await ensureTables();
  await setDayPaused(day, false);
  revalidatePath("/");
  revalidatePath("/admin/day-requests");
  back("toast", `${WEEKDAY_LABEL[day]} sign-ups are open again (no emails sent).`);
}

async function notifyDay(day: Weekday) {
  "use server";
  await ensureTables();
  const { sent, failed } = await emailPending(day);
  revalidatePath("/admin/day-requests");
  back(failed > 0 ? "toastError" : "toast", emailSummary(day, sent, failed));
}

async function pauseDay(formData: FormData) {
  "use server";
  const day = formData.get("day");
  if (!isWeekday(day)) back("toastError", "Pick a day to pause.");
  await ensureTables();
  await setDayPaused(day, true);
  revalidatePath("/");
  revalidatePath("/admin/day-requests");
  back(
    "toast",
    `${WEEKDAY_LABEL[day]} sign-ups are paused. Visitors can ask to be notified when it's back.`,
  );
}

async function removeRequest(id: number) {
  "use server";
  await ensureTables();
  await deleteDayRequest(id);
  revalidatePath("/admin/day-requests");
  back("toast", "Request removed.");
}

function formatNzDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const buttonStyle = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #1a2a4a",
  background: "#1a2a4a",
  color: "#fff",
  fontSize: 13,
} as const;

const secondaryButtonStyle = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #ccc",
  background: "#fff",
  color: "#333",
  fontSize: 13,
} as const;

function DaySection({
  day,
  paused,
  requests,
}: {
  day: Weekday;
  paused: boolean;
  requests: DayRequest[];
}) {
  const label = WEEKDAY_LABEL[day];
  const pending = requests.filter((r) => r.notifiedAt === null);

  return (
    <section
      style={{
        border: "1px solid #e3e3e3",
        borderRadius: 8,
        padding: "16px 18px",
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <h2 style={{ fontSize: 17, margin: 0 }}>{label} session requests</h2>
        {paused ? (
          <span
            style={{
              background: "#fff4e5",
              color: "#8a4b00",
              fontSize: 12,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            Sign-ups paused
          </span>
        ) : null}
        <span style={{ color: "#666", fontSize: 13 }}>
          {pending.length} waiting
        </span>
      </div>
      <p style={{ color: "#666", fontSize: 13, marginTop: 0 }}>
        {paused
          ? `New memberships and casual bookings for ${label} sessions are paused on the website. Existing members and bookings are unaffected.`
          : `People asking to be emailed if ${label} sessions open up.`}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {paused ? (
          <>
            <form action={resumeAndNotify.bind(null, day)}>
              <SubmitButton
                loadingText="Reopening…"
                style={buttonStyle}
                confirmMessage={`Reopen ${label} sign-ups and email ${pending.length} ${pending.length === 1 ? "person" : "people"} that ${label} sessions are back?`}
              >
                Reopen {label} &amp; email {pending.length} waiting
              </SubmitButton>
            </form>
            <form action={resumeQuietly.bind(null, day)}>
              <SubmitButton
                loadingText="Reopening…"
                style={secondaryButtonStyle}
                confirmMessage={`Reopen ${label} sign-ups without emailing anyone?`}
              >
                Reopen without emailing
              </SubmitButton>
            </form>
          </>
        ) : pending.length > 0 ? (
          <form action={notifyDay.bind(null, day)}>
            <SubmitButton
              loadingText="Sending…"
              style={buttonStyle}
              confirmMessage={`Email ${pending.length} ${pending.length === 1 ? "person" : "people"} that ${label} sessions are now open? Only do this once ${label} sessions are on the calendar.`}
            >
              Email {pending.length} waiting: {label} is open
            </SubmitButton>
          </form>
        ) : null}
      </div>

      <div className={adminStyles.tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th style={{ padding: "6px 8px" }}>Name</th>
              <th style={{ padding: "6px 8px" }}>Email</th>
              <th style={{ padding: "6px 8px" }}>Requested</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: "10px 8px", color: "#888" }}>
                  No requests yet.
                </td>
              </tr>
            ) : (
              requests.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "6px 8px" }}>{r.name}</td>
                  <td style={{ padding: "6px 8px" }}>{r.email}</td>
                  <td style={{ padding: "6px 8px" }}>{formatNzDate(r.createdAt)}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {r.notifiedAt ? (
                      <span style={{ color: "#1a7a3c" }}>
                        Emailed {formatNzDate(r.notifiedAt)}
                      </span>
                    ) : (
                      <span style={{ color: "#8a4b00" }}>Waiting</span>
                    )}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <form action={removeRequest.bind(null, r.id)}>
                      <SubmitButton
                        loadingText="Removing…"
                        style={{ ...secondaryButtonStyle, padding: "3px 8px", fontSize: 12 }}
                        confirmMessage={`Remove ${r.name}'s ${label} request?`}
                      >
                        Remove
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function DayRequestsAdminPage() {
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const [pausedDays, requests] = hasDb
    ? await (async () => {
        await ensureTables();
        return Promise.all([getPausedDays(), listDayRequests()]);
      })()
    : [[] as Weekday[], [] as DayRequest[]];

  // Paused days first (Wednesday's requests lead while it's paused), then any
  // other day someone has asked for, in weekday order.
  const days = [
    ...WEEKDAYS.filter((d) => pausedDays.includes(d)),
    ...WEEKDAYS.filter(
      (d) => !pausedDays.includes(d) && requests.some((r) => r.day === d),
    ),
  ];
  const pausable = WEEKDAYS.filter((d) => !pausedDays.includes(d));

  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Day requests</h1>
      <p className={adminStyles.subtitle}>
        Paused play days, and people waiting to hear when a day opens.
      </p>
      <AdminNav active="day-requests" />
      <DayRequestsToastBridge />

      {!hasDb ? (
        <p>Database is not configured.</p>
      ) : (
        <>
          {days.length === 0 ? (
            <p style={{ color: "#888" }}>
              No paused days and no requests yet.
            </p>
          ) : (
            days.map((day) => (
              <DaySection
                key={day}
                day={day}
                paused={pausedDays.includes(day)}
                requests={requests.filter((r) => r.day === day)}
              />
            ))
          )}

          <h2 style={{ fontSize: 16, marginTop: 32, marginBottom: 8 }}>
            Pause sign-ups for a day
          </h2>
          <p style={{ color: "#666", fontSize: 13, marginBottom: 12 }}>
            Stops new memberships and casual bookings for every session on that
            weekday. Visitors see that it&apos;s paused and can ask to be
            emailed when it&apos;s back.
          </p>
          <form
            action={pauseDay}
            style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
          >
            <select
              name="day"
              defaultValue=""
              required
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #ccc",
                fontSize: 13,
              }}
            >
              <option value="" disabled>
                Choose a day
              </option>
              {pausable.map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_LABEL[d]}
                </option>
              ))}
            </select>
            <SubmitButton loadingText="Pausing…" style={secondaryButtonStyle}>
              Pause sign-ups
            </SubmitButton>
          </form>
        </>
      )}
    </div>
  );
}
