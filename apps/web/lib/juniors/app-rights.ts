// The players' app's "export" and "delete" for a child (lib/juniors/data-rights.ts
// in the contract's shape, "family.export" and "family.remove"). Only the
// child's guardian reaches them; Juniors off answers 404.
import type { FamilyDeleteRequestResponse, FamilyExportResponse } from "@luvallplay/api/schemas";
import { AppApiError, fail } from "../app-api";
import type { ClubConfig } from "../club-config";
import { clockOf } from "../club-public";
import { sql } from "../database";
import { getClubToday } from "../dates";
import type { Player } from "../player-db";
import { requireJuniors } from "./app-family";
import { juniorsVault } from "./care";
import { cancelChildDeletion, exportChild, requestChildDeletion, type RightsError } from "./data-rights";
import { notifyClubOfDeletionRequest } from "./notify";

const STATUS: Record<RightsError, number> = { not_found: 404, confirm_required: 400, has_bookings: 409, forbidden: 403 };

export async function familyExport(player: Player, club: ClubConfig, childId: number): Promise<FamilyExportResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const r = await exportChild(sql, juniorsVault(), ctx.tenantId, player.id, childId);
  return r.ok ? r.value : fail(STATUS[r.code], r.code);
}

/** The older "delete now" endpoint: deleting needs the club's confirmation, so it only says how to ask. */
export async function familyRemove(): Promise<AppApiError> {
  return fail(409, "ask_the_club");
}

/** A guardian asks the club to delete their child's information. Nothing is removed until an owner or admin confirms. */
export async function familyRequestDelete(player: Player, club: ClubConfig, childId: number, confirm: boolean): Promise<FamilyDeleteRequestResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const today = getClubToday(new Date(), clockOf(club)).dateKey;
  const r = await requestChildDeletion(sql, ctx.tenantId, player.id, childId, { confirm, today });
  if (!r.ok) return fail(STATUS[r.code], r.code);
  // The club is told once per request. No child's name goes in the email.
  if (r.value.created) await notifyClubOfDeletionRequest().catch((err) => console.error("[juniors] telling the club about a deletion request failed:", err));
  return { requested: true, requestedAt: r.value.requestedAt };
}

/** A guardian withdraws their request before the club has confirmed it. */
export async function familyCancelDelete(player: Player, club: ClubConfig, childId: number): Promise<FamilyDeleteRequestResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const r = await cancelChildDeletion(sql, ctx.tenantId, player.id, childId);
  return r.ok ? { requested: false, requestedAt: null } : fail(STATUS[r.code], r.code);
}
