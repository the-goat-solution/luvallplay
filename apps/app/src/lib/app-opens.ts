// How many times the app has been opened on this device (a page load counts
// once), for "Get the app" every fifth open.
import type { KeyValue } from "./storage.ts";

let counted: number | null = null;

/** This open's number (counted once per page load). */
export function countOpen(storage: KeyValue): number {
  if (counted !== null) return counted;
  const before = Number(storage.get("opens") ?? "0");
  counted = (Number.isFinite(before) && before >= 0 ? Math.floor(before) : 0) + 1;
  try {
    storage.set("opens", String(counted));
  } catch {
    /* storage full or blocked: counts from 1 again next time */
  }
  return counted;
}
