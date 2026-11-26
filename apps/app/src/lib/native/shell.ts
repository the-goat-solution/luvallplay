// What only the store app does, loaded only there (main.tsx): opening the
// screen a link or a notification asks for, and the Android back button.
import { catchOutsideLinks, closeOutside } from "./open.ts";
import { plugin } from "./platform.ts";
import { pathFromLink } from "./public-url.ts";
import { onPushTap } from "./push.ts";

type Handle = { remove(): Promise<void> } | Promise<{ remove(): Promise<void> }>;
type AppPlugin = {
  addListener(event: "appUrlOpen", listener: (data: { url: string }) => void): Handle;
  addListener(event: "backButton", listener: (data: { canGoBack: boolean }) => void): Handle;
  exitApp(): Promise<void>;
};

/** Closes the sheet or dialog on top, as Escape does. False when none is open. */
export function closeTopDialog(doc: Pick<Document, "querySelectorAll"> = document): boolean {
  const open = [...doc.querySelectorAll("dialog[open]")];
  const top = open[open.length - 1];
  if (!top) return false;
  // The same event Escape sends: the dialog's own handler decides (some can't be dismissed).
  top.dispatchEvent(new Event("cancel", { cancelable: true }));
  return true;
}

export type ShellHost = { go(path: string): void; back(): void };

/**
 * Back on Android: the sheet on top closes first; otherwise one screen back;
 * on the first screen, the app goes to the background as any Android app does.
 */
export function onBack(data: { canGoBack: boolean }, host: ShellHost, exit: () => void, close: () => boolean = closeTopDialog): void {
  if (close()) return;
  if (data.canGoBack) host.back();
  else exit();
}

export function startShell(host: ShellHost, app: AppPlugin | undefined = plugin<AppPlugin>("App")): void {
  if (!app) return;
  void app.addListener("appUrlOpen", ({ url }) => {
    const path = pathFromLink(url);
    if (!path) return;
    // Back from a page that was open over the app (Stripe's billing page): it goes away.
    closeOutside();
    host.go(path);
  });
  catchOutsideLinks();
  onPushTap((path) => host.go(path));
  void app.addListener("backButton", (data) => onBack(data, host, () => void app.exitApp()));
}
