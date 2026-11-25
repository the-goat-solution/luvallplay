// The app's singletons: storage, the persistent choices, the API clients.
import { createTransport } from "@luvallplay/api/client";
import { createApi, type Api } from "@luvallplay/api/client.gen";
import { API_PREFIX } from "@luvallplay/api/routes";
import { trustedHost } from "./lib/api-host.ts";
import { browserStorage } from "./lib/storage.ts";
import { createStore } from "./lib/store.ts";

export const storage = browserStorage();
export const store = createStore(storage);

/** The home API host: "" means this page's own origin. */
export const HOME_HOST = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
const TRUSTED_HOSTS = [HOME_HOST, ...(import.meta.env.VITE_API_HOSTS ?? "").split(/[\s,]+/), "https://api.luvallplay.com"].filter(Boolean);

const clients = new Map<string, Api>();

/** The API on `host`. Every client sends the session token and signs the app out on a 401. */
export function apiOn(host: string): Api {
  let api = clients.get(host);
  if (!api) {
    api = createApi(createTransport({ baseUrl: host, getToken: () => store.get().token, onUnauthorized: () => store.signOut() }));
    clients.set(host, api);
  }
  return api;
}

export const api = apiOn(HOME_HOST);

/** The API of a club, from the `apiBase` the server gave for it (its region's host), when the app trusts that host. */
export function apiForClub(apiBase: string | undefined): Api {
  return apiOn(clubHost(apiBase));
}

/** The host a club's API calls go to ("" for this page's own origin). */
export function clubHost(apiBase: string | undefined): string {
  return trustedHost(apiBase, API_PREFIX, HOME_HOST, globalThis.location?.origin ?? "", TRUSTED_HOSTS);
}
