// Whether the app runs inside its store app (the Capacitor shell, Phase 5)
// or in a browser. The shell puts `Capacitor` on the page before the app's
// code runs; nothing of Capacitor is bundled for this, so the web build
// carries no extra weight.
type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

const capacitor = (): CapacitorGlobal | undefined => (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;

/** In the store app on a phone or tablet (not the same page in a browser). */
export function isNative(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

/** "ios", "android" or "web". */
export function platform(): "ios" | "android" | "web" {
  const p = isNative() ? capacitor()?.getPlatform?.() : "web";
  return p === "ios" || p === "android" ? p : "web";
}

/** A native plugin the shell registered, by its name; undefined in a browser or when the shell doesn't have it. */
export function plugin<T>(name: string): T | undefined {
  return isNative() ? (capacitor()?.Plugins?.[name] as T | undefined) : undefined;
}

/**
 * Whether this app may sell Vision passes. Not in a store app: Google Play
 * (and Apple) require their own billing for digital purchases inside an app,
 * and that isn't built yet (build plan §4.5.1, step 5). Memberships and
 * session fees are real-world club services and are not affected.
 * Remove this when Play Billing (through RevenueCat) ships.
 */
export function sellsPasses(): boolean {
  return !isNative();
}
