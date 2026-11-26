// Push notifications in the store app (Phase 5). Nothing here runs in a
// browser, and nothing runs in a store build made without the Firebase
// project's file (apps/native: VITE_PUSH is "1" only when that file was
// there): asking Android for a device address without it would stop the app.
//
// The phone asks for permission only when the person turns notifications on
// in Settings, never at first launch.
import { plugin } from "./platform.ts";

type Handle = { remove(): Promise<void> } | Promise<{ remove(): Promise<void> }>;
type Permission = { receive: "prompt" | "prompt-with-rationale" | "granted" | "denied" };
type Tap = { notification: { data?: Record<string, unknown> } };
export type PushPlugin = {
  checkPermissions(): Promise<Permission>;
  requestPermissions(): Promise<Permission>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  addListener(event: "registration", listener: (token: { value: string }) => void): Handle;
  addListener(event: "registrationError", listener: (error: { error: string }) => void): Handle;
  addListener(event: "pushNotificationActionPerformed", listener: (tap: Tap) => void): Handle;
};

const BUILT_WITH_PUSH: boolean = import.meta.env?.VITE_PUSH === "1";

/** The plugin, or undefined: in a browser, and in a store build without the Firebase file. */
export function pushPlugin(native: PushPlugin | undefined = plugin<PushPlugin>("PushNotifications"), built: boolean = BUILT_WITH_PUSH): PushPlugin | undefined {
  return built ? native : undefined;
}

/**
 * "unavailable": not this build. "ask": the phone hasn't been asked yet.
 * "on": allowed. "blocked": the person said no to the phone; only the
 * phone's own settings can change that.
 */
export type PushState = "unavailable" | "ask" | "on" | "blocked";

const stateOf = (p: Permission): PushState => (p.receive === "granted" ? "on" : p.receive === "denied" ? "blocked" : "ask");

export async function pushState(native: PushPlugin | undefined = pushPlugin()): Promise<PushState> {
  return native ? stateOf(await native.checkPermissions()) : "unavailable";
}

const remove = (handle: Handle) => void Promise.resolve(handle).then((h) => h.remove());

/**
 * Asks the phone (once: Android shows its own question), then asks for this
 * device's address. The address is what the server sends to; it is null when
 * the person said no, and the call fails when the phone couldn't get one.
 */
export async function turnOnPush(native: PushPlugin | undefined = pushPlugin(), waitMs = 15_000): Promise<{ state: PushState; token: string | null }> {
  if (!native) return { state: "unavailable", token: null };
  let state = stateOf(await native.checkPermissions());
  if (state === "ask") state = stateOf(await native.requestPermissions());
  if (state !== "on") return { state, token: null };
  const handles: Handle[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = await new Promise<string>((resolve, reject) => {
      handles.push(native.addListener("registration", ({ value }) => resolve(value)));
      handles.push(native.addListener("registrationError", ({ error }) => reject(new Error(error))));
      timer = setTimeout(() => reject(new Error("push_timeout")), waitMs);
      native.register().catch(reject);
    });
    return { state, token };
  } finally {
    clearTimeout(timer);
    handles.forEach(remove);
  }
}

/** This device stops receiving (sign out, or notifications turned off). */
export async function turnOffPush(native: PushPlugin | undefined = pushPlugin()): Promise<void> {
  await native?.unregister();
}

/**
 * The screen a notification asks for. Only a path inside the app: a
 * notification can't send the app to another site.
 */
export function pathFromPush(data: Record<string, unknown> | undefined): string | null {
  const path = data?.path;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  try {
    const url = new URL(path, "https://app.invalid");
    return url.host === "app.invalid" ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/** Tapping a notification opens its screen. */
export function onPushTap(go: (path: string) => void, native: PushPlugin | undefined = pushPlugin()): void {
  if (!native) return;
  void native.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const path = pathFromPush(notification.data);
    if (path) go(path);
  });
}
