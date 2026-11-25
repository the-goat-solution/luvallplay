// "Get the app": the store apps, offered to someone using the app in a phone
// or tablet browser. Pure decisions here; the dialog is components/GetTheApp.tsx.
//
// - Off until the store apps are live: it needs that store's link, set when
//   the app is built (VITE_APP_STORE_URL, VITE_PLAY_STORE_URL). No link, no
//   offer, whatever else is true.
// - Only in a phone or tablet's browser: never in the installed web app, in
//   the store app itself (Capacitor), or on a computer.
// - Every fifth time the app is opened on this device (the 5th, 10th, ...).

export type Platform = "ios" | "android" | null;

export const OFFER_EVERY = 5;

/** iPhone, iPad (which says it's a Mac but has touch), or Android; anything else: null. */
export function platformOf(userAgent: string, platform = "", maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)) return "ios";
  if (/Android/.test(userAgent)) return "android";
  return null;
}

export type StoreLinks = { ios: string | null; android: string | null };

/** A store link only if it's a real https address on that store. */
export function storeLinks(appStore: string | undefined, playStore: string | undefined): StoreLinks {
  const ok = (url: string | undefined, host: RegExp) => {
    try {
      const u = new URL(url ?? "");
      return u.protocol === "https:" && host.test(u.hostname) ? u.toString() : null;
    } catch {
      return null;
    }
  };
  return { ios: ok(appStore, /^apps\.apple\.com$/), android: ok(playStore, /^play\.google\.com$/) };
}

/** The store to offer on this open, or null for none. `opens` counts this open too. */
export function storeToOffer(o: { platform: Platform; installedWebApp: boolean; storeApp: boolean; opens: number; links: StoreLinks }): string | null {
  if (!o.platform || o.installedWebApp || o.storeApp) return null;
  const link = o.links[o.platform];
  if (!link) return null;
  return o.opens > 0 && o.opens % OFFER_EVERY === 0 ? link : null;
}
