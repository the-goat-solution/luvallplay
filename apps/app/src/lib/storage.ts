// Where the app keeps what must survive a restart: the session token and a
// few choices. One small interface, so Phase 5 can put the token in the
// phone's secure storage (Keychain / Keystore) without touching callers.

export type KeyValue = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

/** In memory: tests, and the fallback when the browser refuses storage (private mode). */
export function memoryStorage(): KeyValue {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

/** localStorage under a prefix; any failure (blocked, full) degrades to memory instead of throwing. */
export function browserStorage(prefix = "lp.", backing: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined = globalThis.localStorage): KeyValue {
  const fallback = memoryStorage();
  return {
    get(k) {
      try {
        return backing?.getItem(prefix + k) ?? fallback.get(k);
      } catch {
        return fallback.get(k);
      }
    },
    set(k, v) {
      fallback.set(k, v);
      try {
        backing?.setItem(prefix + k, v);
      } catch {
        // Kept in memory for this run.
      }
    },
    remove(k) {
      fallback.remove(k);
      try {
        backing?.removeItem(prefix + k);
      } catch {
        // Nothing to do.
      }
    },
  };
}
