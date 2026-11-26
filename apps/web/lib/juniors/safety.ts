// Safety checks for the people who work with juniors (Phase 3b step 6).
//
// A club's OWNER records that a coach or volunteer has a safety check: its
// kind, the club's own reference, the day it was done and the day it expires.
// Luvallplay records that a check exists; it never holds the check's document
// or result and does not carry out or verify one (the safeguarding policy,
// lib/juniors/safeguarding-policy.ts).
//
// What a check decides:
// - `mayWorkWithJuniors`: an owner, an admin or a coach of the club who has a
//   check that is valid today. No valid check, no junior roster.
// - `mayReadMedicalNotesToday`: an owner (the club's responsible person), or
//   a COACH with a valid check. An admin sees the roster and emergency
//   contacts but not medical notes (runbook §3, question 1). Luvallplay staff
//   never, by that alone.
//
// A check is withdrawn (revoked), never deleted, so what was recorded stays
// on record.
import type { Access } from "@luvallplay/auth";
import type { Db } from "./family.ts";

export const SAFETY_CHECK_KINDS = ["police-vet", "working-with-children", "other"] as const;
export type SafetyCheckKind = (typeof SAFETY_CHECK_KINDS)[number];
export const SAFETY_REFERENCE_MAX = 80;
/** A check is recorded for at most this long; then it must be recorded again. */
export const SAFETY_CHECK_MAX_YEARS = 3;
/** "Expires soon" on the roster and in the admin's attention list. */
export const SAFETY_EXPIRES_SOON_DAYS = 30;

export type SafetyCheck = {
  id: number;
  userId: number;
  kind: SafetyCheckKind;
  reference: string | null;
  checkedOn: string;
  expiresOn: string;
  revokedAt: string | null;
};
export type SafetyStatus = "valid" | "expires_soon" | "expired" | "revoked" | "none";

export type SafetyError =
  /** Only an owner of the club records or withdraws a check. */
  | "forbidden"
  /** The person isn't an owner, admin or coach of this club. */
  | "not_staff"
  | "kind_invalid"
  | "dates_invalid"
  | "reference_too_long"
  | "not_found";
export type SafetyResult<T> = { ok: true; value: T } | { ok: false; code: SafetyError };
const no = <T>(code: SafetyError): SafetyResult<T> => ({ ok: false, code });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const addDays = (dateKey: string, days: number) => new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const addYears = (dateKey: string, years: number) => `${Number(dateKey.slice(0, 4)) + years}${dateKey.slice(4)}`;

const COLUMNS = `id, user_id, kind, reference, checked_on::text AS checked_on, expires_on::text AS expires_on, revoked_at`;
const toCheck = (r: Record<string, unknown>): SafetyCheck => ({
  id: Number(r.id),
  userId: Number(r.user_id),
  kind: r.kind as SafetyCheckKind,
  reference: r.reference == null ? null : String(r.reference),
  checkedOn: String(r.checked_on),
  expiresOn: String(r.expires_on),
  revokedAt: r.revoked_at ? new Date(r.revoked_at as string).toISOString() : null,
});

/** What one record says on a given day (the club's own date). */
export function statusOf(check: SafetyCheck | null, today: string): SafetyStatus {
  if (!check) return "none";
  if (check.revokedAt) return "revoked";
  if (check.expiresOn <= today) return "expired";
  return check.expiresOn <= addDays(today, SAFETY_EXPIRES_SOON_DAYS) ? "expires_soon" : "valid";
}

/** The person's record that counts today: the live one that expires last, else their most recent. */
export async function currentSafetyCheck(db: Db, tenantId: number, userId: number, today: string): Promise<SafetyCheck | null> {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM junior_safety_checks WHERE tenant_id = $1 AND user_id = $2
     ORDER BY (revoked_at IS NULL AND expires_on > $3::date) DESC, expires_on DESC, id DESC LIMIT 1`,
    [tenantId, userId, today],
  );
  return rows[0] ? toCheck(rows[0]) : null;
}

/** Does this person have a safety check that is valid today? */
export async function hasValidSafetyCheck(db: Db, tenantId: number, userId: number, today: string): Promise<boolean> {
  const s = statusOf(await currentSafetyCheck(db, tenantId, userId, today), today);
  return s === "valid" || s === "expires_soon";
}

/** May this person see the junior roster today? A role in the club AND a valid check. */
export async function mayWorkWithJuniors(db: Db, tenantId: number, actor: { playerId: number; access: Access }, today: string): Promise<boolean> {
  if (actor.access.role === null) return false;
  return hasValidSafetyCheck(db, tenantId, actor.playerId, today);
}

/** May this person read a child's medical notes today? An owner, or a coach with a valid check. */
export async function mayReadMedicalNotesToday(db: Db, tenantId: number, actor: { playerId: number; access: Access }, today: string): Promise<boolean> {
  if (actor.access.role === "owner") return true;
  if (actor.access.role !== "coach") return false;
  return hasValidSafetyCheck(db, tenantId, actor.playerId, today);
}

export type RecordInput = { userId: number; kind: string; checkedOn: string; expiresOn: string; reference?: string | null };

/** Record a safety check for one of the club's owners, admins or coaches. Owners only. */
export async function recordSafetyCheck(db: Db, tenantId: number, actor: { playerId: number; access: Access }, input: RecordInput, today: string): Promise<SafetyResult<SafetyCheck>> {
  if (actor.access.role !== "owner") return no("forbidden");
  if (!(SAFETY_CHECK_KINDS as readonly string[]).includes(input.kind)) return no("kind_invalid");
  // Done on or before today, not expired already, and recorded for no longer than the limit.
  if (!isDate(input.checkedOn) || !isDate(input.expiresOn) || input.checkedOn > today || input.expiresOn <= today || input.expiresOn > addYears(input.checkedOn, SAFETY_CHECK_MAX_YEARS)) return no("dates_invalid");
  const reference = typeof input.reference === "string" ? input.reference.replace(/\s+/g, " ").trim() || null : null;
  if (reference && reference.length > SAFETY_REFERENCE_MAX) return no("reference_too_long");
  const staff = (await db.query(`SELECT 1 FROM club_roles WHERE tenant_id = $1 AND player_id = $2 LIMIT 1`, [tenantId, input.userId])).rows[0];
  if (!staff) return no("not_staff");
  const { rows } = await db.query(
    `INSERT INTO junior_safety_checks (tenant_id, user_id, kind, reference, checked_on, expires_on, recorded_by_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
    [tenantId, input.userId, input.kind, reference, input.checkedOn, input.expiresOn, actor.playerId],
  );
  return { ok: true, value: toCheck(rows[0]) };
}

/** Withdraw a recorded check before it expires. Owners only. The record stays. */
export async function revokeSafetyCheck(db: Db, tenantId: number, actor: { playerId: number; access: Access }, checkId: number): Promise<SafetyResult<SafetyCheck>> {
  if (actor.access.role !== "owner") return no("forbidden");
  const { rows } = await db.query(
    `UPDATE junior_safety_checks SET revoked_at = COALESCE(revoked_at, now()), revoked_by_user_id = COALESCE(revoked_by_user_id, $3) WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
    [tenantId, checkId, actor.playerId],
  );
  return rows[0] ? { ok: true, value: toCheck(rows[0]) } : no("not_found");
}

/** Everyone with a role in the club and where their safety check stands today. For the owner's page. */
export async function listStaffSafety(db: Db, tenantId: number, today: string): Promise<{ userId: number; role: string; check: SafetyCheck | null; status: SafetyStatus }[]> {
  const staff = (await db.query(`SELECT player_id, role FROM club_roles WHERE tenant_id = $1 ORDER BY player_id`, [tenantId])).rows;
  const out = [];
  for (const s of staff) {
    const check = await currentSafetyCheck(db, tenantId, Number(s.player_id), today);
    out.push({ userId: Number(s.player_id), role: String(s.role), check, status: statusOf(check, today) });
  }
  return out;
}
