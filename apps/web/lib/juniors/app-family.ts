// The players' app's Family section (/api/v1/app/clubs/{club}/family…):
// lib/juniors/family.ts in the contract's shape (packages/api, "family.*").
//
// Every handler asks `requireJuniors` first. The wrapper already answers 404
// when the module is off, but its switch reads fail open by design; Juniors
// fails closed (lib/juniors/module.ts), so the question is asked again here.
import type { FamilyBookingResponse, FamilyBookingsResponse, FamilyChildResponse, FamilyPayResponse, FamilyResponse } from "@luvallplay/api/schemas";
import { AppApiError, fail } from "../app-api";
import type { ClubConfig } from "../club-config";
import { clockOf } from "../club-public";
import { sql } from "../database";
import { addDays, getAvailableSpots, getSpotsAndHeadcountForDates, isRegistrationLocked, listSessionsInRange } from "../db";
import { isSessionDatePaused } from "../day-requests";
import { assertSessionBookable } from "../security";
import { notifyWaitlistIfSpotOpened } from "../waitlist-notify";
import { bookChild, cancelChildBooking, listChildBookings, type ChildBooking } from "./bookings";
import { JUNIOR_PRICE_MINOR, createJuniorPayment } from "./payments";
import { CLUB_CURRENCY } from "../constants";
import { getClubToday } from "../dates";
import type { Player } from "../player-db";
import {
  CHILD_NAME_MAX,
  CONSENT_VERSION,
  MAX_CHILDREN_PER_GUARDIAN,
  addChild,
  isGuardianOf,
  juniorBirthYears,
  listChildren,
  setConsent,
  updateChild,
  type AddChildInput,
  type Child,
  type ConsentItem,
  type FamilyError,
  type FamilyResult,
} from "./family";
import { juniorsClubId } from "./module";

const STATUS: Record<FamilyError, number> = {
  name_required: 400,
  name_invalid: 400,
  birth_year: 400,
  consent_required: 400,
  duplicate: 409,
  too_many: 409,
  not_found: 404,
};

/** The club's id and its calendar year, or the 404 a switched-off module gives. */
export async function requireJuniors(club: ClubConfig): Promise<{ tenantId: number; year: number } | AppApiError> {
  // The club's id comes from the same read as the switch (the app's own settings may not carry it).
  const tenantId = await juniorsClubId(sql, club.slug);
  if (tenantId === null) return fail(404, "module_off");
  const year = Number(getClubToday(new Date(), clockOf(club)).dateKey.slice(0, 4));
  return { tenantId, year };
}

const answer = (r: FamilyResult<Child>): FamilyChildResponse | AppApiError => (r.ok ? { child: r.value } : fail(STATUS[r.code], r.code));

export async function familyList(player: Player, club: ClubConfig): Promise<FamilyResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const years = juniorBirthYears(ctx.year);
  return {
    children: await listChildren(sql, ctx.tenantId, player.id),
    limits: { maxChildren: MAX_CHILDREN_PER_GUARDIAN, birthYearMin: years.min, birthYearMax: years.max, nameMax: CHILD_NAME_MAX },
    consentVersion: CONSENT_VERSION,
  };
}

export async function familyAdd(player: Player, club: ClubConfig, body: AddChildInput): Promise<FamilyChildResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  return answer(await addChild(sql, ctx.tenantId, player.id, body, { year: ctx.year }));
}

export async function familyUpdate(player: Player, club: ClubConfig, childId: number, body: { name?: string; birthYear?: number }): Promise<FamilyChildResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  return answer(await updateChild(sql, ctx.tenantId, player.id, childId, body, { year: ctx.year }));
}

export async function familyConsent(player: Player, club: ClubConfig, childId: number, body: Partial<Record<ConsentItem, boolean>>): Promise<FamilyChildResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  return answer(await setConsent(sql, ctx.tenantId, player.id, childId, body));
}

// ── Booking a place for a child (step 5) ────────────────────────────────────

const shown = (b: ChildBooking) => ({ id: b.id, childId: b.childId, date: b.date, status: b.status, amountMinor: b.amountMinor, currency: b.currency });

/** Whether the club charges for a junior's place. A free-play club never does. (Paying arrives with the payments piece.) */
async function paymentFor(tenantId: number): Promise<"none" | "card"> {
  const { rows } = await sql.query(`SELECT payment_mode FROM tenants WHERE id = $1`, [tenantId]);
  return rows[0]?.payment_mode === "free" ? "none" : "card";
}

/** The next 30 days' play days with their places, and this guardian's children's bookings. */
export async function familyBookings(player: Player, club: ClubConfig): Promise<FamilyBookingsResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const today = getClubToday(new Date(), clockOf(club)).dateKey;
  const bookings = (await listChildBookings(sql, ctx.tenantId, player.id, today)).map(shown);
  const held = new Set(bookings.map((b) => b.date));
  // Only days a place can be booked on: not paused, not closed. A day one of
  // this guardian's children is already booked on stays, so it can be cancelled.
  const all = await listSessionsInRange(today, addDays(today, 30));
  const open = await Promise.all(all.map(async (s) => held.has(s.date) || !((await isSessionDatePaused(s.date)) || (await isRegistrationLocked(s.date)))));
  const sessions = all.filter((_, i) => open[i]);
  const { spots } = await getSpotsAndHeadcountForDates(sessions.map((s) => s.date));
  const payment = await paymentFor(ctx.tenantId);
  return {
    days: sessions.map((s) => ({ date: s.date, start: s.eventStartTime, end: s.eventEndTime, location: s.eventLocation, spotsLeft: spots[s.date] ?? 0 })),
    bookings,
    payment,
    priceMinor: payment === "card" ? JUNIOR_PRICE_MINOR : null,
    currency: payment === "card" ? CLUB_CURRENCY : null,
  };
}

/** Why a place can't be booked on this day right now, by the rules an adult's casual booking follows; null when it can. */
async function dayRefusal(date: string): Promise<AppApiError | null> {
  try {
    await assertSessionBookable(date);
  } catch {
    return fail(409, "not_bookable");
  }
  if (await isSessionDatePaused(date)) return fail(409, "day_paused");
  if (await isRegistrationLocked(date)) return fail(409, "locked");
  return null;
}

/** A club that charges: a card payment for the guardian's app to confirm. The place is booked when the payment succeeds (lib/juniors/payments.ts). */
export async function familyPay(player: Player, club: ClubConfig, childId: number, date: string): Promise<FamilyPayResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const closed = await dayRefusal(date);
  if (closed) return closed;
  if ((await paymentFor(ctx.tenantId)) !== "card") return fail(409, "no_payment_needed");
  // Checked before any money moves: this guardian's child, not already booked, a place left.
  if (!(await isGuardianOf(sql, ctx.tenantId, player.id, childId))) return fail(404, "not_found");
  const today = getClubToday(new Date(), clockOf(club)).dateKey;
  if ((await listChildBookings(sql, ctx.tenantId, player.id, today)).some((b) => b.childId === childId && b.date === date)) return fail(409, "already_booked");
  if ((await getAvailableSpots(date)) <= 0) return fail(409, "full");
  const payment = await createJuniorPayment({ tenantId: ctx.tenantId, guardianId: player.id, guardianEmail: player.email, childId, date });
  if (!payment.clientSecret) return fail(500, "failed");
  return { clientSecret: payment.clientSecret, amountMinor: payment.amount, currency: payment.currency };
}

/** Book a place for a child, by the same rules an adult's casual booking follows for the day itself. */
export async function familyBook(player: Player, club: ClubConfig, childId: number, date: string): Promise<FamilyBookingResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const closed = await dayRefusal(date);
  if (closed) return closed;
  // A club that charges: nothing is booked without the payment (family.pay).
  if ((await paymentFor(ctx.tenantId)) !== "none") return fail(409, "payment_needed");
  if ((await getAvailableSpots(date)) <= 0) return fail(409, "full");
  const r = await bookChild(sql, ctx.tenantId, player.id, childId, date);
  if (r.outcome === "not_found") return fail(404, "not_found");
  if (r.outcome === "full") return fail(409, "full");
  return { booking: shown(r.booking) };
}

/** Cancel a child's booking; the place it frees is offered to the waitlist like any other. */
export async function familyCancelBooking(player: Player, club: ClubConfig, bookingId: number): Promise<FamilyBookingResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  // A paid place isn't cancelled here yet: cancelling would free the place and keep the money. The club refunds it.
  const today = getClubToday(new Date(), clockOf(club)).dateKey;
  if ((await listChildBookings(sql, ctx.tenantId, player.id, today)).some((b) => b.id === bookingId && (b.amountMinor ?? 0) > 0)) return fail(409, "paid_booking");
  const r = await cancelChildBooking(sql, ctx.tenantId, player.id, bookingId);
  if (r.outcome === "not_found") return fail(404, "not_found");
  if (r.outcome === "cancelled") {
    try {
      await notifyWaitlistIfSpotOpened(r.booking.date);
    } catch (err) {
      console.error("[juniors] waitlist notice after a cancelled junior booking failed:", err);
    }
  }
  return { booking: shown(r.booking) };
}
