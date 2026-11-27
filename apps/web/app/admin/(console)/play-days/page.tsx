import { clubClock } from "@/lib/club";
import { sessionCapacityFor } from "@luvallplay/core/club-config";
import { clubConfig } from "@/lib/club";
import { CLUB_TIME_ZONE } from "@/lib/constants";
import { redirect } from "next/navigation";
import { AdminLink } from "@/components/admin/AdminLink";
import { revalidatePath } from "next/cache";
import { deleteWaitlistEntry, getAvailableSpots, getCourtsForDate, getRosterForDate, getWaitlistForDate, isMiniGameDay, isRegistrationLocked, listAllSessionDates, listSessionsInRange, removeBooking, removeSessionFillIn, reserveBookingSlot, saveSessionFillIn, setCourtsForDate, setMiniGameDay, setRegistrationLocked, type FillInTarget } from "@/lib/db";
import { Badge, EmptyState, FormPanel, InfoDisclosure, PageHeader, Section, StatGrid, StatTile, Tabs, Toolbar, kit } from "@/components/admin/kit";
import { PlayDayPicker } from "@/components/admin/PlayDayPicker";
import { notifyWaitlistIfSpotOpened } from "@/lib/waitlist-notify";
import { sendFillInConfirmationEmail } from "@/lib/email";
import { formatEventTimeRange, getClubToday } from "@/lib/dates";
import { AttendanceSection } from "@/components/admin/AttendanceSection";
import adminStyles from "@/components/admin/admin.module.css";
import { FillInButton } from "@/components/admin/FillInButton";
import { SubmitButton } from "@/components/admin/SubmitButton";
import {
  CASUAL_PRICE_CENTS,
} from "@/lib/constants";
import {
  offlineInvoiceIdFromRef,
  parseOfflineMethod,
} from "@/lib/offline-payment";
import { reconcileOfflinePayment, recordOfflinePayment } from "@/lib/offline-payment-stripe";
import { getOfflinePaymentReconciliation, type OfflineReconciliation } from "@/lib/bank-db";
import { OfflinePaymentMethodField } from "@/components/admin/OfflinePaymentMethodField";
import { clubMoney } from "@/lib/money";
import { clubLocale, membershipDays } from "@/lib/club-brand";
import { adminText } from "@/lib/admin-lang";
import { navLabel, type AdminKey } from "@luvallplay/i18n/admin";

export const dynamic = "force-dynamic";

const PLAN_KEY = { casual: "play_plan_casual", monthly: "play_plan_monthly", quarterly: "play_plan_quarterly" } as const satisfies Record<string, AdminKey>;
const METHOD_KEY = { card: "play_method_card", cash: "play_method_cash", bank_transfer: "play_method_bank_transfer" } as const satisfies Record<string, AdminKey>;

// Adds a player who paid outside the online checkout — cash at the
// session or a bank transfer to the club account. The payment is recorded
// in Stripe as a $10 invoice paid out of band, then added to the finance
// ledger; a bank transfer is matched to its bank statement line straight
// away if it's already in, otherwise automatically when it arrives.
async function addOfflinePlayer(date: string, formData: FormData) {
  "use server";
  const { t } = await adminText();

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const method = parseOfflineMethod(formData.get("method"));

  if (!firstName || !lastName || !email) {
    redirect(`/admin/play-days?date=${date}&cashError=${encodeURIComponent(t("play_err_required"))}`);
  }

  // Admin adds go through even when registration is locked — the lock only
  // closes public sign-ups.
  const spots = await getAvailableSpots(date, { ignoreLock: true });
  if (spots <= 0) {
    redirect(`/admin/play-days?date=${date}&cashError=${encodeURIComponent(t("play_err_full"))}`);
  }

  let recorded: Awaited<ReturnType<typeof recordOfflinePayment>>;
  try {
    recorded = await recordOfflinePayment({
      method,
      email,
      firstName,
      lastName,
      phone,
      amountCents: CASUAL_PRICE_CENTS,
      description: `Casual session — ${date}`,
      metadata: {
        type: "casual",
        sessionDate: date,
        firstName,
        lastName,
        email,
        phone,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : t("play_err_record");
    redirect(`/admin/play-days?date=${date}&cashError=${encodeURIComponent(message)}`);
  }

  const ok = await reserveBookingSlot(date, {
    firstName,
    lastName,
    email,
    phone: phone || undefined,
    paymentIntentId: recorded.paymentRef,
  });

  if (!ok) {
    redirect(
      `/admin/play-days?date=${date}&cashError=${encodeURIComponent(
        t("play_err_filled", { id: recorded.invoiceId }),
      )}`,
    );
  }

  const reconciled = await reconcileOfflinePayment(recorded, method);

  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&cashAdded=${reconciled === "matched" ? "matched" : method}`);
}

async function removePlayer(date: string, bookingId: number) {
  "use server";
  await removeBooking(bookingId, date);
  // The booking is gone, so any stand-in arranged for it is meaningless —
  // drop it too, rather than leaving a row pointing at a booking id that no
  // longer exists.
  await removeSessionFillIn(date, { bookingId });
  // Removing a casual booking frees a spot — let anyone waitlisted for this
  // date know right away rather than waiting on another trigger.
  await notifyWaitlistIfSpotOpened(date);
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&removed=1`);
}

async function updateCourts(date: string, formData: FormData) {
  "use server";
  const { t } = await adminText();
  const courts = Number(formData.get("courts"));

  if (![1, 2, 3, 4].includes(courts)) {
    redirect(
      `/admin/play-days?date=${date}&courtsError=${encodeURIComponent(t("play_err_courts"))}`,
    );
  }

  const before = await getCourtsForDate(date);
  const result = await setCourtsForDate(date, courts);
  if (!result.ok) {
    redirect(`/admin/play-days?date=${date}&courtsError=${encodeURIComponent(result.reason)}`);
  }

  // Only a capacity increase can free up a spot — no point checking on a
  // decrease (setCourtsForDate already refuses to shrink below signups).
  const cfg = await clubConfig();
  if (sessionCapacityFor(cfg, courts) > sessionCapacityFor(cfg, before)) {
    await notifyWaitlistIfSpotOpened(date);
  }

  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&courtsUpdated=${courts}`);
}

type SignupMode = "open" | "closed" | "mini";

// One control for who can sign up: open, closed (admins can still add
// players), or a mini game (members in, casual sign-ups closed, 16 max).
// Built from the two switches above, so the rules stay the same.
async function setSignupMode(date: string, mode: SignupMode) {
  "use server";
  const fail = (reason: string) => redirect(`/admin/play-days?date=${date}&courtsError=${encodeURIComponent(reason)}`);
  const mini = await isMiniGameDay(date);
  if (mode === "mini") {
    if (!mini) {
      const result = await setMiniGameDay(date, true);
      if (!result.ok) fail(result.reason);
    }
    revalidatePath("/admin/play-days");
    redirect(`/admin/play-days?date=${date}&miniGame=on`);
  }
  if (mini) {
    // Turning mini game off also reopens sign-ups.
    const result = await setMiniGameDay(date, false);
    if (!result.ok) fail(result.reason);
  }
  await setRegistrationLocked(date, mode === "closed");
  if (mode === "open") await notifyWaitlistIfSpotOpened(date);
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&registration=${mode === "closed" ? "locked" : "unlocked"}`);
}

async function notifyWaitlistNow(date: string) {
  "use server";
  const count = await notifyWaitlistIfSpotOpened(date);
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&tab=waitlist&waitlistNotified=${count}`);
}

// Records the stand-in for a player who can't make this session. No payment
// is taken and no booking row is created: the original player already paid
// for the spot, so this is a substitution on an existing seat, and the
// session's headcount is deliberately left untouched.
async function saveFillIn(
  date: string,
  target: FillInTarget,
  formData: FormData,
) {
  "use server";

  const { t } = await adminText();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  const fail = (message: string) =>
    redirect(
      `/admin/play-days?date=${date}&fillInError=${encodeURIComponent(message)}`,
    );

  if (!firstName || !lastName || !email) {
    fail(t("play_err_standin_required"));
  }

  // One person can't hold two spots on the same day, so reject a fill-in
  // whose email is already on this roster — as a player, or as somebody
  // else's stand-in. The player being replaced is excluded: re-saving a
  // fill-in without changing the email is an edit, not a duplicate.
  const roster = await getRosterForDate(date);
  const isTarget = (entry: (typeof roster)[number]) =>
    target.membershipId !== undefined
      ? entry.membershipId === target.membershipId
      : entry.bookingId === target.bookingId;
  const emailKey = email.toLowerCase();
  for (const entry of roster) {
    if (isTarget(entry)) continue;
    if (entry.email.toLowerCase() === emailKey) {
      fail(t("play_err_roster_dup", { name: entry.name }));
    }
    if (entry.fillIn && entry.fillIn.email.toLowerCase() === emailKey) {
      fail(t("play_err_standin_dup", { name: entry.name }));
    }
  }

  await saveSessionFillIn(date, target, {
    firstName,
    lastName,
    email,
    phone: phone || null,
  });

  const [session] = await listSessionsInRange(date, date);
  const sessionTime = session?.eventStartTime
    ? formatEventTimeRange(session.eventStartTime, session.eventEndTime)
    : null;
  const replacing =
    roster.find((entry) => isTarget(entry))?.name ?? "a member";
  await sendFillInConfirmationEmail(email, {
    firstName,
    replacing,
    sessionDate: date,
    sessionTime,
    sessionLocation: session?.eventLocation ?? null,
  }).catch((err) =>
    console.error("Failed to send fill-in confirmation email", err),
  );

  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&fillInSaved=1`);
}

async function clearFillIn(date: string, target: FillInTarget) {
  "use server";
  await removeSessionFillIn(date, target);
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&fillInRemoved=1`);
}

async function removeWaitlistEntry(date: string, id: number) {
  "use server";
  await deleteWaitlistEntry(id);
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&tab=waitlist&waitlistRemoved=1`);
}

type Tab = "roster" | "waitlist" | "attendance";

function dayLabel(key: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(clubLocale(), { timeZone: "UTC", ...opts });
}

function TransferStatus({ status, t }: { status: OfflineReconciliation | undefined; t: T }) {
  return status?.reconciled ? (
    <span className={kit.sub} style={{ color: "#1a7a3c" }}>
      {status.bankDate ? t("play_matched_on", { date: dayLabel(status.bankDate) }) : t("play_matched")}
    </span>
  ) : (
    <span className={kit.sub} style={{ color: "#8a4b00" }}>
      {t("play_waiting_transfer")}
    </span>
  );
}

// The mini-game cap is the club's setting, so the text is built per request.
type T = Awaited<ReturnType<typeof adminText>>["t"];
// "Friday and Wednesday", in the admin's language.
const dayList = (t: T, days: readonly string[]) => {
  const names = days.map((d) => t(`weekday_${d}` as AdminKey));
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")}${t("list_and")}${names[names.length - 1]}`;
};
const modeHelp = (miniGameMax: number, t: T): Record<SignupMode, string> => ({
  open: t("play_help_open"),
  closed: t("play_help_closed"),
  mini: t("play_help_mini", { n: miniGameMax }),
});

export default async function PlayDaysAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string }>;
}) {
  const { t, lang } = await adminText();
  const { date: dateParam, tab: tabParam } = await searchParams;
  const tab: Tab = tabParam === "waitlist" || tabParam === "attendance" ? tabParam : "roster";
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const sessionKeys = hasDb ? await listAllSessionDates() : [];

  const { dateKey: todayKey } = getClubToday(new Date(), await clubClock());
  const defaultDate = sessionKeys.find((key) => key >= todayKey) ?? sessionKeys[sessionKeys.length - 1];
  const selectedDate = dateParam && sessionKeys.includes(dateParam) ? dateParam : defaultDate;

  const header = (
    <PageHeader
      title={t("play_title")}
      subtitle={t("play_subtitle")}
      actions={
        selectedDate ? (
          <PlayDayPicker
            options={sessionKeys.map((key) => ({
              key,
              label: `${dayLabel(key, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}${key === todayKey ? t("play_today") : key < todayKey ? t("play_past") : ""}`,
            }))}
            selected={selectedDate}
            prev={sessionKeys[sessionKeys.indexOf(selectedDate) - 1] ?? null}
            next={sessionKeys[sessionKeys.indexOf(selectedDate) + 1] ?? null}
          />
        ) : undefined
      }
    />
  );

  if (!hasDb || !selectedDate) {
    return (
      <div className={adminStyles.page}>
        {header}
        <EmptyState>{hasDb ? t("play_none") : t("play_no_db")}</EmptyState>
      </div>
    );
  }

  const [roster, waitlist, casualSpotsRemaining, courts, registrationLocked, miniGame, [session]] = await Promise.all([
    getRosterForDate(selectedDate),
    getWaitlistForDate(selectedDate),
    // Shown ignoring the lock, so the admin still sees real capacity.
    getAvailableSpots(selectedDate, { ignoreLock: true }),
    getCourtsForDate(selectedDate),
    isRegistrationLocked(selectedDate),
    isMiniGameDay(selectedDate),
    listSessionsInRange(selectedDate, selectedDate),
  ]);
  // Bank transfers show whether they've been matched to the statement.
  let reconciliation = new Map<string, OfflineReconciliation>();
  const transferInvoices = roster
    .filter((p) => p.method === "bank_transfer")
    .map((p) => offlineInvoiceIdFromRef(p.paymentRef))
    .filter((id): id is string => Boolean(id));
  try {
    reconciliation = await getOfflinePaymentReconciliation(transferInvoices);
  } catch (err) {
    console.error("Failed to load bank reconciliation for the roster", err);
  }

  const cfg = await clubConfig();
  const miniGameMax = cfg.roundRobin.miniGameMaxPlayers;
  const maxPlayers = sessionCapacityFor(cfg, courts, miniGame);
  const mode: SignupMode = miniGame ? "mini" : registrationLocked ? "closed" : "open";
  const waiting = waitlist.filter((w) => !w.notifiedAt).length;
  const canNotify = mode === "open" && casualSpotsRemaining > 0 && waitlist.length > 0;
  const tabHref = (t: Tab) => `/admin/play-days?date=${selectedDate}${t === "roster" ? "" : `&tab=${t}`}`;
  const when = [session?.eventStartTime ? formatEventTimeRange(session.eventStartTime, session.eventEndTime) : null, session?.eventLocation]
    .filter(Boolean)
    .join(" · ");
  const modeButtons: { mode: SignupMode; label: string; confirm?: string }[] = [
    { mode: "open", label: t("play_mode_open") },
    { mode: "closed", label: t("play_mode_closed"), confirm: t("play_confirm_close") },
    { mode: "mini", label: t("play_mode_mini"), confirm: t("play_confirm_mini", { n: miniGameMax }) },
  ];

  return (
    <div className={adminStyles.page}>
      {header}

      <Section title={dayLabel(selectedDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} id="day">
        {when && <p className={kit.muted} style={{ marginTop: -6, fontSize: 14 }}>{when}</p>}
        <StatGrid>
          <StatTile label={t("play_signed_up")} value={roster.length} hint={t("play_of_places", { n: maxPlayers })} />
          <StatTile label={t("play_casual_left")} value={casualSpotsRemaining} tone={casualSpotsRemaining <= 0 ? "warn" : undefined} hint={mode === "open" ? t("play_open_to_signups") : t("play_not_public")} />
          <StatTile label={t("play_waitlist")} value={waitlist.length} tone={canNotify ? "warn" : undefined} hint={canNotify ? t("play_spots_free") : waiting ? t("play_not_emailed", { n: waiting }) : t("play_people_waiting")} />
          <StatTile label={t("play_courts")} value={courts} hint={miniGame ? t("play_mini_max", { n: miniGameMax }) : t("play_up_to", { n: maxPlayers })} />
        </StatGrid>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 28px", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 320px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t("play_signups")}</div>
            <div className={kit.segmented} role="group" aria-label={t("play_signups")}>
              {modeButtons.map((b) =>
                mode === b.mode ? (
                  <span key={b.mode} className={`${kit.segment} ${kit.segmentOn}`} aria-current="true">
                    {b.label}
                  </span>
                ) : (
                  <form key={b.mode} action={setSignupMode.bind(null, selectedDate, b.mode)}>
                    <SubmitButton className={kit.segment} loadingText={t("play_saving")} confirmMessage={b.confirm}>
                      {b.label}
                    </SubmitButton>
                  </form>
                ),
              )}
            </div>
            <p className={kit.muted} style={{ fontSize: 13, margin: "8px 0 0", maxWidth: 560 }}>
              {modeHelp(miniGameMax, t)[mode]}
            </p>
          </div>
          <form action={updateCourts.bind(null, selectedDate)} style={{ flex: "0 0 auto" }}>
            <label htmlFor="courts" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {t("play_courts_booked")}
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <select id="courts" name="courts" defaultValue={courts} className={kit.select}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {t(n === 1 ? "play_court_one" : "play_court_many", { n, max: sessionCapacityFor(cfg, n) })}
                  </option>
                ))}
              </select>
              <SubmitButton className={kit.btn} loadingText={t("play_saving")}>
                {t("common_save")}
              </SubmitButton>
            </div>
          </form>
        </div>
      </Section>

      <InfoDisclosure summary={t("play_how_summary")}>
        <p>{t(courts === 1 ? "play_how_1_one" : "play_how_1_many", { cap: sessionCapacityFor(cfg, courts), n: courts, mini: miniGameMax })}</p>
        <p>{t("play_how_2")}</p>
        <p>{t("play_how_3", { days: dayList(t, membershipDays()) })}</p>
      </InfoDisclosure>

      <Tabs
        label={t("play_tab_label")}
        current={tab}
        items={[
          { key: "roster", label: t("play_tab_roster"), href: tabHref("roster"), count: roster.length },
          { key: "waitlist", label: t("play_tab_waitlist"), href: tabHref("waitlist"), count: waitlist.length },
          { key: "attendance", label: t("play_tab_attendance"), href: tabHref("attendance") },
        ]}
      />

      {tab === "roster" && (
        <>
          <FormPanel summary={t("play_add_summary")} title={t("play_add_title")} id="add">
            <p className={kit.muted} style={{ fontSize: 13, margin: 0 }}>
              {t("play_add_intro_a", { price: clubMoney(CASUAL_PRICE_CENTS) })}
              <AdminLink href="/admin/financials/bank">{navLabel(lang, "Bank")}</AdminLink>
              {t("play_add_intro_b")}
            </p>
            <form action={addOfflinePlayer.bind(null, selectedDate)} className={kit.formGrid}>
              <label className={kit.field}>
                {t("play_first_name")}
                <input name="firstName" required className={kit.input} autoComplete="off" />
              </label>
              <label className={kit.field}>
                {t("play_last_name")}
                <input name="lastName" required className={kit.input} autoComplete="off" />
              </label>
              <label className={kit.field}>
                {t("play_email")}
                <input type="email" name="email" required className={kit.input} autoComplete="off" />
              </label>
              <label className={kit.field}>
                {t("play_phone_optional")}
                <input name="phone" className={kit.input} autoComplete="off" />
              </label>
              <OfflinePaymentMethodField />
              <SubmitButton className={kit.btn} loadingText={t("play_adding")}>
                {t("play_add_btn")}
              </SubmitButton>
            </form>
          </FormPanel>

          {roster.length === 0 ? (
            <EmptyState>{t("play_roster_empty")}</EmptyState>
          ) : (
            <div className={kit.tableWrap}>
              <table className={kit.table}>
                <caption className={kit.srOnly}>{t("play_caption_roster", { date: selectedDate })}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("play_col_player")}</th>
                    <th scope="col">{t("play_col_type")}</th>
                    <th scope="col">{t("play_col_payment")}</th>
                    <th scope="col">
                      <span className={kit.srOnly}>{t("play_col_actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((p, i) => {
                    // Exactly one of these is set on any roster entry, and
                    // it's what a stand-in hangs off — see getRosterForDate.
                    const target = p.membershipId !== null ? { membershipId: p.membershipId } : { bookingId: p.bookingId! };
                    return (
                      <tr key={`${p.email}-${i}`}>
                        <td data-label={t("play_col_player")}>
                          <div>
                            <span className={p.fillIn ? kit.strike : undefined}>{p.name}</span>
                            <span className={kit.sub}>
                              {p.email}
                              {p.phone ? ` · ${p.phone}` : ""}
                            </span>
                            {p.fillIn && (
                              <span className={kit.sub} style={{ color: "#1a2a4a", marginTop: 4 }}>
                                {t("play_standin")} <strong>{p.fillIn.name}</strong> ({p.fillIn.email}
                                {p.fillIn.phone ? ` · ${p.fillIn.phone}` : ""})
                              </span>
                            )}
                          </div>
                        </td>
                        <td data-label={t("play_col_type")}>
                          <div>
                            {t(PLAN_KEY[p.type])}
                            {p.type !== "casual" && p.periodStart ? (
                              <span className={kit.sub}>
                                {t("play_since", { date: dayLabel(p.periodStart) })} · {p.autoRenews ? t("play_renews_auto") : p.periodEnd ? t("play_ends", { date: dayLabel(p.periodEnd) }) : ""}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td data-label={t("play_col_payment")}>
                          <div>
                            {t(METHOD_KEY[p.method])}
                            {p.method === "bank_transfer" ? <TransferStatus t={t} status={reconciliation.get(offlineInvoiceIdFromRef(p.paymentRef) ?? "")} /> : null}
                          </div>
                        </td>
                        <td data-label="">
                          <div className={kit.rowActions}>
                            <FillInButton
                              playerName={p.name}
                              existing={p.fillIn}
                              saveAction={saveFillIn.bind(null, selectedDate, target)}
                              removeAction={clearFillIn.bind(null, selectedDate, target)}
                            />
                            {p.bookingId !== null ? (
                              <form action={removePlayer.bind(null, selectedDate, p.bookingId)}>
                                <SubmitButton
                                  className={kit.btnDanger}
                                  loadingText={t("play_removing")}
                                  confirmMessage={t("play_remove_confirm", { name: p.name, date: dayLabel(selectedDate) })}
                                >
                                  {t("play_remove")}
                                </SubmitButton>
                              </form>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "waitlist" && (
        <>
          <Toolbar>
            <p className={kit.muted} style={{ fontSize: 13, margin: 0, flex: "1 1 320px" }}>
              {t("play_waitlist_intro")}
            </p>
            {canNotify && (
              <form action={notifyWaitlistNow.bind(null, selectedDate)}>
                <SubmitButton className={kit.btn} loadingText={t("play_emailing")}>
                  {t(casualSpotsRemaining === 1 ? "play_notify_one" : "play_notify_many", { n: casualSpotsRemaining })}
                </SubmitButton>
              </form>
            )}
          </Toolbar>
          {waitlist.length === 0 ? (
            <EmptyState>{t("play_waitlist_empty")}</EmptyState>
          ) : (
            <div className={kit.tableWrap}>
              <table className={kit.table}>
                <caption className={kit.srOnly}>{t("play_caption_waitlist", { date: selectedDate })}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("play_col_person")}</th>
                    <th scope="col">{t("play_col_joined")}</th>
                    <th scope="col">{t("play_col_status")}</th>
                    <th scope="col">
                      <span className={kit.srOnly}>{t("play_col_actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {waitlist.map((w) => (
                    <tr key={w.id}>
                      <td data-label={t("play_col_person")}>
                        <div>
                          {w.name}
                          <span className={kit.sub}>{w.email}</span>
                        </div>
                      </td>
                      <td data-label={t("play_col_joined")}>{dayLabel(new Date(w.createdAt).toLocaleDateString("en-CA", { timeZone: CLUB_TIME_ZONE }))}</td>
                      <td data-label={t("play_col_status")}>{w.notifiedAt ? <Badge tone="good">{t("play_emailed")}</Badge> : <Badge>{t("play_waiting")}</Badge>}</td>
                      <td data-label="">
                        <form action={removeWaitlistEntry.bind(null, selectedDate, w.id)}>
                          <SubmitButton className={kit.btnDanger} loadingText={t("play_removing")} confirmMessage={t("play_wl_remove_confirm", { name: w.name })}>
                            {t("play_remove")}
                          </SubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "attendance" && <AttendanceSection date={selectedDate} roster={roster} />}
    </div>
  );
}
