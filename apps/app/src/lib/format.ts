// Dates, times and money for people, in the person's language and the
// club's country, time zone and currency. Club days arrive as YYYY-MM-DD
// (already the club's calendar day), times as ISO instants, money as integer
// minor units of the club's currency.
import { formatMoney } from "@luvallplay/core/money";

export type Place = { lang: string; country: string; timezone: string; currency: string };

/** The locale to format with: Vietnamese as written in Vietnam, English as written in the club's country. */
export function localeOf(lang: string, country: string): string {
  const candidate = lang === "vi" ? "vi-VN" : `en-${country.toUpperCase()}`;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(candidate).length ? candidate : "en";
  } catch {
    return "en";
  }
}

/**
 * The country to write English for while a club's own isn't known yet (its
 * config still loading, or screens that belong to no club): the device's, so
 * no club's country is assumed. "" when the device doesn't say (plain "en").
 */
export function deviceCountry(language: string | undefined = typeof navigator === "undefined" ? undefined : navigator.language): string {
  return /^[a-z]{2,3}-([A-Za-z]{2})\b/.exec(language ?? "")?.[1]?.toUpperCase() ?? "";
}

/** "Fri 12 Dec" from a club day. The day is already the club's, so it's formatted as UTC (no shift). */
export function dayLabel(dateKey: string | null | undefined, locale: string, withYear = false): string {
  if (!dateKey) return "";
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString(locale, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** "Fri" and "12": the two lines of a calendar day's tile. */
export function dayTile(dateKey: string, locale: string): { weekday: string; day: number } {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return { weekday: d.toLocaleDateString(locale, { timeZone: "UTC", weekday: "short" }), day: d.getUTCDate() };
}

/** "December 2026" from "2026-12". */
export function monthLabel(month: string, locale: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, { timeZone: "UTC", month: "long", year: "numeric" });
}

/** "7:00 pm – 9:00 pm" in the club's time zone, or "" without a start. */
export function timeRange(start: string | null, end: string | null, locale: string, timeZone: string): string {
  if (!start) return "";
  const opts: Intl.DateTimeFormatOptions = { timeZone, hour: "numeric", minute: "2-digit" };
  const s = new Date(start).toLocaleTimeString(locale, opts);
  return end ? `${s} – ${new Date(end).toLocaleTimeString(locale, opts)}` : s;
}

/** 3300 NZD → "$33"; 1050 → "$10.50"; 50000 VND → "50.000 ₫". */
export function money(minor: number, currency: string): string {
  // No currency known (the club's config hasn't arrived): no amount, never another club's money.
  if (!currency) return "";
  return formatMoney(minor, currency, { trimZeros: true, group: true });
}

/** Play days grouped by month, in order: [["2026-12", [...]], ...]. */
export function byMonth<T extends { date: string }>(days: readonly T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups.entries()];
}

/** The first play day this person is in (a membership day or a booked spot), as on the website. */
export function nextUp<T extends { paused: boolean; booked: boolean; included: boolean }>(days: readonly T[]): T | null {
  return days.find((d) => !d.paused && (d.booked || d.included)) ?? null;
}

const HOUR_MS = 3600_000;

/**
 * How long a challenge stays open, for its card: whole days once there is a
 * day or more, hours under a day, "today" under an hour. A challenge closes
 * at the end of the club's day, so one put up for 7 days has between 7 and 8
 * days left: whole days are counted (never rounded up), so it never reads as
 * more days than were chosen.
 */
export function openFor(leftMs: number): { unit: "today" } | { unit: "hours" | "days"; n: number } {
  if (leftMs < HOUR_MS) return { unit: "today" };
  if (leftMs < 24 * HOUR_MS) return { unit: "hours", n: Math.round(leftMs / HOUR_MS) };
  return { unit: "days", n: Math.floor(leftMs / (24 * HOUR_MS)) };
}
