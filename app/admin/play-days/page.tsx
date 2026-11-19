import { redirect } from "next/navigation";
import { AdminLink } from "@/components/admin/AdminLink";
import { revalidatePath } from "next/cache";
import {
  deleteWaitlistEntry,
  ensureTables,
  getAvailableSpots,
  getCourtsForDate,
  getRosterForDate,
  getWaitlistForDate,
  isMiniGameDay,
  isRegistrationLocked,
  listAllSessionDates,
  listSessionsInRange,
  removeBooking,
  removeSessionFillIn,
  reserveBookingSlot,
  saveSessionFillIn,
  setCourtsForDate,
  setMiniGameDay,
  setRegistrationLocked,
  type FillInTarget,
} from "@/lib/db";
import { notifyWaitlistIfSpotOpened } from "@/lib/waitlist-notify";
import { sendFillInConfirmationEmail } from "@/lib/email";
import {
  formatDateLong,
  formatEventTimeRange,
  getClubToday,
  getDayName,
} from "@/lib/dates";
import { AdminNav } from "@/components/admin/AdminNav";
import { AttendanceSection } from "@/components/admin/AttendanceSection";
import { AdminToastBridge } from "@/components/admin/AdminToastBridge";
import adminStyles from "@/components/admin/admin.module.css";
import { FillInButton } from "@/components/admin/FillInButton";
import { PlayDaysToastBridge } from "@/components/admin/PlayDaysToastBridge";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { PlainSubmitButton } from "@/components/admin/PlainSubmitButton";
import {
  CASUAL_PRICE_CENTS,
  MINI_GAME_MAX_PLAYERS,
  maxPlayersForCourts,
  sessionMaxPlayers,
} from "@/lib/constants";
import {
  offlineInvoiceIdFromRef,
  parseOfflineMethod,
  PAYMENT_METHOD_LABEL,
} from "@/lib/offline-payment";
import { reconcileOfflinePayment, recordOfflinePayment } from "@/lib/offline-payment-stripe";
import { getOfflinePaymentReconciliation, type OfflineReconciliation } from "@/lib/bank-db";
import { OfflinePaymentMethodField } from "@/components/admin/OfflinePaymentMethodField";
import { MiniGameToggle } from "@/components/admin/MiniGameToggle";

export const dynamic = "force-dynamic";

const PLAN_LABEL = {
  casual: "Casual",
  monthly: "Monthly member",
  quarterly: "Quarterly member",
} as const;

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

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

  await ensureTables();

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

  await ensureTables();
  const before = await getCourtsForDate(date);
  const result = await setCourtsForDate(date, courts);
  if (!result.ok) {
    redirect(`/admin/play-days?date=${date}&courtsError=${encodeURIComponent(result.reason)}`);
  }

  // Only a capacity increase can free up a spot — no point checking on a
  // decrease (setCourtsForDate already refuses to shrink below signups).
  if (maxPlayersForCourts(courts) > maxPlayersForCourts(before)) {
    await notifyWaitlistIfSpotOpened(date);
  }

  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&courtsUpdated=${courts}`);
}

// Closes (or reopens) public sign-ups for a play day regardless of how many
// spots are left. Existing bookings and members are untouched.
async function setRegistration(date: string, locked: boolean) {
  "use server";
  await ensureTables();
  if (!locked && (await isMiniGameDay(date))) {
    redirect(
      `/admin/play-days?date=${date}&courtsError=${encodeURIComponent(
        "This is a mini game day — turn mini game day off to reopen registration.",
      )}`,
    );
  }
  await setRegistrationLocked(date, locked);
  // Reopening may free spots that were hidden by the lock — let the
  // waitlist know, the same as when courts are added.
  if (!locked) await notifyWaitlistIfSpotOpened(date);
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&registration=${locked ? "locked" : "unlocked"}`);
}

// Mini game day: capacity becomes MINI_GAME_MAX_PLAYERS and registration
// locks (admins still add players). Turning it off restores court-based
// capacity and reopens registration.
async function setMiniGame(date: string, on: boolean) {
  "use server";
  await ensureTables();
  const result = await setMiniGameDay(date, on);
  if (!result.ok) {
    redirect(`/admin/play-days?date=${date}&courtsError=${encodeURIComponent(result.reason)}`);
  }
  if (!on) await notifyWaitlistIfSpotOpened(date);
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&miniGame=${on ? "on" : "off"}`);
}

async function notifyWaitlistNow(date: string) {
  "use server";
  const count = await notifyWaitlistIfSpotOpened(date);
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&waitlistNotified=${count}`);
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
    fail("Fill-in needs a first name, last name and email");
  }

  await ensureTables();

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
        `That email is already filling in for ${entry.name} on this date.`,
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
  await ensureTables();
  await removeSessionFillIn(date, target);
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&fillInRemoved=1`);
}

async function removeWaitlistEntry(date: string, id: number) {
  "use server";
  await deleteWaitlistEntry(id);
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&waitlistRemoved=1`);
}

function TransferStatus({ status }: { status: OfflineReconciliation | undefined }) {
  return status?.reconciled ? (
    <div style={{ fontSize: 12, color: "#1a7a3c" }}>
      ✓ Matched to bank{status.bankDate ? ` (${status.bankDate})` : ""}
    </div>
  ) : (
    <div style={{ fontSize: 12, color: "#8a4b00" }}>Awaiting bank transaction</div>
  );
}

export default async function PlayDaysAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    cashAdded?: string;
    cashError?: string;
    removed?: string;
    courtsUpdated?: string;
    courtsError?: string;
    waitlistNotified?: string;
    waitlistRemoved?: string;
    fillInSaved?: string;
    fillInRemoved?: string;
    fillInError?: string;
    registration?: string;
    miniGame?: string;
  }>;
}) {
  const { date: dateParam } = await searchParams;

  const sessionKeys = process.env.POSTGRES_URL
    ? await (async () => {
        await ensureTables();
        return listAllSessionDates();
      })()
    : [];

  const { dateKey: todayKey } = getClubToday();
  const defaultDate =
    sessionKeys.find((key) => key >= todayKey) ?? sessionKeys[sessionKeys.length - 1];
  const selectedDate =
    dateParam && sessionKeys.includes(dateParam) ? dateParam : defaultDate;

  let roster: Awaited<ReturnType<typeof getRosterForDate>> = [];
  let waitlist: Awaited<ReturnType<typeof getWaitlistForDate>> = [];
  let casualSpotsRemaining: number | null = null;
  let courts = 2;
  let registrationLocked = false;
  let miniGame = false;
  let reconciliation = new Map<string, OfflineReconciliation>();
  if (process.env.POSTGRES_URL && selectedDate) {
    roster = await getRosterForDate(selectedDate);
    waitlist = await getWaitlistForDate(selectedDate);
    // Shown ignoring the lock, so the admin still sees real capacity.
    casualSpotsRemaining = await getAvailableSpots(selectedDate, { ignoreLock: true });
    courts = await getCourtsForDate(selectedDate);
    registrationLocked = await isRegistrationLocked(selectedDate);
    miniGame = await isMiniGameDay(selectedDate);
    // Bank transfers show whether they've been matched to the statement.
    const transferInvoices = roster
      .filter((p) => p.method === "bank_transfer")
      .map((p) => offlineInvoiceIdFromRef(p.paymentRef))
      .filter((id): id is string => Boolean(id));
    try {
      reconciliation = await getOfflinePaymentReconciliation(transferInvoices);
    } catch (err) {
      console.error("Failed to load bank reconciliation for the roster", err);
    }
  }
  const maxPlayers = sessionMaxPlayers(courts, miniGame);

  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Play day roster</h1>
      <p className={adminStyles.subtitle}>
        Casual bookings and members with access to the selected play day. Auto-renewing
        members count for play days past their current billing period too — their
        subscription rolls over before the session, so they keep their spot.
      </p>
      <p className={adminStyles.note}>
        Only Friday and Wednesday play days allow monthly/quarterly members — new sessions on
        other days default to 1 court, casual bookings only.
      </p>
      <AdminNav active="play-days" />
      <AdminToastBridge />
      <PlayDaysToastBridge />

      {!process.env.POSTGRES_URL ? (
        <p>Database is not configured.</p>
      ) : sessionKeys.length === 0 ? (
        <p>No sessions synced from the calendar yet.</p>
      ) : (
        <>
          <form style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
            <label htmlFor="date" style={{ fontSize: 13, color: "#666" }}>
              Play day:
            </label>
            <select
              id="date"
              name="date"
              defaultValue={selectedDate}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
            >
              {sessionKeys.map((key) => {
                const date = parseDateKey(key);
                const suffix = key < todayKey ? " (past)" : key === todayKey ? " (today)" : "";
                return (
                  <option key={key} value={key}>
                    {getDayName(date, "en")}, {formatDateLong(date, "en")}
                    {suffix}
                  </option>
                );
              })}
            </select>
            <PlainSubmitButton
              loadingText="Loading…"
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #1a2a4a",
                background: "#1a2a4a",
                color: "#fff",
                fontSize: 13,
              }}
            >
              View
            </PlainSubmitButton>
          </form>

          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Courts booked</h2>
          <form
            action={updateCourts.bind(null, selectedDate)}
            style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}
          >
            <label htmlFor="courts" style={{ fontSize: 13, color: "#666" }}>
              Courts:
            </label>
            <select
              id="courts"
              name="courts"
              defaultValue={courts}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: "#666" }}>
              {miniGame
                ? `(mini game day — max ${MINI_GAME_MAX_PLAYERS} players whatever the courts)`
                : `(max ${maxPlayers} players at ${courts} court${courts === 1 ? "" : "s"})`}
            </span>
            <SubmitButton
              loadingText="Saving…"
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #1a2a4a",
                background: "#1a2a4a",
                color: "#fff",
                fontSize: 13,
              }}
            >
              Confirm
            </SubmitButton>
          </form>

          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Mini game day</h2>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              padding: "10px 12px",
              marginBottom: 24,
              borderRadius: 8,
              border: `1px solid ${miniGame ? "#c9b8e8" : "#ddd"}`,
              background: miniGame ? "#f5f0fd" : "#fafafa",
            }}
          >
            <div style={{ fontSize: 13 }}>
              <strong style={{ color: miniGame ? "#5a2ea6" : "#333" }}>
                {miniGame ? "🏸 On" : "Off"}
              </strong>
              <span style={{ color: "#666" }}>
                {miniGame
                  ? ` — registration is locked and the day is capped at ${MINI_GAME_MAX_PLAYERS} players. Add players below.`
                  : ` — turn on to lock registration and cap this play day at ${MINI_GAME_MAX_PLAYERS} players.`}
              </span>
            </div>
            <form action={setMiniGame.bind(null, selectedDate, !miniGame)}>
              <MiniGameToggle on={miniGame} />
            </form>
          </div>

          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Registration</h2>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              padding: "10px 12px",
              marginBottom: 24,
              borderRadius: 8,
              border: `1px solid ${registrationLocked ? "#e0b4b2" : "#cfe3d4"}`,
              background: registrationLocked ? "#fdf1f0" : "#f1f8f3",
            }}
          >
            <div style={{ fontSize: 13 }}>
              <strong style={{ color: registrationLocked ? "#a12622" : "#1e6b3a" }}>
                {registrationLocked ? "🔒 Locked" : "Open"}
              </strong>
              <span style={{ color: "#666" }}>
                {registrationLocked
                  ? miniGame
                    ? " — locked for the mini game day. Turn mini game day off to reopen. You can still add offline payment players below."
                    : " — no new casual bookings or memberships can start on this play day, even with spots left. Existing players keep their places, and you can still add offline payment players below."
                  : ` — players can sign up while spots remain (${casualSpotsRemaining ?? 0} left).`}
              </span>
            </div>
            {!(miniGame && registrationLocked) && (
            <form action={setRegistration.bind(null, selectedDate, !registrationLocked)}>
              <SubmitButton
                loadingText={registrationLocked ? "Unlocking…" : "Locking…"}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: `1px solid ${registrationLocked ? "#1a2a4a" : "#a12622"}`,
                  background: registrationLocked ? "#1a2a4a" : "#a12622",
                  color: "#fff",
                  fontSize: 13,
                  whiteSpace: "nowrap",
                }}
              >
                {registrationLocked ? "Unlock registration" : "Lock registration"}
              </SubmitButton>
            </form>
            )}
          </div>

          <p style={{ fontWeight: 600, marginBottom: 4 }}>
            {roster.length} player{roster.length === 1 ? "" : "s"} signed up for {selectedDate}
          </p>
          {casualSpotsRemaining !== null && (
            <p style={{ color: "#666", fontSize: 13, marginBottom: 8 }}>
              {casualSpotsRemaining} casual spot{casualSpotsRemaining === 1 ? "" : "s"} remaining
              (session capacity {maxPlayers}{miniGame ? " for the mini game day" : ""} minus active members — see{" "}
              <AdminLink href="/admin/members">Members</AdminLink>)
            </p>
          )}
          <div className={adminStyles.tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "6px 8px" }}>Name</th>
                  <th style={{ padding: "6px 8px" }}>Email</th>
                  <th style={{ padding: "6px 8px" }}>Phone</th>
                  <th style={{ padding: "6px 8px" }}>Type</th>
                  <th style={{ padding: "6px 8px" }}>Payment</th>
                  <th style={{ padding: "6px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {roster.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "10px 8px", color: "#888" }}>
                      No signups yet.
                    </td>
                  </tr>
                ) : (
                  roster.flatMap((p, i) => {
                    // Exactly one of these is set on any roster entry, and
                    // it's what a fill-in hangs off — see getRosterForDate.
                    const target =
                      p.membershipId !== null
                        ? { membershipId: p.membershipId }
                        : { bookingId: p.bookingId! };
                    // A replaced player keeps their row — they paid for the
                    // spot — but is struck through, with their stand-in shown
                    // directly underneath.
                    const struck = p.fillIn
                      ? { textDecoration: "line-through" as const, color: "#999" }
                      : undefined;
                    return [
                      <tr
                        key={`${p.email}-${i}`}
                        style={{
                          borderBottom: p.fillIn ? "none" : "1px solid #eee",
                        }}
                      >
                        <td style={{ padding: "6px 8px", ...struck }}>{p.name}</td>
                        <td style={{ padding: "6px 8px", ...struck }}>{p.email}</td>
                        <td style={{ padding: "6px 8px", ...struck }}>{p.phone ?? ""}</td>
                        <td style={{ padding: "6px 8px", ...struck }}>
                          {PLAN_LABEL[p.type]}
                          {p.type !== "casual" && p.periodStart ? (
                            <div style={{ fontSize: 12, color: "#666" }}>
                              {p.periodStart} →{" "}
                              {p.autoRenews ? "auto-renews" : (p.periodEnd ?? "")}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: "6px 8px", ...struck }}>
                          {PAYMENT_METHOD_LABEL[p.method]}
                          {p.method === "bank_transfer" ? (
                            <TransferStatus
                              status={reconciliation.get(offlineInvoiceIdFromRef(p.paymentRef) ?? "")}
                            />
                          ) : null}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <FillInButton
                              playerName={p.name}
                              existing={p.fillIn}
                              saveAction={saveFillIn.bind(null, selectedDate, target)}
                              removeAction={clearFillIn.bind(null, selectedDate, target)}
                            />
                            {p.bookingId !== null ? (
                              <form action={removePlayer.bind(null, selectedDate, p.bookingId)}>
                                <SubmitButton
                                  loadingText="Removing…"
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: 6,
                                    border: "1px solid #a12622",
                                    background: "#fff",
                                    color: "#a12622",
                                    fontSize: 12,
                                  }}
                                >
                                  Remove
                                </SubmitButton>
                              </form>
                            ) : null}
                          </div>
                        </td>
                      </tr>,
                      ...(p.fillIn
                        ? [
                            <tr
                              key={`${p.email}-${i}-fill-in`}
                              style={{ borderBottom: "1px solid #eee" }}
                            >
                              <td style={{ padding: "2px 8px 6px" }}>
                                ↳ {p.fillIn.name}
                              </td>
                              <td style={{ padding: "2px 8px 6px" }}>
                                {p.fillIn.email}
                              </td>
                              <td style={{ padding: "2px 8px 6px" }}>
                                {p.fillIn.phone ?? ""}
                              </td>
                              <td
                                colSpan={3}
                                style={{ padding: "2px 8px 6px", color: "#666", fontSize: 13 }}
                              >
                                Filling in for {p.name}
                              </td>
                            </tr>,
                          ]
                        : []),
                    ];
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 32, marginBottom: 8 }}>
            <h2 style={{ fontSize: 16 }}>
              Waitlist ({waitlist.length})
            </h2>
            {!registrationLocked && casualSpotsRemaining !== null && casualSpotsRemaining > 0 && waitlist.length > 0 && (
              <form action={notifyWaitlistNow.bind(null, selectedDate)}>
                <SubmitButton
                  loadingText="Notifying…"
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid #1a2a4a",
                    background: "#1a2a4a",
                    color: "#fff",
                    fontSize: 12,
                  }}
                >
                  Notify waitlist now ({casualSpotsRemaining} spot{casualSpotsRemaining === 1 ? "" : "s"} open)
                </SubmitButton>
              </form>
            )}
          </div>
          <p style={{ color: "#666", fontSize: 13, marginBottom: 8 }}>
            Anyone who joined the waitlist for this play day. They&apos;re emailed automatically when a
            booking is removed or courts are added and a spot opens up.
          </p>
          <div className={adminStyles.tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 8 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "6px 8px" }}>Name</th>
                  <th style={{ padding: "6px 8px" }}>Email</th>
                  <th style={{ padding: "6px 8px" }}>Joined</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                  <th style={{ padding: "6px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {waitlist.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: "10px 8px", color: "#888" }}>
                      Nobody on the waitlist for this date.
                    </td>
                  </tr>
                ) : (
                  waitlist.map((w) => (
                    <tr key={w.id} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "6px 8px" }}>{w.name}</td>
                      <td style={{ padding: "6px 8px" }}>{w.email}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {new Date(w.createdAt).toLocaleDateString("en-NZ")}
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        {w.notifiedAt ? "Notified" : "Waiting"}
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        <form action={removeWaitlistEntry.bind(null, selectedDate, w.id)}>
                          <SubmitButton
                            loadingText="Removing…"
                            style={{
                              padding: "4px 8px",
                              borderRadius: 6,
                              border: "1px solid #a12622",
                              background: "#fff",
                              color: "#a12622",
                              fontSize: 12,
                            }}
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

          <h2 style={{ fontSize: 16, marginTop: 32, marginBottom: 8 }}>Add offline payment player</h2>
          <p style={{ color: "#666", fontSize: 13, marginBottom: 12 }}>
            For a player who paid in cash or by bank transfer. Records a $10 invoice in Stripe marked
            as paid out-of-band, then adds the player to this play day&apos;s roster. A bank transfer
            is matched to its bank transaction automatically — straight away if it&apos;s already in
            the bank feed, otherwise as soon as it arrives (see{" "}
            <AdminLink href="/admin/financials/bank">Bank</AdminLink>).
          </p>
          <form
            action={addOfflinePlayer.bind(null, selectedDate)}
            style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}
          >
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#666" }}>First name</label>
              <input
                name="firstName"
                required
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#666" }}>Last name</label>
              <input
                name="lastName"
                required
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#666" }}>Email</label>
              <input
                type="email"
                name="email"
                required
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#666" }}>Phone (optional)</label>
              <input
                name="phone"
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
              />
            </div>
            <OfflinePaymentMethodField />
            <SubmitButton
              loadingText="Adding…"
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #1a2a4a",
                background: "#1a2a4a",
                color: "#fff",
                fontSize: 13,
              }}
            >
              Add player
            </SubmitButton>
          </form>
          <AttendanceSection date={selectedDate} roster={roster} />
        </>
      )}
    </div>
  );
}
