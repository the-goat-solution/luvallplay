// Home for a person in several clubs (hooks.tsx explains the idea): what
// each club's Me says, brought together. Pure, so it is tested on its own.
//
// Order: by when a day starts (an instant, so clubs in different time zones
// order truly); a day with no start time counts from midday on its date; a
// tie keeps the person's own order of clubs.
import { nextUp } from "./format.ts";

type Day = { date: string; startTime: string | null; paused: boolean; booked: boolean; included: boolean };
type ThreadLike = { lastMessageAt: string };

export type FromClub<C, T> = { club: C; item: T };

const when = (d: Day) => Date.parse(d.startTime ?? `${d.date}T12:00:00Z`);

/** The next play day the person is in, across their clubs. */
export function nextAcross<C, D extends Day>(byClub: readonly { club: C; calendar: readonly D[] }[]): FromClub<C, D> | null {
  let best: FromClub<C, D> | null = null;
  for (const { club, calendar } of byClub) {
    const day = nextUp(calendar);
    if (day && (!best || when(day) < when(best.item))) best = { club, item: day };
  }
  return best;
}

/** Every club's play days in one list, by day and time. */
export function mergeCalendars<C, D extends Day>(byClub: readonly { club: C; calendar: readonly D[] }[]): FromClub<C, D>[] {
  const all = byClub.flatMap(({ club, calendar }, rank) => calendar.map((item) => ({ club, item, rank })));
  all.sort((a, b) => when(a.item) - when(b.item) || a.rank - b.rank);
  return all.map(({ club, item }) => ({ club, item }));
}

/** The latest conversations across clubs, newest first. */
export function latestThreads<C, T extends ThreadLike>(byClub: readonly { club: C; threads: readonly T[] }[], limit = Infinity): FromClub<C, T>[] {
  return byClub
    .flatMap(({ club, threads }) => threads.map((item) => ({ club, item })))
    .sort((a, b) => Date.parse(b.item.lastMessageAt) - Date.parse(a.item.lastMessageAt))
    .slice(0, limit);
}

/** A club's initials for its badge: "Three Wolves Badminton Club" → "TW" ("Club", "the", "of" left out). */
export function initials(name: string): string {
  const all = name.trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const words = all.filter((w) => !/^(club|the|of|and)$/i.test(w));
  return (words.length ? words : all).slice(0, 2).map((w) => [...w][0].toUpperCase()).join("") || "?";
}
