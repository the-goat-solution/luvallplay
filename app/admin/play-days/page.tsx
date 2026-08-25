import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  ensureTables,
  getAvailableSpots,
  getCourtsForDate,
  getRosterForDate,
  listAllSessionDates,
  removeBooking,
  reserveBookingSlot,
  setCourtsForDate,
} from "@/lib/db";
import { formatDateLong, getDayName, toDateKey } from "@/lib/dates";
import { AdminNav } from "@/components/admin/AdminNav";
import { PlayDaysToastBridge } from "@/components/admin/PlayDaysToastBridge";
import { CASUAL_PRICE_CENTS, maxPlayersForCourts } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";

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

async function addCashPlayer(date: string, formData: FormData) {
  "use server";

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!firstName || !lastName || !email) {
    redirect(`/admin/play-days?date=${date}&cashError=${encodeURIComponent("Name and email are required")}`);
  }

  await ensureTables();

  const spots = await getAvailableSpots(date);
  if (spots <= 0) {
    redirect(`/admin/play-days?date=${date}&cashError=${encodeURIComponent("Session is full")}`);
  }

  let invoiceId: string;
  try {
    const stripe = getStripe();

    const customers = await stripe.customers.list({ email, limit: 1 });
    const customer =
      customers.data[0] ??
      (await stripe.customers.create({
        email,
        name: `${firstName} ${lastName}`,
        phone: phone || undefined,
      }));

    await stripe.invoiceItems.create({
      customer: customer.id,
      amount: CASUAL_PRICE_CENTS,
      currency: "nzd",
      description: `Casual session — cash — ${date}`,
    });

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: 1,
      auto_advance: false,
      pending_invoice_items_behavior: "include",
      metadata: {
        type: "casual",
        sessionDate: date,
        firstName,
        lastName,
        email,
        phone,
        source: "cash",
      },
    });

    if (!invoice.id) throw new Error("Failed to create invoice");
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.pay(finalized.id!, { paid_out_of_band: true });
    invoiceId = finalized.id!;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to record cash payment";
    redirect(`/admin/play-days?date=${date}&cashError=${encodeURIComponent(message)}`);
  }

  const ok = await reserveBookingSlot(date, {
    firstName,
    lastName,
    email,
    phone: phone || undefined,
    paymentIntentId: `cash-invoice-${invoiceId}`,
  });

  if (!ok) {
    redirect(
      `/admin/play-days?date=${date}&cashError=${encodeURIComponent(
        "Cash payment recorded in Stripe, but the session filled up before the slot could be reserved — check Stripe invoice " +
          invoiceId,
      )}`,
    );
  }

  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&cashAdded=1`);
}

async function removePlayer(date: string, bookingId: number) {
  "use server";
  await removeBooking(bookingId, date);
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
  const result = await setCourtsForDate(date, courts);
  if (!result.ok) {
    redirect(`/admin/play-days?date=${date}&courtsError=${encodeURIComponent(result.reason)}`);
  }

  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&courtsUpdated=${courts}`);
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
  }>;
}) {
  const { date: dateParam } = await searchParams;

  const sessionKeys = process.env.POSTGRES_URL
    ? await (async () => {
        await ensureTables();
        return listAllSessionDates();
      })()
    : [];

  const todayKey = toDateKey(new Date());
  const defaultDate =
    sessionKeys.find((key) => key >= todayKey) ?? sessionKeys[sessionKeys.length - 1];
  const selectedDate =
    dateParam && sessionKeys.includes(dateParam) ? dateParam : defaultDate;

  let roster: Awaited<ReturnType<typeof getRosterForDate>> = [];
  let casualSpotsRemaining: number | null = null;
  let courts = 2;
  if (process.env.POSTGRES_URL && selectedDate) {
    roster = await getRosterForDate(selectedDate);
    casualSpotsRemaining = await getAvailableSpots(selectedDate);
    courts = await getCourtsForDate(selectedDate);
  }
  const maxPlayers = maxPlayersForCourts(courts);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "40px auto", padding: "0 20px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Play day roster</h1>
      <p style={{ color: "#666", marginBottom: 20 }}>
        Casual bookings and members whose subscription period covers the selected play day.
      </p>
      <AdminNav active="play-days" />
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
            <button
              type="submit"
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #1a2a4a",
                background: "#1a2a4a",
                color: "#fff",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              View
            </button>
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
              (max {maxPlayers} players at {courts} court{courts === 1 ? "" : "s"})
            </span>
            <button
              type="submit"
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #1a2a4a",
                background: "#1a2a4a",
                color: "#fff",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Confirm
            </button>
          </form>

          <p style={{ fontWeight: 600, marginBottom: 4 }}>
            {roster.length} player{roster.length === 1 ? "" : "s"} signed up for {selectedDate}
          </p>
          {casualSpotsRemaining !== null && (
            <p style={{ color: "#666", fontSize: 13, marginBottom: 8 }}>
              {casualSpotsRemaining} casual spot{casualSpotsRemaining === 1 ? "" : "s"} remaining
              (session capacity {maxPlayers} minus active members — see{" "}
              <a href="/admin/members">Members</a>)
            </p>
          )}
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
                roster.map((p, i) => (
                  <tr key={`${p.email}-${i}`} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "6px 8px" }}>{p.name}</td>
                    <td style={{ padding: "6px 8px" }}>{p.email}</td>
                    <td style={{ padding: "6px 8px" }}>{p.phone ?? ""}</td>
                    <td style={{ padding: "6px 8px" }}>{PLAN_LABEL[p.type]}</td>
                    <td style={{ padding: "6px 8px" }}>{p.method === "cash" ? "Cash" : "Card"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {p.bookingId !== null ? (
                        <form action={removePlayer.bind(null, selectedDate, p.bookingId)}>
                          <button
                            type="submit"
                            style={{
                              padding: "4px 8px",
                              borderRadius: 6,
                              border: "1px solid #a12622",
                              background: "#fff",
                              color: "#a12622",
                              fontSize: 12,
                              cursor: "pointer",
                            }}
                          >
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <h2 style={{ fontSize: 16, marginTop: 32, marginBottom: 8 }}>Add cash player</h2>
          <p style={{ color: "#666", fontSize: 13, marginBottom: 12 }}>
            Records a $10 invoice in Stripe marked as paid out-of-band (cash), then adds the player to
            this play day&apos;s roster.
          </p>
          <form
            action={addCashPlayer.bind(null, selectedDate)}
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
            <button
              type="submit"
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #1a2a4a",
                background: "#1a2a4a",
                color: "#fff",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Add cash player
            </button>
          </form>
        </>
      )}
    </div>
  );
}
