// The players' app's forms and waivers for a child (lib/juniors/forms.ts in
// the contract's shape, "family.forms" and "family.signForm"). Only the
// child's guardian reaches them; Juniors off answers 404.
import type { FamilyFormResponse, FamilyFormsResponse } from "@luvallplay/api/schemas";
import { AppApiError, fail } from "../app-api";
import type { ClubConfig } from "../club-config";
import { sql } from "../database";
import type { Player } from "../player-db";
import { requireJuniors } from "./app-family";
import { SIGNED_NAME_MAX, listChildForms, signForm, type FormError } from "./forms";

const STATUS: Partial<Record<FormError, number>> = { not_found: 404, not_current: 409, name_required: 400, name_too_long: 400 };
const refused = (code: FormError) => fail(STATUS[code] ?? 400, code);

export async function familyForms(player: Player, club: ClubConfig, childId: number): Promise<FamilyFormsResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const r = await listChildForms(sql, ctx.tenantId, player.id, childId);
  return r.ok ? { forms: r.value, limits: { nameMax: SIGNED_NAME_MAX } } : refused(r.code);
}

export async function familySignForm(player: Player, club: ClubConfig, childId: number, formId: number, name: string): Promise<FamilyFormResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const r = await signForm(sql, ctx.tenantId, player.id, childId, formId, name);
  return r.ok ? { form: r.value } : refused(r.code);
}
