// A guardian's rights over their child's information (Phase 3b step 7):
// see all of it in one export, and have it deleted.
//
// EXPORT: everything the club holds about the child, as one object. Only
// the child's guardian can ask. The medical note is decrypted into the
// export (it is the guardian's own words); nothing in it is logged.
//
// DELETE is two steps (the owner's decision, runbook §3 questions 11 and 12):
// 1. A guardian ASKS (any one confirmed guardian). Nothing is removed yet;
//    the request waits for the club and the guardian can withdraw it.
// 2. An OWNER or ADMIN of the club CONFIRMS. Then, in one transaction,
//    everything about the child is deleted for good: the medical note,
//    emergency contacts, signatures on forms, attendance marks, bookings,
//    every guardianship with its consent choices, and the profile itself.
//
// What survives, and why:
// - The request's own row, no longer pointing at a child: that a request was
//   made, by which account, who confirmed it and when.
// - For each PAID booking, one row in junior_payment_records: the payment's
//   id, the amount and the club. No child, no guardian, no play day. The
//   payment code needs it so that a payment event arriving again is neither
//   booked nor refunded a second time (lib/juniors/payments.ts).
// - The play day's own count of places taken (a number on the day).
// Nothing else. A deletion can't be undone.
//
// Asking and confirming are both refused while the child still holds a place
// on a coming play day: cancel it first, so a paid place is never dropped
// without the club refunding it.
import type { Access } from "@luvallplay/auth";
import type { TokenVault } from "@luvallplay/integrations";
import type { BookingDb } from "./bookings.ts";
import { getChild, type Db } from "./family.ts";
import { medicalNotesAvailable } from "./care.ts";

type Env = Record<string, string | undefined>;

export type ChildExport = {
  exportedAt: string;
  child: { name: string; birthYear: number | null; addedAt: string };
  /** What this guardian allows for the child, and when they confirmed being the guardian. */
  consent: { leaderboard: boolean; photos: boolean; vision: boolean; confirmedAt: string | null; version: string | null };
  guardians: number;
  bookings: { date: string; status: string; amountMinor: number | null; currency: string | null; bookedAt: string }[];
  attendance: { date: string; recordedAt: string }[];
  emergencyContacts: { position: number; name: string; phone: string; relationship: string | null }[];
  /** null: no note. `unavailable`: there is a note but this deployment can't decrypt it right now. */
  medicalNotes: { notes: string } | { unavailable: true } | null;
  forms: { title: string; kind: string; version: number; signedName: string; signedAt: string }[];
};

export type RightsError =
  /** Not this child's guardian (or no such child in this club). */
  | "not_found"
  /** The confirmation wasn't given. */
  | "confirm_required"
  /** The child still holds a place on a coming play day: cancel it first. */
  | "has_bookings"
  /** Only an owner or admin of the club confirms a deletion. */
  | "forbidden";
export type RightsResult<T> = { ok: true; value: T } | { ok: false; code: RightsError };
const no = <T>(code: RightsError): RightsResult<T> => ({ ok: false, code });
const iso = (v: unknown) => new Date(v as string).toISOString();

/** Everything the club holds about the child, for their guardian. */
export async function exportChild(db: Db, vault: TokenVault, tenantId: number, guardianId: number, childId: number, opts: { now?: Date; env?: Env } = {}): Promise<RightsResult<ChildExport>> {
  const child = await getChild(db, tenantId, guardianId, childId);
  if (!child) return no("not_found");
  const q = (text: string) => db.query(text, [tenantId, childId]).then((r) => r.rows);
  const bookings = await q(`SELECT session_date::text AS date, status, amount_minor, currency, created_at FROM junior_bookings WHERE tenant_id = $1 AND junior_profile_id = $2 ORDER BY session_date, id`);
  const attendance = await q(`SELECT session_date::text AS date, recorded_at FROM junior_attendance WHERE tenant_id = $1 AND junior_profile_id = $2 AND removed = false ORDER BY session_date`);
  const contacts = await q(`SELECT position, name, phone, relationship FROM junior_emergency_contacts WHERE tenant_id = $1 AND junior_profile_id = $2 ORDER BY position`);
  const forms = await q(
    `SELECT f.title, f.kind, f.version, s.signed_name, s.signed_at FROM form_signatures s JOIN club_forms f ON f.tenant_id = s.tenant_id AND f.id = s.form_id
     WHERE s.tenant_id = $1 AND s.junior_profile_id = $2 ORDER BY s.signed_at, s.id`,
  );
  const note = (await q(`SELECT sealed FROM junior_medical_notes WHERE tenant_id = $1 AND junior_profile_id = $2`))[0];
  let medicalNotes: ChildExport["medicalNotes"] = null;
  if (note) {
    medicalNotes = medicalNotesAvailable(opts.env ?? process.env)
      ? { notes: await vault.open({ tenantId, connector: "juniors.medical", connectionId: `child:${childId}` }, String(note.sealed)) }
      : { unavailable: true };
  }
  return {
    ok: true,
    value: {
      exportedAt: (opts.now ?? new Date()).toISOString(),
      child: { name: child.name, birthYear: child.birthYear, addedAt: child.addedAt },
      consent: { ...child.consent, confirmedAt: child.consentAt, version: child.consentVersion },
      guardians: child.guardians,
      bookings: bookings.map((b) => ({ date: String(b.date), status: String(b.status), amountMinor: b.amount_minor == null ? null : Number(b.amount_minor), currency: b.currency == null ? null : String(b.currency), bookedAt: iso(b.created_at) })),
      attendance: attendance.map((a) => ({ date: String(a.date), recordedAt: iso(a.recorded_at) })),
      emergencyContacts: contacts.map((c) => ({ position: Number(c.position), name: String(c.name), phone: String(c.phone), relationship: c.relationship == null ? null : String(c.relationship) })),
      medicalNotes,
      forms: forms.map((f) => ({ title: String(f.title), kind: String(f.kind), version: Number(f.version), signedName: String(f.signed_name), signedAt: iso(f.signed_at) })),
    },
  };
}

export type DeletionRequest = { id: number; childId: number; requestedAt: string };

const heldPlace = `SELECT 1 FROM junior_bookings WHERE tenant_id = $1 AND junior_profile_id = $2 AND status IN ('pending', 'confirmed') AND session_date >= $3::date LIMIT 1`;

/** The child's request that is waiting for the club, if any. */
export async function pendingDeletionRequest(db: Db, tenantId: number, childId: number): Promise<DeletionRequest | null> {
  const r = (await db.query(`SELECT id, junior_profile_id, requested_at FROM junior_deletion_requests WHERE tenant_id = $1 AND junior_profile_id = $2 AND status = 'pending'`, [tenantId, childId])).rows[0];
  return r ? { id: Number(r.id), childId: Number(r.junior_profile_id), requestedAt: iso(r.requested_at) } : null;
}

/**
 * A guardian asks the club to delete their child's information. Nothing is
 * removed. Asking again while a request waits returns that request.
 * `today` is the club's own date.
 */
export async function requestChildDeletion(db: Db, tenantId: number, guardianId: number, childId: number, input: { confirm: boolean; today: string }): Promise<RightsResult<DeletionRequest & { created: boolean }>> {
  if (input?.confirm !== true) return no("confirm_required");
  if (!(await getChild(db, tenantId, guardianId, childId))) return no("not_found");
  if ((await db.query(heldPlace, [tenantId, childId, input.today])).rows[0]) return no("has_bookings");
  const made = (
    await db.query(
      `INSERT INTO junior_deletion_requests (tenant_id, junior_profile_id, requested_by_user_id) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, junior_profile_id) WHERE status = 'pending' DO NOTHING RETURNING id`,
      [tenantId, childId, guardianId],
    )
  ).rows[0];
  const pending = await pendingDeletionRequest(db, tenantId, childId);
  return pending ? { ok: true, value: { ...pending, created: Boolean(made) } } : no("not_found");
}

/** A guardian withdraws the request before the club has confirmed it. */
export async function cancelChildDeletion(db: Db, tenantId: number, guardianId: number, childId: number): Promise<RightsResult<{ cancelled: boolean }>> {
  if (!(await getChild(db, tenantId, guardianId, childId))) return no("not_found");
  const { rows } = await db.query(
    `UPDATE junior_deletion_requests SET status = 'cancelled', decided_by_user_id = $3, decided_at = now()
     WHERE tenant_id = $1 AND junior_profile_id = $2 AND status = 'pending' RETURNING id`,
    [tenantId, childId, guardianId],
  );
  return { ok: true, value: { cancelled: rows.length > 0 } };
}

/** May this person confirm a deletion? Owners and admins of the club. */
export function mayConfirmDeletion(access: Access): boolean {
  return access.role === "owner" || access.role === "admin";
}

export type PendingDeletion = { id: number; childId: number; childName: string; guardianName: string; requestedAt: string };

/** The requests waiting for the club, oldest first. For the club's owners and admins. */
export async function listDeletionRequests(db: Db, tenantId: number, access: Access): Promise<RightsResult<PendingDeletion[]>> {
  if (!mayConfirmDeletion(access)) return no("forbidden");
  const { rows } = await db.query(
    `SELECT r.id, j.id AS child_id, j.name, p.first_name, p.last_name, r.requested_at
     FROM junior_deletion_requests r JOIN junior_profiles j ON j.id = r.junior_profile_id AND j.tenant_id = r.tenant_id JOIN players p ON p.id = r.requested_by_user_id
     WHERE r.tenant_id = $1 AND r.status = 'pending' ORDER BY r.requested_at, r.id`,
    [tenantId],
  );
  return {
    ok: true,
    value: rows.map((r) => ({ id: Number(r.id), childId: Number(r.child_id), childName: String(r.name), guardianName: `${String(r.first_name ?? "")} ${String(r.last_name ?? "")}`.trim(), requestedAt: iso(r.requested_at) })),
  };
}

export type ConfirmedDeletion = {
  requestId: number;
  /** The guardian who asked: to tell them it is done. */
  requestedByUserId: number;
  removed: { medicalNotes: number; emergencyContacts: number; signatures: number; attendance: number; bookings: number; guardianships: number };
  /** Paid bookings kept only as anonymous payment records. */
  paymentRecords: number;
};

/**
 * An owner or admin confirms: everything about the child is deleted for good,
 * in one transaction. The caller asks for a fresh sign-in code first and
 * writes the audit row (the request's id only: no child data survives).
 */
export async function confirmChildDeletion(db: BookingDb, tenantId: number, actor: { playerId: number; access: Access }, requestId: number, today: string): Promise<RightsResult<ConfirmedDeletion>> {
  if (!mayConfirmDeletion(actor.access)) return no("forbidden");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const req = (
      await client.query(`SELECT id, junior_profile_id, requested_by_user_id FROM junior_deletion_requests WHERE tenant_id = $1 AND id = $2 AND status = 'pending' FOR UPDATE`, [tenantId, requestId])
    ).rows[0];
    if (!req) {
      await client.query("ROLLBACK");
      return no("not_found");
    }
    const childId = Number(req.junior_profile_id);
    await client.query(`SELECT id FROM junior_profiles WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, childId]);
    if ((await client.query(heldPlace, [tenantId, childId, today])).rows[0]) {
      await client.query("ROLLBACK");
      return no("has_bookings");
    }
    // What the payment code needs, without the child: one row per payment.
    const paymentRecords = (
      await client.query(
        `INSERT INTO junior_payment_records (tenant_id, payment_intent_id, amount_minor, currency)
         SELECT tenant_id, payment_intent_id, COALESCE(amount_minor, 0), COALESCE(currency, '') FROM junior_bookings
         WHERE tenant_id = $1 AND junior_profile_id = $2 AND payment_intent_id IS NOT NULL
         ON CONFLICT (tenant_id, payment_intent_id) DO NOTHING RETURNING 1`,
        [tenantId, childId],
      )
    ).rows.length;
    const gone = async (table: string) => (await client.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND junior_profile_id = $2 RETURNING 1`, [tenantId, childId])).rows.length;
    const removed = {
      medicalNotes: await gone("junior_medical_notes"),
      emergencyContacts: await gone("junior_emergency_contacts"),
      signatures: await gone("form_signatures"),
      attendance: await gone("junior_attendance"),
      bookings: await gone("junior_bookings"),
      guardianships: await gone("guardianships"),
    };
    // Every request about this child stops pointing at them: the confirmed one, and any cancelled earlier.
    await client.query(`UPDATE junior_deletion_requests SET junior_profile_id = NULL WHERE tenant_id = $1 AND junior_profile_id = $2 AND status = 'cancelled'`, [tenantId, childId]);
    await client.query(`UPDATE junior_deletion_requests SET status = 'confirmed', junior_profile_id = NULL, decided_by_user_id = $3, decided_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, requestId, actor.playerId]);
    await client.query(`DELETE FROM junior_profiles WHERE tenant_id = $1 AND id = $2`, [tenantId, childId]);
    await client.query("COMMIT");
    return { ok: true, value: { requestId, requestedByUserId: Number(req.requested_by_user_id), removed, paymentRecords } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
