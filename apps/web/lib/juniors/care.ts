// A child's emergency contacts and medical notes (Phase 3b step 4).
//
// Who may do what:
// - The child's GUARDIAN writes and reads both. Nobody else writes either.
// - MEDICAL NOTES are read by the guardian and, on the club's side, by an
//   owner or a coach with a valid recorded safety check (lib/juniors/safety.ts).
//   Admins, coaches without a check and Luvallplay staff do not read them.
// - The note is ENCRYPTED before it reaches the database (envelope
//   encryption, bound to the club and the child: lib/integrations/token-vault.ts
//   with Juniors' own keys, JUNIORS_KEKS). With no key set, a note can't be
//   saved or read: it fails closed and is never stored in plain text.
// - A note is never logged and never put in the audit log; callers record
//   only that it was read, by whom, for which child id.
import type { Access } from "@luvallplay/auth";
import type { TokenVault } from "@luvallplay/integrations";
import { parseKeks, tokenVault } from "../integrations/token-vault.ts";
import { isGuardianOf, type Db } from "./family.ts";
import { mayReadMedicalNotesToday } from "./safety.ts";

export const MAX_EMERGENCY_CONTACTS = 3;
export const CONTACT_NAME_MAX = 60;
export const CONTACT_RELATIONSHIP_MAX = 40;
export const MEDICAL_NOTES_MAX = 2000;

export type EmergencyContact = { position: number; name: string; phone: string; relationship: string | null };
export type EmergencyContactInput = { name: string; phone: string; relationship?: string | null };

export type CareError =
  /** Not this child's guardian (or no such child in this club). */
  | "not_found"
  | "too_many_contacts"
  | "name_required"
  | "name_too_long"
  | "phone_invalid"
  | "relationship_too_long"
  | "notes_too_long"
  /** No encryption key on this deployment: medical notes can't be saved or read. */
  | "notes_unavailable"
  /** A club-side reader who isn't allowed to read medical notes. */
  | "forbidden";

export type CareResult<T> = { ok: true; value: T } | { ok: false; code: CareError };
const no = <T>(code: CareError): CareResult<T> => ({ ok: false, code });

// ── The vault ───────────────────────────────────────────────────────────────

type Env = Record<string, string | undefined>;

/** Juniors' own vault, from JUNIORS_KEKS ("id:base64key[,…]", newest first; the format of INTEGRATIONS_KEKS). */
export function juniorsVault(env: Env = process.env): TokenVault {
  return tokenVault(() => parseKeks(env.JUNIORS_KEKS));
}

/** Whether medical notes can be saved and read here at all. */
export function medicalNotesAvailable(env: Env = process.env): boolean {
  try {
    return parseKeks(env.JUNIORS_KEKS).length > 0;
  } catch {
    return false;
  }
}

/** What a sealed note is bound to: text sealed for one child can't be opened as another's, or in another club. */
const boundTo = (tenantId: number, childId: number) => ({ tenantId, connector: "juniors.medical", connectionId: `child:${childId}` });

// ── Emergency contacts ──────────────────────────────────────────────────────

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** A phone number as people write one: digits with spaces, +, brackets, hyphens; 6 to 15 digits. Stored as written (tidied). */
function phoneOf(raw: unknown): string | null {
  const s = clean(raw);
  if (!/^[+0-9 ()\-.]{6,24}$/.test(s)) return null;
  const digits = s.replace(/\D/g, "").length;
  return digits >= 6 && digits <= 15 ? s : null;
}

const toContact = (r: Record<string, unknown>): EmergencyContact => ({
  position: Number(r.position),
  name: String(r.name),
  phone: String(r.phone),
  relationship: r.relationship == null ? null : String(r.relationship),
});

async function contactsOf(db: Db, tenantId: number, childId: number): Promise<EmergencyContact[]> {
  const { rows } = await db.query(
    `SELECT position, name, phone, relationship FROM junior_emergency_contacts WHERE tenant_id = $1 AND junior_profile_id = $2 ORDER BY position`,
    [tenantId, childId],
  );
  return rows.map(toContact);
}

/** The child's emergency contacts, for their guardian. */
export async function listEmergencyContacts(db: Db, tenantId: number, guardianId: number, childId: number): Promise<CareResult<EmergencyContact[]>> {
  if (!(await isGuardianOf(db, tenantId, guardianId, childId))) return no("not_found");
  return { ok: true, value: await contactsOf(db, tenantId, childId) };
}

/** Replace the child's emergency contacts with this list, in this order (the first is who to call first). An empty list removes them. */
export async function setEmergencyContacts(db: Db, tenantId: number, guardianId: number, childId: number, input: readonly EmergencyContactInput[]): Promise<CareResult<EmergencyContact[]>> {
  if (!Array.isArray(input) || input.length > MAX_EMERGENCY_CONTACTS) return no("too_many_contacts");
  const contacts: { name: string; phone: string; relationship: string | null }[] = [];
  for (const c of input) {
    const name = clean(c?.name);
    if (!name) return no("name_required");
    if (name.length > CONTACT_NAME_MAX) return no("name_too_long");
    const phone = phoneOf(c?.phone);
    if (!phone) return no("phone_invalid");
    const relationship = clean(c?.relationship) || null;
    if (relationship && relationship.length > CONTACT_RELATIONSHIP_MAX) return no("relationship_too_long");
    contacts.push({ name, phone, relationship });
  }
  if (!(await isGuardianOf(db, tenantId, guardianId, childId))) return no("not_found");
  // Write each position, then drop the positions past the end. Either statement can be repeated safely.
  for (const [i, c] of contacts.entries()) {
    await db.query(
      `INSERT INTO junior_emergency_contacts (tenant_id, junior_profile_id, position, name, phone, relationship, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, junior_profile_id, position) DO UPDATE SET
         name = EXCLUDED.name, phone = EXCLUDED.phone, relationship = EXCLUDED.relationship, updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id`,
      [tenantId, childId, i + 1, c.name, c.phone, c.relationship, guardianId],
    );
  }
  await db.query(`DELETE FROM junior_emergency_contacts WHERE tenant_id = $1 AND junior_profile_id = $2 AND position > $3`, [tenantId, childId, contacts.length]);
  return { ok: true, value: await contactsOf(db, tenantId, childId) };
}

// ── Medical notes ───────────────────────────────────────────────────────────

export type MedicalNotes = { notes: string; updatedAt: string | null };

async function openNotes(db: Db, vault: TokenVault, tenantId: number, childId: number): Promise<MedicalNotes> {
  const row = (await db.query(`SELECT sealed, updated_at FROM junior_medical_notes WHERE tenant_id = $1 AND junior_profile_id = $2`, [tenantId, childId])).rows[0];
  if (!row) return { notes: "", updatedAt: null };
  return { notes: await vault.open(boundTo(tenantId, childId), String(row.sealed)), updatedAt: new Date(row.updated_at as string).toISOString() };
}

/** Save the child's medical note (the guardian only). Empty text removes it. */
export async function setMedicalNotes(db: Db, vault: TokenVault, tenantId: number, guardianId: number, childId: number, text: string, env: Env = process.env): Promise<CareResult<{ saved: boolean }>> {
  const notes = typeof text === "string" ? text.replace(/\r\n/g, "\n").trim() : "";
  if (notes.length > MEDICAL_NOTES_MAX) return no("notes_too_long");
  if (!(await isGuardianOf(db, tenantId, guardianId, childId))) return no("not_found");
  if (!notes) {
    await db.query(`DELETE FROM junior_medical_notes WHERE tenant_id = $1 AND junior_profile_id = $2`, [tenantId, childId]);
    return { ok: true, value: { saved: false } };
  }
  if (!medicalNotesAvailable(env)) return no("notes_unavailable");
  const sealed = await vault.seal(boundTo(tenantId, childId), notes);
  await db.query(
    `INSERT INTO junior_medical_notes (tenant_id, junior_profile_id, sealed, updated_by_user_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, junior_profile_id) DO UPDATE SET sealed = EXCLUDED.sealed, updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id`,
    [tenantId, childId, sealed, guardianId],
  );
  return { ok: true, value: { saved: true } };
}

/** The child's medical note, for their guardian. */
export async function readMedicalNotesAsGuardian(db: Db, vault: TokenVault, tenantId: number, guardianId: number, childId: number, env: Env = process.env): Promise<CareResult<MedicalNotes>> {
  if (!(await isGuardianOf(db, tenantId, guardianId, childId))) return no("not_found");
  if (!medicalNotesAvailable(env)) return no("notes_unavailable");
  return { ok: true, value: await openNotes(db, vault, tenantId, childId) };
}

/**
 * The child's medical note, for the club: an owner, or a coach with a safety
 * check that is valid today (lib/juniors/safety.ts). The caller records the
 * read in the audit log (who, which child id; never the note).
 */
export async function readMedicalNotesForClub(db: Db, vault: TokenVault, tenantId: number, actor: { playerId: number; access: Access }, childId: number, today: string, env: Env = process.env): Promise<CareResult<MedicalNotes>> {
  if (!(await mayReadMedicalNotesToday(db, tenantId, actor, today))) return no("forbidden");
  const child = (await db.query(`SELECT 1 FROM junior_profiles WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, childId])).rows[0];
  if (!child) return no("not_found");
  if (!medicalNotesAvailable(env)) return no("notes_unavailable");
  return { ok: true, value: await openNotes(db, vault, tenantId, childId) };
}
