// Paying for a child's place on a play day (Phase 3b step 5).
//
// The same shape as an adult's casual booking: the guardian's app confirms a
// card payment, and the booking is written when the payment provider says it
// succeeded (app/api/stripe-webhook/route.ts calls `settleJuniorPayment`).
// Nothing is booked unpaid, and a payment that can't become a booking (the day
// filled meanwhile, Juniors was switched off, the guardianship ended) is
// refunded in full at once.
//
// What goes to the payment provider: ids, the date and the GUARDIAN's email
// for the receipt. Never the child's name or year of birth.
import { CASUAL_PRICE_CENTS, CLUB_CURRENCY } from "../constants";
import { payments } from "../payments";
import { bookChild, type BookingDb } from "./bookings";
import { juniorsClubId } from "./module";
import type { Env } from "./switch-rule";

/** `metadata.type` on a payment for a child's place. */
export const JUNIOR_PAYMENT = "junior";

/** A junior's place costs what an adult's casual place costs, until a club sets its own junior price. */
export const JUNIOR_PRICE_MINOR = CASUAL_PRICE_CENTS;

export async function createJuniorPayment(input: { tenantId: number; guardianId: number; guardianEmail: string; childId: number; date: string }) {
  return payments().createPayment({
    amount: JUNIOR_PRICE_MINOR,
    currency: CLUB_CURRENCY,
    metadata: {
      type: JUNIOR_PAYMENT,
      tenantId: String(input.tenantId),
      guardianId: String(input.guardianId),
      childId: String(input.childId),
      sessionDate: input.date,
      email: input.guardianEmail,
    },
    receiptEmail: input.guardianEmail,
    description: `Junior session — ${input.date}`,
    idempotencyKey: `junior-${input.tenantId}-${input.childId}-${input.date}-${Date.now()}`,
  });
}

export type PaidJuniorPayment = { id: string; amount: number; currency: string; metadata: Record<string, string> | null | undefined };

export type JuniorSettlement =
  /** The place is booked and paid. */
  | { outcome: "booked" | "already" }
  /** No booking could be made, so the money went back (or the refund failed and a person must act). */
  | { outcome: "refunded" | "refund_failed"; why: "full" | "not_found" | "module_off" | "bad_payment" | "duplicate"; sessionDate: string; guardianEmail: string; error?: string };

const positiveInt = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * A payment for a child's place succeeded: book the place, or give the money
 * back. Safe to call twice for the same payment (providers deliver events at
 * least once): the second call finds the booking and changes nothing.
 */
export async function settleJuniorPayment(db: BookingDb, pi: PaidJuniorPayment, env: Env = process.env): Promise<JuniorSettlement> {
  const m = pi.metadata ?? {};
  const tenantId = positiveInt(m.tenantId);
  const guardianId = positiveInt(m.guardianId);
  const childId = positiveInt(m.childId);
  const sessionDate = /^\d{4}-\d{2}-\d{2}$/.test(m.sessionDate ?? "") ? m.sessionDate : "";
  const guardianEmail = m.email ?? "";

  let why: "full" | "not_found" | "module_off" | "bad_payment" | "duplicate" | null = null;
  if (!tenantId || !guardianId || !childId || !sessionDate) why = "bad_payment";
  else {
    // Fail closed: Juniors must still be on for this club when the money arrives.
    const slug = (await db.query(`SELECT slug FROM tenants WHERE id = $1`, [tenantId])).rows[0]?.slug;
    if (typeof slug !== "string" || (await juniorsClubId(db, slug, env)) !== tenantId) why = "module_off";
    else {
      const r = await bookChild(db, tenantId, guardianId, childId, sessionDate, { paymentIntentId: pi.id, amountMinor: pi.amount, currency: pi.currency.toUpperCase() });
      if (r.outcome === "booked") return { outcome: "booked" };
      if (r.outcome === "already") {
        // This payment's own booking (a repeated event), or a second payment for a place already held.
        const held = (await db.query(`SELECT payment_intent_id FROM junior_bookings WHERE tenant_id = $1 AND id = $2`, [tenantId, r.booking.id])).rows[0]?.payment_intent_id;
        if (held === pi.id) return { outcome: "already" };
        why = "duplicate";
      } else why = r.outcome;
    }
  }

  try {
    await payments().refund({ paymentId: pi.id, idempotencyKey: `refund-junior-${pi.id}` });
    return { outcome: "refunded", why, sessionDate, guardianEmail };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[juniors] automatic refund failed for payment ${pi.id} (${why}):`, error);
    return { outcome: "refund_failed", why, sessionDate, guardianEmail, error };
  }
}
