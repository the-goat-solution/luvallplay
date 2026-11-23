import { clubClock } from "@/lib/club";
import { redirect } from "next/navigation";
import { AdminLink } from "@/components/admin/AdminLink";
import adminStyles from "@/components/admin/admin.module.css";
import { Badge, EmptyState, PageHeader, Section, StatGrid, StatTile, type BadgeTone } from "@/components/admin/kit";
import { ATTENTION, attentionCount } from "@/lib/admin-attention";
import { canOpenAdminPage, currentAdmin } from "@/lib/admin-access";
import { getCourtsForDate, getSpotsAndHeadcountForDates, getUpcomingSessionDates, getWaitlistForDate, listSessionsInRange } from "@/lib/db";
import { getPausedDays } from "@/lib/day-requests";
import { formatEventTimeRange, getClubToday, isDatePaused } from "@/lib/dates";
import { getStripeSyncState } from "@/lib/finance-stripe";
import s from "./today.module.css";

export const dynamic = "force-dynamic";

// The admin home: the next play day at a glance, what needs attention, and
// the jobs admins do most. Each person only sees what their role opens.

type DayState = { label: string; tone: BadgeTone; note: string };

function dayState(d: { paused: boolean; miniGame: boolean; locked: boolean; spots: number }): DayState {
  if (d.paused) return { label: "Sign-ups paused", tone: "warn", note: "This weekday is paused on the Schedule page." };
  if (d.miniGame) return { label: "Mini game", tone: "owner", note: "Members are in; casual sign-ups are closed." };
  if (d.locked) return { label: "Closed", tone: "bad", note: "Casual sign-ups are closed for this day." };
  if (d.spots <= 0) return { label: "Full", tone: "warn", note: "New sign-ups go to the waitlist." };
  return { label: "Open", tone: "good", note: "Casual sign-ups are open." };
}

function longDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-NZ", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
}

function shortDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
}

function relativeDay(dateKey: string, today: string): string {
  const days = Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

async function upcomingPlayDays(today: string) {
  const dates = (await getUpcomingSessionDates(28)).slice(0, 4);
  if (dates.length === 0) return [];
  const [sessions, counts, paused] = await Promise.all([
    listSessionsInRange(dates[0], dates[dates.length - 1]),
    getSpotsAndHeadcountForDates(dates),
    getPausedDays(),
  ]);
  return dates.map((date) => {
    const session = sessions.find((x) => x.date === date);
    const state = dayState({
      paused: isDatePaused(date, paused),
      miniGame: Boolean(counts.miniGame[date]),
      locked: Boolean(counts.locked[date]),
      spots: counts.spots[date] ?? 0,
    });
    return {
      date,
      when: relativeDay(date, today),
      time: session?.eventStartTime ? formatEventTimeRange(session.eventStartTime, session.eventEndTime) : null,
      location: session?.eventLocation ?? null,
      capacity: session?.maxSpots ?? null,
      signedUp: counts.signedUp[date] ?? 0,
      spots: counts.spots[date] ?? 0,
      state,
    };
  });
}

export default async function TodayPage() {
  const ctx = await currentAdmin().catch(() => null);
  if (ctx?.kind === "player" && !canOpenAdminPage(ctx, "/admin/play-days")) redirect("/profile");
  const can = (href: string) => canOpenAdminPage(ctx, href);
  const { dateKey: today } = getClubToday(new Date(), await clubClock());
  const hasDb = Boolean(process.env.POSTGRES_URL);

  const [days, attention, stripe] = await Promise.all([
    hasDb ? upcomingPlayDays(today).catch(() => []) : Promise.resolve([]),
    Promise.all(ATTENTION.filter((a) => can(a.href)).map(async (a) => ({ ...a, n: await attentionCount(a.key) }))),
    hasDb && process.env.STRIPE_SECRET_KEY && can("/admin/financials") ? getStripeSyncState().catch(() => null) : Promise.resolve(null),
  ]);
  const next = days[0] ?? null;
  const [waitlist, courts] = next
    ? await Promise.all([getWaitlistForDate(next.date).then((w) => w.length).catch(() => 0), getCourtsForDate(next.date).catch(() => null)])
    : [0, null];

  const todo = attention.filter((a) => a.n > 0);
  const firstName = ctx?.kind === "player" ? ctx.player.firstName : null;

  const quick = [
    { href: next ? `/admin/play-days?date=${next.date}` : "/admin/play-days", label: "Add a player to a play day" },
    { href: "/admin/members", label: "Add a member" },
    { href: "/admin/inbox", label: "Message a player" },
    { href: "/admin/financials", label: "Record an expense" },
  ].filter((q) => can(q.href.split("?")[0]));

  return (
    <div className={adminStyles.page}>
      <PageHeader title="Today" subtitle={`${firstName ? `Hi ${firstName}. ` : ""}${longDate(today)}: the next play day, what needs you, and quick links.`} />

      <Section title="Next play day" id="next">
        {!next ? (
          <EmptyState>No play days on the calendar in the next four weeks. They appear here once they&apos;re in the club calendar.</EmptyState>
        ) : (
          <>
            <div className={s.nextHead}>
              <div>
                <div className={s.nextWhen}>{next.when}</div>
                <div className={s.nextDate}>{longDate(next.date)}</div>
                <div className={s.nextMeta}>{[next.time, next.location].filter(Boolean).join(" · ")}</div>
              </div>
              <div className={s.nextState}>
                <Badge tone={next.state.tone}>{next.state.label}</Badge>
                <span className={s.muted}>{next.state.note}</span>
              </div>
            </div>
            <StatGrid>
              <StatTile label="Signed up" value={next.signedUp} hint={next.capacity ? `of ${next.capacity} places` : undefined} />
              <StatTile
                label="Casual spots left"
                value={next.spots}
                tone={next.spots <= 0 ? "warn" : undefined}
                hint={next.state.label === "Open" ? "open to sign-ups" : "not open to the public"}
              />
              <StatTile label="Waitlist" value={waitlist} tone={waitlist > 0 && next.spots > 0 ? "warn" : undefined} hint={waitlist > 0 && next.spots > 0 ? "spots are free: email them" : "people waiting"} />
              {courts !== null && <StatTile label="Courts" value={courts} hint="booked" />}
            </StatGrid>
            <div className={s.actions}>
              <AdminLink href={`/admin/play-days?date=${next.date}`} className={s.primary} prefetchShell>
                Open roster
              </AdminLink>
              {days.length > 1 && <span className={s.muted}>Then:</span>}
              {days.slice(1).map((d) => (
                <AdminLink key={d.date} href={`/admin/play-days?date=${d.date}`} className={s.chip} title={d.state.note}>
                  {shortDate(d.date)} · {d.signedUp}
                  {d.capacity ? `/${d.capacity}` : ""} · {d.state.label}
                </AdminLink>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="Needs attention" id="attention">
        {todo.length === 0 && !stripe?.lastError ? (
          <EmptyState>All clear: nothing is waiting for you.</EmptyState>
        ) : (
          <ul className={s.todo}>
            {stripe?.lastError && (
              <li className={s.todoItem}>
                <span className={`${s.todoCount} ${s.todoAlert}`}>!</span>
                <span className={s.todoText}>The Stripe sync failed, so the ledger may be out of date.</span>
                <AdminLink href="/admin/financials" className={s.todoAction}>
                  Open ledger →
                </AdminLink>
              </li>
            )}
            {todo.map((a) => (
              <li key={a.key} className={s.todoItem}>
                <span className={s.todoCount}>{a.n > 99 ? "99+" : a.n}</span>
                <span className={s.todoText}>{a.sentence(a.n)}</span>
                <AdminLink href={a.href} className={s.todoAction} prefetchShell>
                  {a.action} →
                </AdminLink>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {quick.length > 0 && (
        <Section title="Quick actions" id="quick">
          <div className={s.quick}>
            {quick.map((q) => (
              <AdminLink key={q.label} href={q.href} className={s.quickLink} prefetchShell>
                {q.label}
              </AdminLink>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
