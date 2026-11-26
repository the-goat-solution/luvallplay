// A child's booking on a play day (build plan §6.8; Phase 3b step 5).
//
// A child's booking lives in junior_bookings, not in the adults' bookings
// table (runbook §1), and takes a place on the play day through the SAME
// guard as an adult's casual booking: lib/db.ts → claimSessionSpot.
//
// - Only a guardian of the child, in the child's club, can book or cancel
//   (the database also refuses anyone else: junior_bookings' foreign key to
//   guardianships).
// - The booking row goes in first and the place is claimed only when that
//   row is new, in one transaction: a full day rolls the row back, and a
//   repeat (a double tap, a replayed payment event) changes nothing.
// - One live booking per child per play day.
// - Cancelling gives the place back in the same transaction.
//
// Whether the play day can be booked at all (inside the booking window, not
// paused, not locked) is the caller's question, asked with the same
// functions an adult's booking uses. Paying is the caller's too: a paid
// booking is written here once the payment exists, with its id.
//
// Callers check that Juniors is on for the club first (lib/juniors/module.ts).
// Rosters, headcount emails and stats read the adults' tables and don't name
// a child; the junior roster (step 6) is the only place that does.
import { claimSessionSpot, releaseSessionSpot } from "../db.ts";

type Result = { rows: Record<string, unknown>[]; rowCount?: number | null };
type Client = { query: (text: string, params?: unknown[]) => Promise<Result>; release: () => void };
/** The app's database (lib/database.ts `sql`): transactions through connect(), single reads through query(). */
export type BookingDb = { query: (text: string, params?: unknown[]) => Promise<Result>; connect: () => Promise<Client> };

export type ChildBooking = {
  id: number;
  childId: number;
  date: string;
  status: "pending" | "confirmed" | "cancelled" | "refunded";
  amountMinor: number | null;
  currency: string | null;
  bookedAt: string;
};

export type BookChildResult =
  /** The place is theirs. */
  | { outcome: "booked"; booking: ChildBooking }
  /** This child already has a live booking that day (or this payment already booked): nothing was changed. */
  | { outcome: "already"; booking: ChildBooking }
  /** No place left: nothing was changed. */
  | { outcome: "full" }
  /** Not this guardian's child, not in this club, or the play day doesn't exist. */
  | { outcome: "not_found" };

/** What was paid, when the club charges for a junior's session. Minor units with their currency. */
export type ChildPayment = { paymentIntentId: string; amountMinor: number; currency: string };

const COLUMNS = `id, junior_profile_id, session_date::text AS session_date, status, amount_minor, currency, created_at`;

function toBooking(r: Record<string, unknown>): ChildBooking {
  return {
    id: Number(r.id),
    childId: Number(r.junior_profile_id),
    date: String(r.session_date),
    status: r.status as ChildBooking["status"],
    amountMinor: r.amount_minor === null || r.amount_minor === undefined ? null : Number(r.amount_minor),
    currency: (r.currency as string | null) ?? null,
    bookedAt: new Date(r.created_at as string).toISOString(),
  };
}

/** The child's live booking that day, if any. */
async function liveBooking(db: { query: BookingDb["query"] }, tenantId: number, childId: number, date: string): Promise<ChildBooking | null> {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM junior_bookings
     WHERE tenant_id = $1 AND junior_profile_id = $2 AND session_date = $3 AND status IN ('pending', 'confirmed')`,
    [tenantId, childId, date],
  );
  return rows[0] ? toBooking(rows[0]) : null;
}

/**
 * Book a place for a child. `payment` is null when nothing is charged (a
 * free-play club, or a session the club doesn't charge juniors for).
 */
export async function bookChild(db: BookingDb, tenantId: number, guardianId: number, childId: number, date: string, payment: ChildPayment | null = null): Promise<BookChildResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // The row is written only for a live child with this guardian (confirmed, not ended), in this club,
    // on a play day that exists there. A repeat hits the one-live-booking index or the payment's own key.
    const inserted = await client.query(
      `INSERT INTO junior_bookings (tenant_id, junior_profile_id, session_date, booked_by_user_id, payment_intent_id, amount_minor, currency, status)
       SELECT j.tenant_id, j.id, s.date, g.guardian_user_id, $5, $6, $7, 'confirmed'
       FROM junior_profiles j
       JOIN guardianships g ON g.tenant_id = j.tenant_id AND g.junior_profile_id = j.id
       JOIN players p ON p.id = g.guardian_user_id
       JOIN sessions s ON s.tenant_id = j.tenant_id AND s.date = $4
       WHERE j.tenant_id = $1 AND j.id = $3 AND j.deleted_at IS NULL
         AND g.guardian_user_id = $2 AND g.consent_at IS NOT NULL AND g.ended_at IS NULL AND p.deleted_at IS NULL
       ON CONFLICT DO NOTHING
       RETURNING ${COLUMNS}`,
      [tenantId, guardianId, childId, date, payment?.paymentIntentId ?? null, payment?.amountMinor ?? null, payment?.currency ?? null],
    );
    if (!inserted.rows[0]) {
      await client.query("ROLLBACK");
      // Nothing written: either they already have their place, or this isn't theirs to book. Asked on the
      // connection already held: taking a second one from the pool here could leave many bookings at the
      // same moment each waiting for a connection another one holds.
      const existing = (await isGuardianRow(client, tenantId, guardianId, childId)) ? await liveBooking(client, tenantId, childId, date) : null;
      return existing ? { outcome: "already", booking: existing } : { outcome: "not_found" };
    }
    if (!(await claimSessionSpot(client, date))) {
      // Full: the booking row written above goes with the rollback.
      await client.query("ROLLBACK");
      return { outcome: "full" };
    }
    await client.query("COMMIT");
    return { outcome: "booked", booking: toBooking(inserted.rows[0]) };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function isGuardianRow(db: { query: BookingDb["query"] }, tenantId: number, guardianId: number, childId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM guardianships g JOIN junior_profiles j ON j.id = g.junior_profile_id AND j.tenant_id = g.tenant_id
     WHERE g.tenant_id = $1 AND g.guardian_user_id = $2 AND g.junior_profile_id = $3
       AND g.consent_at IS NOT NULL AND g.ended_at IS NULL AND j.deleted_at IS NULL`,
    [tenantId, guardianId, childId],
  );
  return rows.length > 0;
}

export type CancelChildResult =
  /** Cancelled, and the place is free again. */
  | { outcome: "cancelled"; booking: ChildBooking }
  /** It was already cancelled or refunded: nothing was changed. */
  | { outcome: "already"; booking: ChildBooking }
  | { outcome: "not_found" };

/**
 * Cancel a child's booking. Any current guardian of the child can, not only
 * the one who booked. The place is given back in the same transaction.
 * Refunding a payment is the caller's (the payments interface).
 */
export async function cancelChildBooking(db: BookingDb, tenantId: number, guardianId: number, bookingId: number): Promise<CancelChildResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT b.id, b.junior_profile_id, b.session_date::text AS session_date, b.status, b.amount_minor, b.currency, b.created_at
       FROM junior_bookings b
       JOIN guardianships g ON g.tenant_id = b.tenant_id AND g.junior_profile_id = b.junior_profile_id
       JOIN junior_profiles j ON j.id = b.junior_profile_id AND j.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1 AND b.id = $3 AND j.deleted_at IS NULL
         AND g.guardian_user_id = $2 AND g.consent_at IS NOT NULL AND g.ended_at IS NULL
       FOR UPDATE OF b`,
      [tenantId, guardianId, bookingId],
    );
    if (!found.rows[0]) {
      await client.query("ROLLBACK");
      return { outcome: "not_found" };
    }
    const before = toBooking(found.rows[0]);
    if (before.status !== "pending" && before.status !== "confirmed") {
      await client.query("ROLLBACK");
      return { outcome: "already", booking: before };
    }
    const updated = await client.query(
      `UPDATE junior_bookings SET status = 'cancelled', cancelled_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
      [tenantId, bookingId],
    );
    await releaseSessionSpot(client, before.date);
    await client.query("COMMIT");
    return { outcome: "cancelled", booking: toBooking(updated.rows[0]) };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** This guardian's children's bookings in this club from `fromDate` on, soonest first. Never another guardian's children. */
export async function listChildBookings(db: { query: BookingDb["query"] }, tenantId: number, guardianId: number, fromDate: string): Promise<ChildBooking[]> {
  const { rows } = await db.query(
    `SELECT b.id, b.junior_profile_id, b.session_date::text AS session_date, b.status, b.amount_minor, b.currency, b.created_at
     FROM junior_bookings b
     JOIN guardianships g ON g.tenant_id = b.tenant_id AND g.junior_profile_id = b.junior_profile_id
     JOIN junior_profiles j ON j.id = b.junior_profile_id AND j.tenant_id = b.tenant_id
     WHERE b.tenant_id = $1 AND g.guardian_user_id = $2 AND g.consent_at IS NOT NULL AND g.ended_at IS NULL
       AND j.deleted_at IS NULL AND b.session_date >= $3 AND b.status IN ('pending', 'confirmed')
     ORDER BY b.session_date, b.id`,
    [tenantId, guardianId, fromDate],
  );
  return rows.map(toBooking);
}

/** How many children hold a place on each of these play days (a count, never names): for the play-day page's "+2 juniors". */
export async function juniorCounts(db: { query: BookingDb["query"] }, tenantId: number, dates: readonly string[]): Promise<Record<string, number>> {
  if (dates.length === 0) return {};
  const { rows } = await db.query(
    `SELECT session_date::text AS d, count(*)::int AS n FROM junior_bookings
     WHERE tenant_id = $1 AND session_date = ANY($2::date[]) AND status IN ('pending', 'confirmed') GROUP BY 1`,
    [tenantId, dates],
  );
  return Object.fromEntries(rows.map((r) => [String(r.d), Number(r.n)]));
}
