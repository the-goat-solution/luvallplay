// Which accepted games' "versus" splash was seen or put off ("Later"), kept
// on this device. Small on purpose: the shell reads it on every tab.
import { useSyncExternalStore } from "react";
import { storage } from "../../app.ts";
import type { ArenaState } from "./data.ts";

const SEEN = "arena.vsSeen";
const LATER = "arena.vsLater";
const listeners = new Set<() => void>();

function ids(key: string): number[] {
  try {
    const v = JSON.parse(storage.get(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}
function write(key: string, list: number[]) {
  storage.set(key, JSON.stringify(list.slice(-50)));
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const snapshot = () => `${storage.get(SEEN) ?? ""}|${storage.get(LATER) ?? ""}`;

/** The accepted game to show (or the one put off), and what to do with it. */
export function useVersus(state: Pick<ArenaState, "mine"> | undefined) {
  useSyncExternalStore(subscribe, snapshot);
  const seen = ids(SEEN);
  const later = ids(LATER);
  const pending = state?.mine.find((c) => c.status === "accepted" && c.accepting && !seen.includes(c.id));
  return {
    show: pending && !later.includes(pending.id) ? pending : undefined,
    later: pending && later.includes(pending.id) ? pending : undefined,
    go: (id: number) => {
      write(SEEN, [...seen, id]);
      write(LATER, later.filter((x) => x !== id));
    },
    putOff: (id: number) => write(LATER, [...later.filter((x) => x !== id), id]),
    reopen: (id: number) => write(LATER, later.filter((x) => x !== id)),
  };
}
