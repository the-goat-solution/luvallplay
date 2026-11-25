// The players' app's account settings (/api/v1/app/account/...): the same
// changes the website's Settings page makes, from the same functions.
import { revalidateTag } from "next/cache";
import { audit, db as adminDb } from "./admin-access";
import { createHandoff, getAccess, hasAdminAccess, isLastOwner, isStepUpFresh } from "./admin-roles";
import { endPlayerArena } from "./arena-db";
import type { AppSession } from "./app-api";
import { deletePlayerAccount, setPlayerAvatar } from "./player-db";
import { sendAdminAlertEmail } from "./player-email";
import { deletePublicBlobs } from "./public-blob";
import { publicStorage } from "./storage";
import { countUpload } from "./usage-hooks";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" };

/** The public leaderboard and photo credits show names and pictures: refresh them after a change. */
export function refreshLeaderboard(): void {
  try {
    revalidateTag("leaderboard", { expire: 0 });
  } catch {
    // Outside a request (tests).
  }
}

export type PhotoResult = { ok: true; url: string } | { ok: false; status: number; code: string };

/**
 * A profile picture from a data URL the app made (already cut square and
 * shrunk), with the website's rules: JPEG, WebP or PNG, at most 2 MB, stored
 * in the public Blob store. The old picture is removed.
 */
export async function savePhoto(playerId: number, dataUrl: string): Promise<PhotoResult> {
  const m = /^data:(image\/(?:jpeg|webp|png));base64,(.+)$/.exec(dataUrl);
  const ext = m ? TYPES[m[1]] : undefined;
  if (!m || !ext) return { ok: false, status: 400, code: "bad_type" };
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0) return { ok: false, status: 400, code: "bad_type" };
  if (bytes.length > MAX_BYTES) return { ok: false, status: 400, code: "too_large" };
  if (!publicStorage().configured()) return { ok: false, status: 503, code: "not_configured" };
  const blob = await publicStorage().put(`avatars/${playerId}/avatar.${ext}`, bytes, { contentType: m[1] });
  await countUpload(bytes.length);
  const old = await setPlayerAvatar(playerId, blob.url);
  if (old !== blob.url) await deletePublicBlobs([old]);
  refreshLeaderboard();
  return { ok: true, url: blob.url };
}

export async function removePhoto(playerId: number): Promise<void> {
  const old = await setPlayerAvatar(playerId, null);
  await deletePublicBlobs([old]);
  refreshLeaderboard();
}

export type HandoffResult = { ok: true; url: string; expiresInSeconds: number } | { ok: false; status: 403; code: "forbidden" | "step_up" };

/**
 * The app's "Club admin" button: the same single-use link as the web's
 * /api/admin/handoff (needs an admin role and a sign-in within 12 hours),
 * audited the same way.
 */
export async function adminHandoff(session: AppSession, requestUrl: string): Promise<HandoffResult> {
  const { player, signedInAt } = session;
  const access = await getAccess(adminDb, player.id, player.email);
  if (!hasAdminAccess(access)) return { ok: false, status: 403, code: "forbidden" };
  if (!isStepUpFresh(signedInAt)) return { ok: false, status: 403, code: "step_up" };
  const { token, expiresInSeconds } = await createHandoff(adminDb, player.id);
  const ctx = { kind: "player" as const, player: { id: player.id, email: player.email, firstName: player.firstName, lastName: player.lastName }, access, signedInAt, stepUpFresh: true };
  await audit(ctx, { action: "admin.handoff_created", target: `player:${player.id}` });
  return { ok: true, url: new URL(`/admin/handoff?token=${encodeURIComponent(token)}`, requestUrl).toString(), expiresInSeconds };
}

/**
 * Deleting the account, as the website's /api/profile/delete: the club keeps
 * an owner, the arena and the picture go, every session ends, the admins hear.
 */
export async function deleteAccount(player: AppSession["player"]): Promise<{ ok: true } | { ok: false; status: 409; code: "last_owner" }> {
  if (await isLastOwner(adminDb, player.id)) return { ok: false, status: 409, code: "last_owner" };
  await endPlayerArena(player.id).catch((err) => console.error("[app-api] arena cleanup failed:", err));
  await deletePublicBlobs([await setPlayerAvatar(player.id, null).catch(() => null)]);
  await deletePlayerAccount(player.id);
  refreshLeaderboard();
  await sendAdminAlertEmail({
    subject: `Account deleted: ${player.email}`,
    heading: "A player deleted their account",
    lines: [`${player.firstName} ${player.lastName} (${player.email}) deleted their account in the app. Their payment records are kept.`],
  }).catch((err) => console.error("[app-api] delete alert failed:", err));
  return { ok: true };
}
