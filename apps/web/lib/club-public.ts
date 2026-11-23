// The club settings the browser needs (Phase 3 step 4): the clock that
// decides when booking opens and closes, and the capacities shown in text.
// Nothing here is private. Built on the server from the club's settings
// (app/layout.tsx) and handed to client components through ClubProvider
// (context/ClubContext.tsx → useClub()).
import type { ClubConfig } from "@luvallplay/core/club-config";
import { MINI_GAME_MAX_PLAYERS, SESSION_CAPACITY } from "./constants.ts";
import { DEFAULT_CLUB_CLOCK, type ClubClock } from "./dates.ts";

export type PublicClub = {
  clock: ClubClock;
  currency: string;
  sessionCapacity: number;
  miniGameMaxPlayers: number;
};

/** The built-in values: what a client component sees outside a provider (tests, stories). */
export const DEFAULT_PUBLIC_CLUB: PublicClub = {
  clock: DEFAULT_CLUB_CLOCK,
  currency: "NZD",
  sessionCapacity: SESSION_CAPACITY,
  miniGameMaxPlayers: MINI_GAME_MAX_PLAYERS,
};

export function clockOf(config: ClubConfig): ClubClock {
  return {
    timezone: config.timezone,
    bookingWindowDays: config.playDays.bookingWindowDays,
    bookingCutoffHour: config.playDays.bookingCutoffHour,
  };
}

export function publicClub(config: ClubConfig): PublicClub {
  return {
    clock: clockOf(config),
    currency: config.currency,
    sessionCapacity: config.playDays.sessionCapacity,
    miniGameMaxPlayers: config.roundRobin.miniGameMaxPlayers,
  };
}

/** "5PM", "9AM", "12PM": the cut-off hour as the booking messages say it. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "AM" : "PM"}`;
}
