// The app's few persistent choices as one observable object.
import type { KeyValue, SecretStore } from "./storage.ts";
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
  /** With several clubs: the one Home is narrowed to (its slug), or null for all of them. */
  homeClub: string | null;
};

const DEFAULTS: Prefs = { token: null, club: null, lang: null, theme: "system", needsDetails: false, homeClub: null };
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function read(storage: KeyValue): Prefs {
  const lang = storage.get("lang");
  const theme = storage.get("theme");
  const club = storage.get("club");
  const homeClub = storage.get("homeClub");
  return {
    token: storage.get("token") || null,
    club: club && SLUG.test(club) ? club : null,
    lang: lang === "en" || lang === "vi" ? lang : null,
    theme: theme === "light" || theme === "dark" ? theme : "system",
    needsDetails: storage.get("needsDetails") === "1",
    homeClub: homeClub && SLUG.test(homeClub) ? homeClub : null,
  };
}

export type Store = {
  get(): Prefs;
  set(patch: Partial<Prefs>): void;
  subscribe(listener: () => void): () => void;
  /** Signed out: the token and what belonged to that person go; language and appearance stay. */
  signOut(): void;
  /**
   * Resolves once the token is known. At once in a browser; in the store app
   * the token is in the phone's secret store, which answers asynchronously,
   * so the app waits for this before its first screen.
   */
  ready(): Promise<void>;
};

/**
 * `secrets` (the store app): the token lives there and nowhere else. A token
 * found in plain storage (from the same app before it had the secret store)
 * is moved over once.
 */
export function createStore(storage: KeyValue, secrets?: SecretStore): Store {
  let state = read(storage);
  const listeners = new Set<() => void>();
  // Writes to the secret store, one after another, so a sign-out never lands before the sign-in it follows.
  let secretWrites: Promise<void> = Promise.resolve();
  const writeSecret = (value: string | null) => {
    if (!secrets) return;
    secretWrites = secretWrites
      .then(() => (value ? secrets.set("token", value) : secrets.remove("token")))
      .catch(() => {
        // Kept in memory for this run; they sign in again next time.
      });
  };
  const write = (key: keyof Prefs, value: Prefs[keyof Prefs]) => {
    if (key === "token" && secrets) return writeSecret(value as string | null);
    if (value === null || value === false || value === DEFAULTS[key]) storage.remove(key);
    else storage.set(key, value === true ? "1" : String(value));
  };
  const loaded: Promise<void> = !secrets
    ? Promise.resolve()
    : (async () => {
        const plain = state.token;
        if (plain) storage.remove("token");
        let kept: string | null = null;
        try {
          kept = await secrets.get("token");
        } catch {
          kept = null;
        }
        // Signed in (or out) while the secret store was answering: that stands.
        if (state.token !== plain) return;
        const token = kept ?? plain;
        if (!kept && plain) writeSecret(plain);
        if (token !== state.token) {
          state = { ...state, token };
          for (const l of listeners) l();
        }
        await secretWrites;
      })();
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
    signOut: () => set({ token: null, club: null, needsDetails: false, homeClub: null }),
    ready: () => loaded,
  };
}
