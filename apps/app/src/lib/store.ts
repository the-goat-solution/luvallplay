// The app's few persistent choices as one observable object.
import type { KeyValue } from "./storage.ts";
import type { ThemeChoice } from "./theme.ts";

export type Prefs = {
  /** The session token, or null when signed out. */
  token: string | null;
  /** The club the person is looking at (its slug). */
  club: string | null;
  /** A language chosen in Settings; null follows the account, then the device. */
  lang: "en" | "vi" | null;
  theme: ThemeChoice;
  /** The account has no name yet (told at sign-in). */
  needsDetails: boolean;
};

const DEFAULTS: Prefs = { token: null, club: null, lang: null, theme: "system", needsDetails: false };
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function read(storage: KeyValue): Prefs {
  const lang = storage.get("lang");
  const theme = storage.get("theme");
  const club = storage.get("club");
  return {
    token: storage.get("token") || null,
    club: club && SLUG.test(club) ? club : null,
    lang: lang === "en" || lang === "vi" ? lang : null,
    theme: theme === "light" || theme === "dark" ? theme : "system",
    needsDetails: storage.get("needsDetails") === "1",
  };
}

export type Store = {
  get(): Prefs;
  set(patch: Partial<Prefs>): void;
  subscribe(listener: () => void): () => void;
  /** Signed out: the token and what belonged to that person go; language and appearance stay. */
  signOut(): void;
};

export function createStore(storage: KeyValue): Store {
  let state = read(storage);
  const listeners = new Set<() => void>();
  const write = (key: keyof Prefs, value: Prefs[keyof Prefs]) => {
    if (value === null || value === false || value === DEFAULTS[key]) storage.remove(key);
    else storage.set(key, value === true ? "1" : String(value));
  };
  const set = (patch: Partial<Prefs>) => {
    const next = { ...state, ...patch };
    if ((Object.keys(next) as (keyof Prefs)[]).every((k) => next[k] === state[k])) return;
    for (const k of Object.keys(patch) as (keyof Prefs)[]) write(k, next[k]);
    state = next;
    for (const l of listeners) l();
  };
  return {
    get: () => state,
    set,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    signOut: () => set({ token: null, club: null, needsDetails: false }),
  };
}
