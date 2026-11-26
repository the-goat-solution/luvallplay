// The players' app's "export" and "delete" for a child (lib/juniors/data-rights.ts
// in the contract's shape, "family.export" and "family.remove"). Only the
// child's guardian reaches them; Juniors off answers 404.
import type { FamilyDeleteResponse, FamilyExportResponse } from "@luvallplay/api/schemas";
import { AppApiError, fail } from "../app-api";
import type { ClubConfig } from "../club-config";
import { clockOf } from "../club-public";
import { sql } from "../database";
import { getClubToday } from "../dates";
import type { Player } from "../player-db";
import { requireJuniors } from "./app-family";
import { juniorsVault } from "./care";
import { deleteChild, exportChild, type RightsError } from "./data-rights";

const STATUS: Record<RightsError, number> = { not_found: 404, confirm_required: 400, has_bookings: 409 };

export async function familyExport(player: Player, club: ClubConfig, childId: number): Promise<FamilyExportResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const r = await exportChild(sql, juniorsVault(), ctx.tenantId, player.id, childId);
  return r.ok ? r.value : fail(STATUS[r.code], r.code);
}

export async function familyRemove(player: Player, club: ClubConfig, childId: number, confirm: boolean): Promise<FamilyDeleteResponse | AppApiError> {
  const ctx = await requireJuniors(club);
  if (ctx instanceof AppApiError) return ctx;
  const today = getClubToday(new Date(), clockOf(club)).dateKey;
  const r = await deleteChild(sql, ctx.tenantId, player.id, childId, { confirm, today });
  // Only that it happened, for which child id, by whom: never what was deleted.
  if (r.ok) console.info(`[juniors] child ${childId} deleted by guardian ${player.id} (club ${ctx.tenantId})`);
  return r.ok ? { deleted: true, ...r.value } : fail(STATUS[r.code], r.code);
}
