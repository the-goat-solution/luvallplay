// The players' app's "Safety details" for a child: emergency contacts and
// the medical note (lib/juniors/care.ts in the contract's shape, "family.care*").
// Only the child's guardian reaches any of it; Juniors off answers 404.
import type { FamilyCareResponse } from "@luvallplay/api/schemas";
import { AppApiError, fail } from "../app-api";
import type { ClubConfig } from "../club-config";
import { sql } from "../database";
import type { Player } from "../player-db";
import { requireJuniors } from "./app-family";
import {
  CONTACT_NAME_MAX,
  CONTACT_RELATIONSHIP_MAX,
  MAX_EMERGENCY_CONTACTS,
  MEDICAL_NOTES_MAX,
  juniorsVault,
  listEmergencyContacts,
  medicalNotesAvailable,
  readMedicalNotesAsGuardian,
  setEmergencyContacts,
  setMedicalNotes,
  type CareError,
  type EmergencyContactInput,
} from "./care";

const STATUS: Record<CareError, number> = {
  not_found: 404,
  too_many_contacts: 400,
  name_required: 400,
  name_too_long: 400,
  phone_invalid: 400,
  relationship_too_long: 400,
  notes_too_long: 400,
  notes_unavailable: 503,
  forbidden: 403,
};
const refused = (code: CareError) => fail(STATUS[code], code);

async function shown(tenantId: number, guardianId: number, childId: number): Promise<FamilyCareResponse | AppApiError> {
  const contacts = await listEmergencyContacts(sql, tenantId, guardianId, childId);
  if (!contacts.ok) return refused(contacts.code);
  const available = medicalNotesAvailable();
  let notes = "";
  if (available) {
    const read = await readMedicalNotesAsGuardian(sql, juniorsVault(), tenantId, guardianId, childId);
    if (!read.ok) return refused(read.code);
    notes = read.value.notes;
  }
  return {
    contacts: contacts.value.map((c) => ({ name: c.name, phone: c.phone, relationship: c.relationship })),
    medicalNotes: notes,
    medicalNotesAvailable: available,
    limits: { contacts: MAX_EMERGENCY_CONTACTS, nameMax: CONTACT_NAME_MAX, relationshipMax: CONTACT_RELATIONSHIP_MAX, notesMax: MEDICAL_NOTES_MAX },
  };
}

export async function familyCare(player: Player, club: ClubConfig, childId: number): Promise<FamilyCareResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  return shown(ctx.tenantId, player.id, childId);
}

export async function familyCareContacts(player: Player, club: ClubConfig, childId: number, contacts: EmergencyContactInput[]): Promise<FamilyCareResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const r = await setEmergencyContacts(sql, ctx.tenantId, player.id, childId, contacts);
  return r.ok ? shown(ctx.tenantId, player.id, childId) : refused(r.code);
}

export async function familyCareNotes(player: Player, club: ClubConfig, childId: number, notes: string): Promise<FamilyCareResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const r = await setMedicalNotes(sql, juniorsVault(), ctx.tenantId, player.id, childId, notes);
  return r.ok ? shown(ctx.tenantId, player.id, childId) : refused(r.code);
}
