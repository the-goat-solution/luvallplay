// This phone and the person's notifications (the store app only): turning
// them on registers the phone's push address with the server, turning them
// off (or signing out) takes it away again.
//
// The address is remembered on the phone only so it can be taken away later
// and compared after a restart (phones replace their address now and then).
import type { KeyValue } from "../storage.ts";
import { platform } from "./platform.ts";
import { pushPlugin, pushState, turnOffPush, turnOnPush, type PushPlugin, type PushState } from "./push.ts";

const KEY = "push.token";

export type PushServer = {
  register(input: { token: string; platform: "android" | "ios" }): Promise<unknown>;
  remove(input: { token: string }): Promise<unknown>;
};
export type PushDeps = { storage: KeyValue; server: PushServer; native?: PushPlugin; platform?: "android" | "ios" | "web" };

const nativeOf = (deps: PushDeps) => ("native" in deps ? deps.native : pushPlugin());
const platformOf = (deps: PushDeps) => deps.platform ?? platform();

/** The address this phone registered, or null when notifications are off here. */
export function rememberedPushToken(storage: KeyValue): string | null {
  return storage.get(KEY) || null;
}

/** For signing out: the address to hand to the server, forgotten here at once. */
export function takePushToken(storage: KeyValue): string | null {
  const token = rememberedPushToken(storage);
  storage.remove(KEY);
  return token;
}

/**
 * Turns notifications on for this phone: asks the phone (once), registers
 * the address with the server, remembers it. Returns where things stand;
 * only "on" means the phone is registered.
 */
export async function enablePush(deps: PushDeps): Promise<PushState> {
  const os = platformOf(deps);
  if (os === "web") return "unavailable";
  const { state, token } = await turnOnPush(nativeOf(deps));
  if (state !== "on" || !token) return state;
  await deps.server.register({ token, platform: os });
  deps.storage.set(KEY, token);
  return "on";
}

/** Turns notifications off for this phone. The phone forgets even when the server can't be reached (signing out covers it later). */
export async function disablePush(deps: PushDeps): Promise<void> {
  const token = takePushToken(deps.storage);
  try {
    if (token) await deps.server.remove({ token });
  } finally {
    await turnOffPush(nativeOf(deps)).catch(() => {});
  }
}

/**
 * After a restart, when notifications are on for this phone: the address is
 * read again and, when the phone has replaced it, the new one is registered
 * and the old one taken away. The phone is never asked for permission here.
 */
export async function refreshPush(deps: PushDeps): Promise<void> {
  const old = rememberedPushToken(deps.storage);
  const os = platformOf(deps);
  const native = nativeOf(deps);
  if (!old || os === "web" || !native) return;
  if ((await pushState(native)) !== "on") return;
  const { token } = await turnOnPush(native);
  if (!token || token === old) return;
  await deps.server.register({ token, platform: os });
  deps.storage.set(KEY, token);
  await deps.server.remove({ token: old }).catch(() => {});
}
