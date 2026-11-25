// Offline (build plan §4.1): what the person last saw opens at once from this
// device, and changes made without a connection wait here and are sent when
// it is back.
//
// - The saved screens: the queries named in SAVED (Me, Arena, the
//   leaderboard, the Player tab, the club list and config, the session),
//   written to storage a moment after they change and read back before the
//   first paint. Only for the person who saved them, for a week at most;
//   signing out removes them.
// - The queue: "Can't make it" (and its undo) made offline. The latest
//   choice per club and day is kept; it is sent when the connection returns
//   (and on the next start), and then Me is fetched again.
import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";
import type { KeyValue } from "./storage.ts";

const CACHE_KEY = "cache";
const QUEUE_KEY = "queue";
const MAX_AGE_MS = 7 * 24 * 3600_000;
const SAVED = new Set(["session", "clubs", "config", "me", "arena", "leaderboard", "player-stats", "vision"]);

/** Not the token itself: enough to tell whose the saved data is. */
export function ownerOf(token: string): string {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + ":" + token.length;
}

type Saved = { owner: string; at: number; state: ReturnType<typeof dehydrate> };

/** Reads the saved screens back into the cache (before the first paint). False when there was nothing usable. */
export function restoreCache(client: QueryClient, storage: KeyValue, token: string | null, now = Date.now()): boolean {
  const raw = storage.get(CACHE_KEY);
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw) as Saved;
    if (!token || saved.owner !== ownerOf(token) || now - saved.at > MAX_AGE_MS) {
      storage.remove(CACHE_KEY);
      return false;
    }
    hydrate(client, saved.state);
    return true;
  } catch {
    storage.remove(CACHE_KEY);
    return false;
  }
}

/** Keeps the saved screens up to date. Returns the unsubscribe. */
export function saveCache(client: QueryClient, storage: KeyValue, getToken: () => string | null, delayMs = 800): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    timer = null;
    const token = getToken();
    if (!token) return storage.remove(CACHE_KEY);
    const state = dehydrate(client, {
      shouldDehydrateQuery: (q) => q.state.status === "success" && SAVED.has(String(q.queryKey[0])),
      shouldDehydrateMutation: () => false,
    });
    try {
      storage.set(CACHE_KEY, JSON.stringify({ owner: ownerOf(token), at: Date.now(), state } satisfies Saved));
    } catch {
      /* full: the screens just won't open offline */
    }
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" && event.type !== "added" && event.type !== "removed") return;
    if (!SAVED.has(String(event.query.queryKey[0]))) return;
    if (!timer) timer = setTimeout(write, delayMs);
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}

// ── The queue ───────────────────────────────────────────────────────────────

export type QueuedAbsence = { kind: "absence"; club: string; apiBase?: string; date: string; absent: boolean; at: number };

export function queued(storage: KeyValue): QueuedAbsence[] {
  try {
    const list = JSON.parse(storage.get(QUEUE_KEY) ?? "[]") as QueuedAbsence[];
    return Array.isArray(list) ? list.filter((q) => q && q.kind === "absence") : [];
  } catch {
    return [];
  }
}

/** Keeps one change per club and day: the latest. */
export function enqueue(storage: KeyValue, item: Omit<QueuedAbsence, "kind" | "at">, now = Date.now()): void {
  const rest = queued(storage).filter((q) => !(q.club === item.club && q.date === item.date));
  storage.set(QUEUE_KEY, JSON.stringify([...rest, { kind: "absence", at: now, ...item }]));
}

export function clearOffline(storage: KeyValue): void {
  storage.remove(CACHE_KEY);
  storage.remove(QUEUE_KEY);
}

/**
 * Sends what waits. `send` returns "done" (sent, or refused for good: a
 * day that has gone, a membership that ended) or "later" (still offline).
 * Returns how many were sent or dropped.
 */
export async function flushQueue(storage: KeyValue, send: (q: QueuedAbsence) => Promise<"done" | "later">): Promise<number> {
  let handled = 0;
  for (const item of queued(storage)) {
    if ((await send(item)) === "later") break;
    handled++;
    storage.set(QUEUE_KEY, JSON.stringify(queued(storage).filter((q) => !(q.club === item.club && q.date === item.date && q.at === item.at))));
  }
  if (!queued(storage).length) storage.remove(QUEUE_KEY);
  return handled;
}

/** Whether the device says it has a connection. */
export const online = {
  get: () => (typeof navigator === "undefined" ? true : navigator.onLine),
  subscribe(listener: () => void) {
    window.addEventListener("online", listener);
    window.addEventListener("offline", listener);
    return () => {
      window.removeEventListener("online", listener);
      window.removeEventListener("offline", listener);
    };
  },
};
