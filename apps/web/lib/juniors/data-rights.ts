// A guardian's rights over their child's information (Phase 3b step 7):
// see all of it in one export, and delete it.
//
// EXPORT: everything the club holds about the child, as one object. Only
// the child's guardian can ask. The medical note is decrypted into the
// export (it is the guardian's own words); nothing in it is logged.
//
// DELETE: any one confirmed guardian can delete the child's information.
// - Removed outright: the medical note, emergency contacts, and signatures on
//   the club's forms for this child.
// - The profile is emptied (no name, no year of birth) and marked deleted;
//   every guardianship is ended and its consent choices cleared. The child
//   no longer appears anywhere and can't be booked.
// - Kept, with nothing that names the child: past bookings and attendance
//   marks (a date, a status, an amount). The club needs them for its counts
//   of places and for its money records; they point at the emptied profile.
// - Refused while the child still holds a place on a coming play day: cancel
//   it first, so nobody turns up to a place that was silently released and a
//   paid place is never dropped without the club refunding it.
//
// A deletion can't be undone.
import type { TokenVault } from "@luvallplay/integrations";
import type { BookingDb } from "./bookings.ts";
import { getChild, type Db } from "./family.ts";
import { medicalNotesAvailable } from "./care.ts";

type Env = Record<string, string | undefined>;

export const DELETED_CHILD_NAME = "(deleted)";

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
  | "has_bookings";
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

export type DeletedChild = { removed: { medicalNotes: number; emergencyContacts: number; signatures: number }; kept: { bookings: number; attendance: number } };

/**
 * Delete a child's information, for good. `today` is the club's own date:
 * a place held on or after it must be cancelled first.
 */
export async function deleteChild(db: BookingDb, tenantId: number, guardianId: number, childId: number, input: { confirm: boolean; today: string }): Promise<RightsResult<DeletedChild>> {
  if (input?.confirm !== true) return no("confirm_required");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // This guardian's own child, locked so two requests can't both run.
    const mine = await client.query(
      `SELECT j.id FROM junior_profiles j JOIN guardianships g ON g.junior_profile_id = j.id AND g.tenant_id = j.tenant_id
       WHERE j.tenant_id = $1 AND j.id = $2 AND j.deleted_at IS NULL AND g.guardian_user_id = $3 AND g.consent_at IS NOT NULL AND g.ended_at IS NULL
       FOR UPDATE OF j`,
      [tenantId, childId, guardianId],
    );
    if (!mine.rows[0]) {
      await client.query("ROLLBACK");
      return no("not_found");
    }
    const held = await client.query(
      `SELECT 1 FROM junior_bookings WHERE tenant_id = $1 AND junior_profile_id = $2 AND status IN ('pending', 'confirmed') AND session_date >= $3::date LIMIT 1`,
      [tenantId, childId, input.today],
    );
    if (held.rows[0]) {
      await client.query("ROLLBACK");
      return no("has_bookings");
    }
    const gone = async (table: string) => (await client.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND junior_profile_id = $2 RETURNING 1`, [tenantId, childId])).rows.length;
    const removed = { medicalNotes: await gone("junior_medical_notes"), emergencyContacts: await gone("junior_emergency_contacts"), signatures: await gone("form_signatures") };
    await client.query(`UPDATE guardianships SET ended_at = now(), consent_scope = '{}'::jsonb WHERE tenant_id = $1 AND junior_profile_id = $2 AND ended_at IS NULL`, [tenantId, childId]);
    await client.query(`UPDATE guardianships SET consent_scope = '{}'::jsonb WHERE tenant_id = $1 AND junior_profile_id = $2`, [tenantId, childId]);
    await client.query(`UPDATE junior_profiles SET name = $3, birth_year = NULL, deleted_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, childId, DELETED_CHILD_NAME]);
    const count = async (table: string) => Number((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 AND junior_profile_id = $2`, [tenantId, childId])).rows[0].n);
    const kept = { bookings: await count("junior_bookings"), attendance: await count("junior_attendance") };
    await client.query("COMMIT");
    return { ok: true, value: { removed, kept } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
