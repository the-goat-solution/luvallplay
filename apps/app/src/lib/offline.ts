// Offline (build plan §4.1): what the person last saw opens at once from this
// device, and changes made without a connection wait here and are sent when
// it is back.
//
// - The saved screens: the queries named in SAVED (Me, Arena, the
//   leaderboard, the Player tab, the club list and config, the session),
//   written to storage a moment after they change and read back before the
//   first paint. Only for the person who saved them, for a week at most;
//   signing out removes them.
//   A new build of the app starts from nothing: what an older build saved
//   may not be what this one's screens expect.
// - The queue: every "Can't make it" (and its undo), online or not. The
//   latest choice per club and day is kept and sent (lib/queue.ts): at once
//   with a connection, otherwise when it returns and on the next start.
//   While a choice waits, the screens show it over whatever the club's
//   server last said. One the server refuses for good is put aside
//   ("dropped") so the person is told, not left with a silent flip back.
import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";
import { BUILD_ID } from "./build.ts";
import type { KeyValue } from "./storage.ts";

const CACHE_KEY = "cache";
const QUEUE_KEY = "queue";
const DROPPED_KEY = "dropped";
const MAX_AGE_MS = 7 * 24 * 3600_000;
const SAVED = new Set(["session", "clubs", "config", "me", "arena", "leaderboard", "player-stats", "vision"]);

/** Not the token itself: enough to tell whose the saved data is. */
export function ownerOf(token: string): string {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + ":" + token.length;
}

type Saved = { owner: string; build: string; at: number; state: ReturnType<typeof dehydrate> };

/** Reads the saved screens back into the cache (before the first paint). False when there was nothing usable. */
export function restoreCache(client: QueryClient, storage: KeyValue, token: string | null, now = Date.now(), build = BUILD_ID): boolean {
  const raw = storage.get(CACHE_KEY);
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw) as Saved;
    if (!token || saved.owner !== ownerOf(token) || saved.build !== build || now - saved.at > MAX_AGE_MS || raw.includes(token)) {
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
export function saveCache(client: QueryClient, storage: KeyValue, getToken: () => string | null, delayMs = 800, build = BUILD_ID): () => void {
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
      const text = JSON.stringify({ owner: ownerOf(token), build, at: Date.now(), state } satisfies Saved);
      // The token is never written here (query keys carry `ownerOf`, not the
      // token): should a key ever hold it again, nothing is saved at all.
      if (text.includes(token)) return storage.remove(CACHE_KEY);
      storage.set(CACHE_KEY, text);
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
/** A change the club's server refused for good, kept until the person has been told. */
export type DroppedAbsence = { club: string; date: string; absent: boolean; code: string };

const sameDay = (a: { club: string; date: string }, b: { club: string; date: string }) => a.club === b.club && a.date === b.date;

/** Told when the queue or the dropped list changes, so the screens follow. */
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of listeners) l();
};
export const notifyQueue = changed;
export function watchQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function list<T>(storage: KeyValue, key: string, ok: (item: T) => boolean): T[] {
  try {
    const parsed = JSON.parse(storage.get(key) ?? "[]") as T[];
    return Array.isArray(parsed) ? parsed.filter((q) => q && ok(q)) : [];
  } catch {
    return [];
  }
}

function put(storage: KeyValue, key: string, items: unknown[]): void {
  if (items.length) storage.set(key, JSON.stringify(items));
  else storage.remove(key);
  changed();
}

export function queued(storage: KeyValue): QueuedAbsence[] {
  return list<QueuedAbsence>(storage, QUEUE_KEY, (q) => q.kind === "absence" && typeof q.club === "string" && typeof q.date === "string");
}

export function dropped(storage: KeyValue): DroppedAbsence[] {
  return list<DroppedAbsence>(storage, DROPPED_KEY, (q) => typeof q.club === "string" && typeof q.date === "string");
}

/** The person has seen that a change didn't go through. */
export function forgetDropped(storage: KeyValue, item: { club: string; date: string }): void {
  put(storage, DROPPED_KEY, dropped(storage).filter((d) => !sameDay(d, item)));
}

/** Keeps one change per club and day: the latest. A new choice for a day also clears an older refusal for it. */
export function enqueue(storage: KeyValue, item: Omit<QueuedAbsence, "kind" | "at">, now = Date.now()): void {
  const rest = queued(storage).filter((q) => !sameDay(q, item));
  if (dropped(storage).some((d) => sameDay(d, item))) forgetDropped(storage, item);
  put(storage, QUEUE_KEY, [...rest, { kind: "absence", at: now, ...item }]);
}

export function clearOffline(storage: KeyValue): void {
  storage.remove(CACHE_KEY);
  storage.remove(QUEUE_KEY);
  storage.remove(DROPPED_KEY);
  changed();
}

export type SendResult = "sent" | "later" | { refused: string };

/**
 * Sends what waits, oldest first. `send` answers "sent", "later" (no
 * connection, the server is down or asks to slow down: everything stays and
 * is tried again) or `{ refused }` (for good: a day that has gone, a
 * membership that ended), which moves the change to the dropped list.
 * `onSent` runs before a sent change leaves the queue, so the screens can
 * take it over without a moment of the old state. A choice made again while
 * its older one was on the way stays queued. Returns how many were sent or
 * refused.
 */
export async function flushQueue(storage: KeyValue, send: (q: QueuedAbsence) => Promise<SendResult>, onSent?: (q: QueuedAbsence) => void): Promise<number> {
  let handled = 0;
  const tried = new Set<string>();
  for (;;) {
    const item = queued(storage).find((q) => !tried.has(`${q.club}|${q.date}|${q.at}`));
    if (!item) break;
    tried.add(`${item.club}|${item.date}|${item.at}`);
    const result = await send(item);
    if (result === "later") break;
    handled++;
    const still = queued(storage).some((q) => sameDay(q, item) && q.at === item.at);
    if (result === "sent") onSent?.(item);
    else if (still) put(storage, DROPPED_KEY, [...dropped(storage).filter((d) => !sameDay(d, item)), { club: item.club, date: item.date, absent: item.absent, code: result.refused }]);
    put(storage, QUEUE_KEY, queued(storage).filter((q) => !(sameDay(q, item) && q.at === item.at)));
  }
  return handled;
}

type Day = { date: string; absent: boolean; spots: number; included: boolean };

/** A club's play days with the choices that still wait shown over them. */
export function withPending<D extends Day>(calendar: readonly D[], club: string, waiting: readonly QueuedAbsence[]): D[] {
  const mine = waiting.filter((q) => q.club === club);
  if (!mine.length) return calendar as D[];
  return calendar.map((d) => {
    const q = mine.find((m) => m.date === d.date);
    return q && d.included && d.absent !== q.absent ? { ...d, absent: q.absent, spots: Math.max(0, d.spots + (q.absent ? 1 : -1)) } : d;
  });
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
