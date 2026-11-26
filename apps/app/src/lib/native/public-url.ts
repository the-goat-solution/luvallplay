// The app's one public address. In a browser a link the app makes (a pairing
// invite, a shared screen) starts with the page's own origin; inside the
// store app that origin is https://localhost, which means nothing to anyone
// else. So there the links start with the public address instead, and the
// store app opens them itself (app links, apps/native).
import { isNative } from "./platform.ts";

export const PUBLIC_APP_URL: string = (import.meta.env?.VITE_PUBLIC_APP_URL ?? "https://app.luvallplay.com").replace(/\/+$/, "");

/** What a link to this app should start with: the public address in the store app, this page's origin in a browser. */
export function publicOrigin(native: boolean = isNative(), origin: string = globalThis.location?.origin ?? PUBLIC_APP_URL): string {
  return native ? PUBLIC_APP_URL : origin;
}

/**
 * The screen a link to the app asks for ("/arena?join=AB12"), or null when
 * the link isn't to this app's public address. Only the path, the query and
 * the fragment are kept: nothing in a link can send the app to another site.
 */
export function pathFromLink(link: string, publicUrl: string = PUBLIC_APP_URL): string | null {
  let url: URL;
  let home: URL;
  try {
    url = new URL(link);
    home = new URL(publicUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.host !== home.host || url.username || url.password) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  return path.startsWith("/") && !path.startsWith("//") ? path : null;
}
