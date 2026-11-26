// Sends the "Can't make it" choices (lib/offline.ts): every one goes through
// the queue, so there is one path and one order. With a connection that is
// at once; otherwise when it's back, and at start. A sent change is put into
// the saved Me straight away and then Me is fetched again, so the screen
// never shows the old state in between.
import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@luvallplay/api/client";
import { apiForClub, storage } from "../app.ts";
import { enqueue, flushQueue, notifyQueue, queued, withPending, type QueuedAbsence, type SendResult } from "./offline.ts";

type MeLike = { calendar: { date: string; absent: boolean; spots: number; included: boolean }[] };

async function send(q: QueuedAbsence): Promise<SendResult> {
  try {
    await apiForClub(q.apiBase).me.absence({ club: q.club }, { date: q.date, absent: q.absent });
    return "sent";
  } catch (err) {
    // No answer, not the API's answer (a Wi-Fi sign-in page), the server's
    // own failure, or "slow down": it stays and is tried again. Signed out:
    // signing out empties the queue. Anything else is the club's "no".
    if (!(err instanceof ApiError) || err.transient || err.status === 401) return "later";
    return { refused: err.code };
  }
}

let running: Promise<void> | null = null;
let again = false;
// The last try left something waiting (no connection, or the server couldn't take it).
let stalled = typeof navigator !== "undefined" && !navigator.onLine;
export const queueStalled = (): boolean => stalled;
const setStalled = (next: boolean) => {
  if (stalled === next) return;
  stalled = next;
  notifyQueue();
};

export function sendQueued(client: QueryClient): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      if (!queued(storage).length) return;
      const clubs = new Set<string>();
      const handled = await flushQueue(storage, send, (q) => {
        clubs.add(q.club);
        client.setQueriesData<MeLike>({ queryKey: ["me", q.club] }, (me) => (me ? { ...me, calendar: withPending(me.calendar, q.club, [q]) } : me));
      });
      setStalled(queued(storage).length > 0 && !again);
      if (handled) await client.invalidateQueries({ queryKey: ["me"] });
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** A "Can't make it" or its undo: kept on this device, shown at once, sent as soon as it can be. */
export function changeAbsence(client: QueryClient, item: { club: string; apiBase?: string; date: string; absent: boolean }): Promise<void> {
  enqueue(storage, item);
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setStalled(true);
    return Promise.resolve();
  }
  return sendQueued(client);
}

export function startQueue(client: QueryClient): void {
  window.addEventListener("online", () => void sendQueued(client));
  window.addEventListener("offline", () => setStalled(queued(storage).length > 0));
  // Back on screen: a change that had to wait (the server was down) gets another go.
  document.addEventListener("visibilitychange", () => void (document.visibilityState === "visible" && navigator.onLine && sendQueued(client)));
  if (navigator.onLine) void sendQueued(client);
}
