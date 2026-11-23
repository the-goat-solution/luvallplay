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
  PAYMENT_METHOD_LABEL,
} from "@/lib/offline-payment";
import { reconcileOfflinePayment, recordOfflinePayment } from "@/lib/offline-payment-stripe";
import { getOfflinePaymentReconciliation, type OfflineReconciliation } from "@/lib/bank-db";
import { OfflinePaymentMethodField } from "@/components/admin/OfflinePaymentMethodField";

export const dynamic = "force-dynamic";

const PLAN_LABEL = {
  casual: "Casual",
  monthly: "Monthly member",
  quarterly: "Quarterly member",
} as const;

// Adds a player who paid outside the online checkout — cash at the
// session or a bank transfer to the club account. The payment is recorded
// in Stripe as a $10 invoice paid out of band, then added to the finance
// ledger; a bank transfer is matched to its bank statement line straight
// away if it's already in, otherwise automatically when it arrives.
async function addOfflinePlayer(date: string, formData: FormData) {
  "use server";

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const method = parseOfflineMethod(formData.get("method"));

  if (!firstName || !lastName || !email) {
    redirect(`/admin/play-days?date=${date}&cashError=${encodeURIComponent("Name and email are required")}`);
  }

  // Admin adds go through even when registration is locked — the lock only
  // closes public sign-ups.
  const spots = await getAvailableSpots(date, { ignoreLock: true });
  if (spots <= 0) {
    redirect(`/admin/play-days?date=${date}&cashError=${encodeURIComponent("Session is full")}`);
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
    const message = e instanceof Error ? e.message : "Failed to record the payment";
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
        "Payment recorded in Stripe, but the session filled up before the slot could be reserved — check Stripe invoice " +
          recorded.invoiceId,
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
  const courts = Number(formData.get("courts"));

  if (![1, 2, 3, 4].includes(courts)) {
    redirect(
      `/admin/play-days?date=${date}&courtsError=${encodeURIComponent("Choose a valid number of courts")}`,
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

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  const fail = (message: string) =>
    redirect(
      `/admin/play-days?date=${date}&fillInError=${encodeURIComponent(message)}`,
    );

  if (!firstName || !lastName || !email) {
    fail("A stand-in needs a first name, last name and email");
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
      fail(
        `${entry.name} is already on this roster with that email — one person can't take two spots.`,
      );
    }
    if (entry.fillIn && entry.fillIn.email.toLowerCase() === emailKey) {
      fail(
        `That email is already standing in for ${entry.name} on this date.`,
      );
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
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-NZ", { timeZone: "UTC", ...opts });
}

function TransferStatus({ status }: { status: OfflineReconciliation | undefined }) {
  return status?.reconciled ? (
    <span className={kit.sub} style={{ color: "#1a7a3c" }}>
      ✓ Matched to the bank{status.bankDate ? ` (${dayLabel(status.bankDate)})` : ""}
    </span>
  ) : (
    <span className={kit.sub} style={{ color: "#8a4b00" }}>
      Waiting for the bank transfer
    </span>
  );
}

// The mini-game cap is the club's setting, so the text is built per request.
const modeHelp = (miniGameMax: number): Record<SignupMode, string> => ({
  open: "Anyone can sign up while there are spots. Members are always in.",
  closed: "No new casual sign-ups or memberships start on this day, even with spots left. Everyone already in keeps their place, and you can still add players.",
  mini: `Mini game: members are in automatically (they tap "Can't make it" if they can't come). Casual sign-ups are closed and the day is capped at ${miniGameMax} players. You can still add players.`,
});

export default async function PlayDaysAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string }>;
}) {
  const { date: dateParam, tab: tabParam } = await searchParams;
  const tab: Tab = tabParam === "waitlist" || tabParam === "attendance" ? tabParam : "roster";
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const sessionKeys = hasDb ? await listAllSessionDates() : [];

  const { dateKey: todayKey } = getClubToday();
  const defaultDate = sessionKeys.find((key) => key >= todayKey) ?? sessionKeys[sessionKeys.length - 1];
  const selectedDate = dateParam && sessionKeys.includes(dateParam) ? dateParam : defaultDate;

  const header = (
    <PageHeader
      title="Play days"
      subtitle="One play day at a time: who's coming, who can sign up, the waitlist and who played."
      actions={
        selectedDate ? (
          <PlayDayPicker
            options={sessionKeys.map((key) => ({
              key,
              label: `${dayLabel(key, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}${key === todayKey ? " (today)" : key < todayKey ? " (past)" : ""}`,
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
        <EmptyState>{hasDb ? "No play days yet. They appear here once they're in the club calendar." : "Database is not configured."}</EmptyState>
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
    { mode: "open", label: "Open" },
    { mode: "closed", label: "Closed", confirm: "Close sign-ups for this play day? Everyone already in keeps their place." },
    {
      mode: "mini",
      label: "Mini game",
      confirm: `Make this a mini game day? Casual sign-ups close and the day is capped at ${miniGameMax} players. Members stay included.`,
    },
  ];

  return (
    <div className={adminStyles.page}>
      {header}

      <Section title={dayLabel(selectedDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} id="day">
        {when && <p className={kit.muted} style={{ marginTop: -6, fontSize: 14 }}>{when}</p>}
        <StatGrid>
          <StatTile label="Signed up" value={roster.length} hint={`of ${maxPlayers} places`} />
          <StatTile label="Casual spots left" value={casualSpotsRemaining} tone={casualSpotsRemaining <= 0 ? "warn" : undefined} hint={mode === "open" ? "open to sign-ups" : "not open to the public"} />
          <StatTile label="Waitlist" value={waitlist.length} tone={canNotify ? "warn" : undefined} hint={canNotify ? "spots are free" : waiting ? `${waiting} not emailed yet` : "people waiting"} />
          <StatTile label="Courts" value={courts} hint={miniGame ? `mini game: ${miniGameMax} max` : `up to ${maxPlayers} players`} />
        </StatGrid>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 28px", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 320px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Sign-ups</div>
            <div className={kit.segmented} role="group" aria-label="Sign-ups">
              {modeButtons.map((b) =>
                mode === b.mode ? (
                  <span key={b.mode} className={`${kit.segment} ${kit.segmentOn}`} aria-current="true">
                    {b.label}
                  </span>
                ) : (
                  <form key={b.mode} action={setSignupMode.bind(null, selectedDate, b.mode)}>
                    <SubmitButton className={kit.segment} loadingText="Saving…" confirmMessage={b.confirm}>
                      {b.label}
                    </SubmitButton>
                  </form>
                ),
              )}
            </div>
            <p className={kit.muted} style={{ fontSize: 13, margin: "8px 0 0", maxWidth: 560 }}>
              {modeHelp(miniGameMax)[mode]}
            </p>
          </div>
          <form action={updateCourts.bind(null, selectedDate)} style={{ flex: "0 0 auto" }}>
            <label htmlFor="courts" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Courts booked
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <select id="courts" name="courts" defaultValue={courts} className={kit.select}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} court{n === 1 ? "" : "s"} · up to {sessionCapacityFor(cfg, n)}
                  </option>
                ))}
              </select>
              <SubmitButton className={kit.btn} loadingText="Saving…">
                Save
              </SubmitButton>
            </div>
          </form>
        </div>
      </Section>

      <InfoDisclosure summary="How spots are counted">
        <p>
          Places = the courts&apos; capacity ({sessionCapacityFor(cfg, courts)} at {courts} court{courts === 1 ? "" : "s"}), or {miniGameMax} on a mini game day.
          Members whose membership covers this day take their places first; casual sign-ups get what&apos;s left.
        </p>
        <p>Auto-renewing members count for play days after their current billing period too: their membership renews before the play day.</p>
        <p>Only Friday and Wednesday play days have members. Play days on other days start with 1 court, casual sign-ups only.</p>
      </InfoDisclosure>

      <Tabs
        label="Play day"
        current={tab}
        items={[
          { key: "roster", label: "Roster", href: tabHref("roster"), count: roster.length },
          { key: "waitlist", label: "Waitlist", href: tabHref("waitlist"), count: waitlist.length },
          { key: "attendance", label: "Attendance", href: tabHref("attendance") },
        ]}
      />

      {tab === "roster" && (
        <>
          <FormPanel summary="＋ Add a player" title="Add a player who paid cash or by bank transfer" id="add">
            <p className={kit.muted} style={{ fontSize: 13, margin: 0 }}>
              Records the ${CASUAL_PRICE_CENTS / 100} payment and adds them to this play day, even when sign-ups are closed. A bank transfer is matched on the{" "}
              <AdminLink href="/admin/financials/bank">Bank</AdminLink> page as soon as it shows up.
            </p>
            <form action={addOfflinePlayer.bind(null, selectedDate)} className={kit.formGrid}>
              <label className={kit.field}>
                First name
                <input name="firstName" required className={kit.input} autoComplete="off" />
              </label>
              <label className={kit.field}>
                Last name
                <input name="lastName" required className={kit.input} autoComplete="off" />
              </label>
              <label className={kit.field}>
                Email
                <input type="email" name="email" required className={kit.input} autoComplete="off" />
              </label>
              <label className={kit.field}>
                Phone (optional)
                <input name="phone" className={kit.input} autoComplete="off" />
              </label>
              <OfflinePaymentMethodField />
              <SubmitButton className={kit.btn} loadingText="Adding…">
                Add player
              </SubmitButton>
            </form>
          </FormPanel>

          {roster.length === 0 ? (
            <EmptyState>Nobody has signed up for this play day yet.</EmptyState>
          ) : (
            <div className={kit.tableWrap}>
              <table className={kit.table}>
                <caption className={kit.srOnly}>Players on {selectedDate}</caption>
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Type</th>
                    <th scope="col">Payment</th>
                    <th scope="col">
                      <span className={kit.srOnly}>Actions</span>
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
                        <td data-label="Player">
                          <div>
                            <span className={p.fillIn ? kit.strike : undefined}>{p.name}</span>
                            <span className={kit.sub}>
                              {p.email}
                              {p.phone ? ` · ${p.phone}` : ""}
                            </span>
                            {p.fillIn && (
                              <span className={kit.sub} style={{ color: "#1a2a4a", marginTop: 4 }}>
                                ↳ Stand-in: <strong>{p.fillIn.name}</strong> ({p.fillIn.email}
                                {p.fillIn.phone ? ` · ${p.fillIn.phone}` : ""})
                              </span>
                            )}
                          </div>
                        </td>
                        <td data-label="Type">
                          <div>
                            {PLAN_LABEL[p.type]}
                            {p.type !== "casual" && p.periodStart ? (
                              <span className={kit.sub}>
                                since {dayLabel(p.periodStart)} · {p.autoRenews ? "renews automatically" : p.periodEnd ? `ends ${dayLabel(p.periodEnd)}` : ""}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td data-label="Payment">
                          <div>
                            {PAYMENT_METHOD_LABEL[p.method]}
                            {p.method === "bank_transfer" ? <TransferStatus status={reconciliation.get(offlineInvoiceIdFromRef(p.paymentRef) ?? "")} /> : null}
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
                                  loadingText="Removing…"
                                  confirmMessage={`Remove ${p.name} from ${dayLabel(selectedDate)}? Their spot is offered to the waitlist. (No refund is made here.)`}
                                >
                                  Remove
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
              People waiting for a spot on this play day. They&apos;re emailed automatically when a spot opens (a player is removed, courts are added or
              sign-ups reopen).
            </p>
            {canNotify && (
              <form action={notifyWaitlistNow.bind(null, selectedDate)}>
                <SubmitButton className={kit.btn} loadingText="Emailing…">
                  Email the waitlist now ({casualSpotsRemaining} spot{casualSpotsRemaining === 1 ? "" : "s"} free)
                </SubmitButton>
              </form>
            )}
          </Toolbar>
          {waitlist.length === 0 ? (
            <EmptyState>Nobody is on the waitlist for this play day.</EmptyState>
          ) : (
            <div className={kit.tableWrap}>
              <table className={kit.table}>
                <caption className={kit.srOnly}>Waitlist for {selectedDate}</caption>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Joined</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className={kit.srOnly}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {waitlist.map((w) => (
                    <tr key={w.id}>
                      <td data-label="Person">
                        <div>
                          {w.name}
                          <span className={kit.sub}>{w.email}</span>
                        </div>
                      </td>
                      <td data-label="Joined">{dayLabel(new Date(w.createdAt).toLocaleDateString("en-CA", { timeZone: CLUB_TIME_ZONE }))}</td>
                      <td data-label="Status">{w.notifiedAt ? <Badge tone="good">Emailed</Badge> : <Badge>Waiting</Badge>}</td>
                      <td data-label="">
                        <form action={removeWaitlistEntry.bind(null, selectedDate, w.id)}>
                          <SubmitButton className={kit.btnDanger} loadingText="Removing…" confirmMessage={`Take ${w.name} off the waitlist?`}>
                            Remove
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
