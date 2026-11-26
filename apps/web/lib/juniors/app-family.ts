// The players' app's Family section (/api/v1/app/clubs/{club}/family…):
// lib/juniors/family.ts in the contract's shape (packages/api, "family.*").
//
// Every handler asks `requireJuniors` first. The wrapper already answers 404
// when the module is off, but its switch reads fail open by design; Juniors
// fails closed (lib/juniors/module.ts), so the question is asked again here.
import type { FamilyChildResponse, FamilyResponse } from "@luvallplay/api/schemas";
import { AppApiError, fail } from "../app-api";
import type { ClubConfig } from "../club-config";
import { clockOf } from "../club-public";
import { sql } from "../database";
import { getClubToday } from "../dates";
import type { Player } from "../player-db";
import {
  CHILD_NAME_MAX,
  CONSENT_VERSION,
  MAX_CHILDREN_PER_GUARDIAN,
  addChild,
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
import { juniorsOn } from "./module";

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
async function requireJuniors(club: ClubConfig): Promise<{ tenantId: number; year: number } | AppApiError> {
  if (club.tenantId === null || !(await juniorsOn(sql, club.slug))) return fail(404, "module_off");
  const year = Number(getClubToday(new Date(), clockOf(club)).dateKey.slice(0, 4));
  return { tenantId: club.tenantId, year };
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
