// The junior roster (Phase 3b step 6): which children are booked on a play
// day, who their guardians are, who to call, and marking who came.
//
// Who sees it: a person with a role in the club AND a safety check that is
// valid today (lib/juniors/safety.ts). No valid check, no roster: not for a
// coach, not for an admin, not for an owner. Luvallplay staff never, by that
// alone.
//
// What it shows: a child's name and year of birth, the guardians' names and
// their own contact details, the emergency contacts the guardian recorded,
// and whether a medical note exists. The note itself is NOT here: it is read
// one child at a time through lib/juniors/care.ts (owners, and coaches with a
// valid check; never admins), and each read is written to the audit log.
import type { Access } from "@luvallplay/auth";
import type { Db } from "./family.ts";
import { mayReadMedicalNotesToday, mayWorkWithJuniors } from "./safety.ts";

export type RosterActor = { playerId: number; access: Access };
export type RosterError = /** No role in the club, or no safety check that is valid today. */ "forbidden" | "not_found";
export type RosterResult<T> = { ok: true; value: T } | { ok: false; code: RosterError };
const no = <T>(code: RosterError): RosterResult<T> => ({ ok: false, code });

export type RosterChild = {
  childId: number;
  name: string;
  birthYear: number | null;
  /** Paid, or booked free. */
  paid: boolean;
  attended: boolean;
  guardians: { name: string; email: string; phone: string | null }[];
  emergencyContacts: { position: number; name: string; phone: string; relationship: string | null }[];
  hasMedicalNote: boolean;
};
export type Roster = { date: string; children: RosterChild[]; /** Whether this person may open a child's medical note. */ canReadMedicalNotes: boolean };

/** The coming play days that have at least one child booked, soonest first, with how many. */
export async function rosterDays(db: Db, tenantId: number, actor: RosterActor, today: string): Promise<RosterResult<{ date: string; children: number }[]>> {
  if (!(await mayWorkWithJuniors(db, tenantId, actor, today))) return no("forbidden");
  const { rows } = await db.query(
    `SELECT session_date::text AS date, count(*)::int AS n FROM junior_bookings
     WHERE tenant_id = $1 AND session_date >= $2::date AND status IN ('pending', 'confirmed') GROUP BY 1 ORDER BY 1 LIMIT 60`,
    [tenantId, today],
  );
  return { ok: true, value: rows.map((r) => ({ date: String(r.date), children: Number(r.n) })) };
}

/** The children booked on one play day, by name. */
export async function juniorRoster(db: Db, tenantId: number, actor: RosterActor, date: string, today: string): Promise<RosterResult<Roster>> {
  if (!(await mayWorkWithJuniors(db, tenantId, actor, today))) return no("forbidden");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return no("not_found");
  const booked = (
    await db.query(
      `SELECT j.id, j.name, j.birth_year, COALESCE(b.amount_minor, 0) > 0 AS paid,
              EXISTS (SELECT 1 FROM junior_attendance a WHERE a.tenant_id = b.tenant_id AND a.session_date = b.session_date AND a.junior_profile_id = j.id AND a.removed = false) AS attended,
              EXISTS (SELECT 1 FROM junior_medical_notes n WHERE n.tenant_id = b.tenant_id AND n.junior_profile_id = j.id) AS has_note
       FROM junior_bookings b JOIN junior_profiles j ON j.id = b.junior_profile_id AND j.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1 AND b.session_date = $2::date AND b.status IN ('pending', 'confirmed') AND j.deleted_at IS NULL
       ORDER BY lower(j.name), j.id`,
      [tenantId, date],
    )
  ).rows;
  const ids = booked.map((r) => Number(r.id));
  const guardians = ids.length
    ? (
        await db.query(
          `SELECT g.junior_profile_id AS child, p.first_name, p.last_name, p.email, COALESCE(p.phone_e164, p.phone) AS phone
           FROM guardianships g JOIN players p ON p.id = g.guardian_user_id AND p.deleted_at IS NULL
           WHERE g.tenant_id = $1 AND g.junior_profile_id = ANY($2::int[]) AND g.consent_at IS NOT NULL AND g.ended_at IS NULL ORDER BY g.consent_at, g.guardian_user_id`,
          [tenantId, ids],
        )
      ).rows
    : [];
  const contacts = ids.length
    ? (await db.query(`SELECT junior_profile_id AS child, position, name, phone, relationship FROM junior_emergency_contacts WHERE tenant_id = $1 AND junior_profile_id = ANY($2::int[]) ORDER BY position`, [tenantId, ids])).rows
    : [];
  return {
    ok: true,
    value: {
      date,
      canReadMedicalNotes: await mayReadMedicalNotesToday(db, tenantId, actor, today),
      children: booked.map((r) => ({
        childId: Number(r.id),
        name: String(r.name),
        birthYear: r.birth_year == null ? null : Number(r.birth_year),
        paid: r.paid === true,
        attended: r.attended === true,
        hasMedicalNote: r.has_note === true,
        guardians: guardians
          .filter((g) => Number(g.child) === Number(r.id))
          .map((g) => ({ name: `${String(g.first_name ?? "")} ${String(g.last_name ?? "")}`.trim(), email: String(g.email), phone: g.phone == null ? null : String(g.phone) })),
        emergencyContacts: contacts
          .filter((c) => Number(c.child) === Number(r.id))
          .map((c) => ({ position: Number(c.position), name: String(c.name), phone: String(c.phone), relationship: c.relationship == null ? null : String(c.relationship) })),
      })),
    },
  };
}

/** Mark that a booked child came (or undo it). Only for a child booked on that day. */
export async function markJuniorAttendance(db: Db, tenantId: number, actor: RosterActor, input: { date: string; childId: number; attended: boolean }, today: string): Promise<RosterResult<{ attended: boolean }>> {
  if (!(await mayWorkWithJuniors(db, tenantId, actor, today))) return no("forbidden");
  const booked = (
    await db.query(
      `SELECT 1 FROM junior_bookings b JOIN junior_profiles j ON j.id = b.junior_profile_id AND j.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1 AND b.session_date = $2::date AND b.junior_profile_id = $3 AND b.status IN ('pending', 'confirmed') AND j.deleted_at IS NULL`,
      [tenantId, input.date, input.childId],
    )
  ).rows[0];
  if (!booked) return no("not_found");
  const source = actor.access.role === "coach" ? "coach" : "admin";
  await db.query(
    `INSERT INTO junior_attendance (tenant_id, session_date, junior_profile_id, source, removed, recorded_by_user_id) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, session_date, junior_profile_id) DO UPDATE SET removed = EXCLUDED.removed, source = EXCLUDED.source, recorded_at = now(), recorded_by_user_id = EXCLUDED.recorded_by_user_id`,
    [tenantId, input.date, input.childId, source, !input.attended, actor.playerId],
  );
  return { ok: true, value: { attended: input.attended } };
}
