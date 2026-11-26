// Push notifications for the players' app API: the signed-in person's own
// devices and kinds (lib/push/devices.ts does the work and holds the rules).
import { db } from "./admin-access";
import { countDevices, getPrefs, registerDevice, removeAllDevices, removeDevice, setPrefs } from "./push/devices";
import { pushSealAvailable } from "./push/seal";

export async function pushOverview(playerId: number) {
  const [devices, kinds] = await Promise.all([countDevices(db, playerId), getPrefs(db, playerId)]);
  return { available: pushSealAvailable(), devices, kinds };
}

export const addPushDevice = (playerId: number, input: { token: string; platform: string }) => registerDevice(db, playerId, input);
export const dropPushDevice = (playerId: number, token: string) => removeDevice(db, playerId, token);
export const setPushKinds = (playerId: number, kinds: Record<string, unknown>) => setPrefs(db, playerId, kinds);

/**
 * Signing out, signing out everywhere, deleting the account: the person's
 * device (or all of them) stops receiving. Never in the way of the sign-out
 * itself: a failure is logged (without any address) and the sign-out goes on.
 */
export async function forgetPushDevices(playerId: number, which: { all: true } | { token: string | null | undefined }): Promise<void> {
  try {
    if ("all" in which) await removeAllDevices(db, playerId);
    else if (which.token) await removeDevice(db, playerId, which.token);
  } catch (err) {
    console.error("[push] device cleanup failed:", err instanceof Error ? err.message : "unknown error");
  }
}
