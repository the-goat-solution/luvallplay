// The players' app's account settings (/api/v1/app/account/...): the same
// changes the website's Settings page makes, from the same functions.
import { revalidateTag } from "next/cache";
import { setPlayerAvatar } from "./player-db";
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
