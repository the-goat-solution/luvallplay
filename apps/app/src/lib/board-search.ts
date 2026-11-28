// The Leaderboard's chosen board in the address (a gap the cutover listed:
// `/leaderboard?period=year&source=challenges&key=2025`), so a shared link
// opens the same board and Back steps through the boards seen. The defaults
// (every source, all time, the current period) stay out of the address.
// The lists are the API's (packages/api schemas/leaderboard.ts); a test
// keeps them the same. Not imported from there: zod stays out of the first bundle.
export const SOURCES = ["all", "challenges", "play", "rr"] as const;
export const PERIODS = ["month", "quarter", "year", "lifetime"] as const;
export type Source = (typeof SOURCES)[number];
export type Period = (typeof PERIODS)[number];
export type BoardSearch = { source?: Source; period?: Period; key?: string };

const KEY = /^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]))?$/;

/** The route's search: only known values; a past period's key only with a period that has one. */
export function boardSearch(search: Record<string, unknown>): BoardSearch {
  const out: BoardSearch = {};
  if (typeof search.source === "string" && (SOURCES as readonly string[]).includes(search.source) && search.source !== "all") out.source = search.source as Source;
  if (typeof search.period === "string" && (PERIODS as readonly string[]).includes(search.period) && search.period !== "lifetime") out.period = search.period as Period;
  const key = typeof search.key === "number" ? String(search.key) : search.key;
  if (out.period && typeof key === "string" && KEY.test(key)) out.key = key;
  return out;
}

/** The board's query from the address (the defaults filled in). */
export const queryOf = (s: BoardSearch): { source: Source; period: Period; key?: string } => ({ source: s.source ?? "all", period: s.period ?? "lifetime", ...(s.key ? { key: s.key } : {}) });
