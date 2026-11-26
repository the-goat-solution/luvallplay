// Installing the app on the home screen: the browser's own prompt where it
// offers one (kept from the moment it fires, before Settings is opened), the
// steps on iPhone and iPad, nothing once it's installed.
import { isNative } from "./native/platform.ts";

type PromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: PromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function watchInstall(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    changed();
  });
}

export type InstallState = "installed" | "prompt" | "ios" | "none";

function standalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export const install = {
  get(): InstallState {
    // The store app: nothing to install.
    if (isNative()) return "none";
    if (installed || standalone()) return "installed";
    if (deferred) return "prompt";
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "ios" : "none";
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  async prompt(): Promise<void> {
    const e = deferred;
    if (!e) return;
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferred = null;
    if (outcome === "accepted") installed = true;
    changed();
  },
};
