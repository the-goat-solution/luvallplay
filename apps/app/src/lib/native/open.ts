// Leaving the app for another site (Stripe's billing page, the club's admin,
// a receipt, the club's website). In a browser that is an ordinary
// navigation. In the store app the page opens in the phone's in-app browser
// over the app, so the app is still there underneath and "Done" (or a link
// back to app.luvallplay.com) returns to it.
import { plugin } from "./platform.ts";

type BrowserPlugin = { open(options: { url: string }): Promise<void>; close(): Promise<void> };

const browser = () => plugin<BrowserPlugin>("Browser");

/** Only real web addresses leave the app: never `javascript:`, `intent:` or a file. */
export function isOutsideLink(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Opens another site: over the app in the store app, as a navigation in a browser. */
export function openOutside(url: string, native: BrowserPlugin | undefined = browser(), navigate: (url: string) => void = (u) => window.location.assign(u)): void {
  if (native && isOutsideLink(url)) void native.open({ url }).catch(() => navigate(url));
  else navigate(url);
}

/** Closes the in-app browser, when the person has come back to the app through a link. */
export function closeOutside(native: BrowserPlugin | undefined = browser()): void {
  void native?.close().catch(() => {});
}

/**
 * The store app: links that open in a new tab on the web (`target="_blank"`)
 * open in the in-app browser instead. Returns the listener's remover.
 */
export function catchOutsideLinks(doc: Document | undefined = globalThis.document, native: BrowserPlugin | undefined = browser()): () => void {
  if (!native || !doc) return () => {};
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.('a[target="_blank"][href]') as HTMLAnchorElement | null;
    if (!a || e.defaultPrevented || !isOutsideLink(a.href)) return;
    e.preventDefault();
    openOutside(a.href, native);
  };
  doc.addEventListener("click", onClick);
  return () => doc.removeEventListener("click", onClick);
}
