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
import { enabledModules } from "@/lib/club-modules";
import { sql } from "@/lib/database";
import { blockedByModule } from "@luvallplay/modules";
import s from "./today.module.css";
import { clubLocale } from "@/lib/club-brand";
import { adminText } from "@/lib/admin-lang";
import type { AdminKey } from "@luvallplay/i18n/admin";

type T = Awaited<ReturnType<typeof adminText>>["t"];
type StateKey = "paused" | "mini" | "closed" | "full" | "open";

export const dynamic = "force-dynamic";

// The admin home: the next play day at a glance, what needs attention, and
// the jobs admins do most. Each person only sees what their role opens.

type DayState = { key: StateKey; tone: BadgeTone };

function dayState(d: { paused: boolean; miniGame: boolean; locked: boolean; spots: number }): DayState {
  if (d.paused) return { key: "paused", tone: "warn" };
  if (d.miniGame) return { key: "mini", tone: "owner" };
  if (d.locked) return { key: "closed", tone: "bad" };
  if (d.spots <= 0) return { key: "full", tone: "warn" };
  return { key: "open", tone: "good" };
}

function longDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString(clubLocale(), { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
}

function shortDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString(clubLocale(), { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
}

function relativeDay(t: T, dateKey: string, today: string): string {
  const days = Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return t("today_rel_today");
  if (days === 1) return t("today_rel_tomorrow");
  return t("today_rel_days", { n: days });
}

// The Today wording for each attention item. A module's own English sentence
// (its manifest) is the fallback for a key with no translation yet.
const attKey = (key: string, part: "one" | "many" | "action") => `att_${key}_${part}` as AdminKey;
function attSentence(t: T, a: { key: string; n: number; sentence: (n: number) => string }): string {
  const k = attKey(a.key, a.n === 1 ? "one" : "many");
  const out = t(k, { n: a.n });
  return out === k ? a.sentence(a.n) : out;
}
function attAction(t: T, a: { key: string; action: string }): string {
  const k = attKey(a.key, "action");
  const out = t(k);
  return out === k ? a.action : out;
}

async function upcomingPlayDays(t: T, today: string) {
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
      when: relativeDay(t, date, today),
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
  const { t } = await adminText();
  const stLabel = (k: StateKey) => t(`today_st_${k}` as AdminKey);
  const stNote = (k: StateKey) => t(`today_st_${k}_note` as AdminKey);
  const ctx = await currentAdmin().catch(() => null);
  if (ctx?.kind === "player" && !canOpenAdminPage(ctx, "/admin/play-days")) redirect("/profile");
  // What this person's role opens, among the modules switched on for the club.
  const modulesOn = await enabledModules(sql);
  const can = (href: string) => canOpenAdminPage(ctx, href) && !blockedByModule(href, modulesOn);
  const { dateKey: today } = getClubToday(new Date(), await clubClock());
  const hasDb = Boolean(process.env.POSTGRES_URL);

  const [days, attention, stripe] = await Promise.all([
    hasDb ? upcomingPlayDays(t, today).catch(() => []) : Promise.resolve([]),
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
    { href: next ? `/admin/play-days?date=${next.date}` : "/admin/play-days", label: t("today_q_add_player") },
    { href: "/admin/members", label: t("today_q_add_member") },
    { href: "/admin/inbox", label: t("today_q_message") },
    { href: "/admin/financials", label: t("today_q_expense") },
  ].filter((q) => can(q.href.split("?")[0]));

  return (
    <div className={adminStyles.page}>
      <PageHeader title={t("today_title")} subtitle={t("today_subtitle", { hi: firstName ? t("today_subtitle_hi", { name: firstName }) : "", date: longDate(today) })} />

      <Section title={t("today_next_title")} id="next">
        {!next ? (
          <EmptyState>{t("today_next_none")}</EmptyState>
        ) : (
          <>
            <div className={s.nextHead}>
              <div>
                <div className={s.nextWhen}>{next.when}</div>
                <div className={s.nextDate}>{longDate(next.date)}</div>
                <div className={s.nextMeta}>{[next.time, next.location].filter(Boolean).join(" · ")}</div>
              </div>
              <div className={s.nextState}>
                <Badge tone={next.state.tone}>{stLabel(next.state.key)}</Badge>
                <span className={s.muted}>{stNote(next.state.key)}</span>
              </div>
            </div>
            <StatGrid>
              <StatTile label={t("play_signed_up")} value={next.signedUp} hint={next.capacity ? t("today_of_places", { n: next.capacity }) : undefined} />
              <StatTile
                label={t("play_casual_left")}
                value={next.spots}
                tone={next.spots <= 0 ? "warn" : undefined}
                hint={next.state.key === "open" ? t("play_open_to_signups") : t("play_not_public")}
              />
              <StatTile label={t("play_waitlist")} value={waitlist} tone={waitlist > 0 && next.spots > 0 ? "warn" : undefined} hint={waitlist > 0 && next.spots > 0 ? t("today_waitlist_free") : t("play_people_waiting")} />
              {courts !== null && <StatTile label={t("play_courts")} value={courts} hint={t("today_booked")} />}
            </StatGrid>
            <div className={s.actions}>
              <AdminLink href={`/admin/play-days?date=${next.date}`} className={s.primary} prefetchShell>
                {t("today_open_roster")}
              </AdminLink>
              {days.length > 1 && <span className={s.muted}>{t("today_then")}</span>}
              {days.slice(1).map((d) => (
                <AdminLink key={d.date} href={`/admin/play-days?date=${d.date}`} className={s.chip} title={stNote(d.state.key)}>
                  {shortDate(d.date)} · {d.signedUp}
                  {d.capacity ? `/${d.capacity}` : ""} · {stLabel(d.state.key)}
                </AdminLink>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title={t("today_attention_title")} id="attention">
        {todo.length === 0 && !stripe?.lastError ? (
          <EmptyState>{t("today_all_clear")}</EmptyState>
        ) : (
          <ul className={s.todo}>
            {stripe?.lastError && (
              <li className={s.todoItem}>
                <span className={`${s.todoCount} ${s.todoAlert}`}>!</span>
                <span className={s.todoText}>{t("today_stripe_failed")}</span>
                <AdminLink href="/admin/financials" className={s.todoAction}>
                  {t("today_open_ledger")}
                </AdminLink>
              </li>
            )}
            {todo.map((a) => (
              <li key={a.key} className={s.todoItem}>
                <span className={s.todoCount}>{a.n > 99 ? "99+" : a.n}</span>
                <span className={s.todoText}>{attSentence(t, a)}</span>
                <AdminLink href={a.href} className={s.todoAction} prefetchShell>
                  {attAction(t, a)} →
                </AdminLink>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {quick.length > 0 && (
        <Section title={t("today_quick_title")} id="quick">
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
