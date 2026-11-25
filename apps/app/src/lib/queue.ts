// Sends the changes made offline (lib/offline.ts) when the connection is
// back, and at start; then Me is fetched again so it shows the club's own
// answer.
import type { QueryClient } from "@tanstack/react-query";
import { apiForClub, storage } from "../app.ts";
import { flushQueue, queued } from "./offline.ts";

let running: Promise<void> | null = null;

export function sendQueued(client: QueryClient): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (!queued(storage).length) return;
    const sent = await flushQueue(storage, async (q) => {
      try {
        await apiForClub(q.apiBase).me.absence({ club: q.club }, { date: q.date, absent: q.absent });
        return "done";
      } catch (err) {
        const status = (err as { status?: number }).status ?? 0;
        // No answer, or the server is down: try again later. Refused (a day
        // that has gone, signed out): dropped, and Me shows the real state.
        return status === 0 || status >= 500 ? "later" : "done";
      }
    });
    if (sent) await client.invalidateQueries({ queryKey: ["me"] });
  })().finally(() => {
    running = null;
  });
  return running;
}

export function startQueue(client: QueryClient): void {
  window.addEventListener("online", () => void sendQueued(client));
  if (navigator.onLine) void sendQueued(client);
}
