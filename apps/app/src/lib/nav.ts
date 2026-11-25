// The app's tabs, and which of them a club shows (a module that is off
// takes its screens away: build plan §6.2.3).
import type { AppKey } from "@luvallplay/i18n/app";

export type TabId = "home" | "player" | "arena" | "leaderboard" | "vision";
export type Tab = { id: TabId; path: `/${TabId}`; label: AppKey; module: string | null };

// Home · Player · Arena · Leaderboard · Vision: the website's My Profile
// order, with Home first. The person's own page (My profile: memberships,
// photos and settings) isn't a tab: it is their picture in the top bar.
export const TABS: readonly Tab[] = [
  { id: "home", path: "/home", label: "nav_home", module: null },
  { id: "player", path: "/player", label: "nav_player", module: null },
  { id: "arena", path: "/arena", label: "nav_arena", module: "arena" },
  { id: "leaderboard", path: "/leaderboard", label: "nav_leaderboard", module: "arena" },
  { id: "vision", path: "/vision", label: "nav_vision", module: "vision" },
];

/**
 * The tabs to show. `modules` is the club's list of modules that are on, or
 * null while it isn't known yet: then only the tabs every club has are
 * shown, so a module's tab never flashes up for a club that has it off.
 */
export function visibleTabs(modules: readonly string[] | null): Tab[] {
  return TABS.filter((t) => t.module === null || (modules !== null && modules.includes(t.module)));
}

export function tabForPath(pathname: string): Tab | null {
  return TABS.find((t) => pathname === t.path || pathname.startsWith(`${t.path}/`)) ?? null;
}

// ── Several clubs (hooks.tsx explains the idea) ──────────────────────────

/** Home: the person's own pages, for all their clubs at once. Everything else belongs to one club. */
export function isHomePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/home" || pathname === "/me" || pathname === "/welcome" || /^\/(inbox|settings|profile)(\/|$)/.test(pathname);
}

/** The module a club space needs (Arena, Leaderboard: "arena"; Vision: "vision"), or null when every club has it. */
export function moduleForPath(pathname: string): string | null {
  return tabForPath(pathname)?.module ?? null;
}

/** The tabs across clubs: a tab shows when at least one club has its module on. */
export function visibleTabsAcross(modulesByClub: readonly (readonly string[] | null)[]): Tab[] {
  const known = modulesByClub.filter((m): m is readonly string[] => m !== null);
  return TABS.filter((t) => t.module === null || known.some((m) => m.includes(t.module as string)));
}

/**
 * The club a club space shows: the chosen one when it has the space's
 * module, else the first club (in the person's order) that has it; null
 * when none does, or while a club before it is still loading (so the space
 * never opens as another club and then flips).
 */
export function spaceClub<C extends { slug: string }>(clubs: readonly C[], modules: (club: C) => readonly string[] | null, chosen: string | null, module: string | null): C | null {
  const picked = clubs.find((c) => c.slug === chosen);
  for (const c of picked ? [picked, ...clubs.filter((x) => x !== picked)] : clubs) {
    if (module === null) return c;
    const m = modules(c);
    if (m === null) return null;
    if (m.includes(module)) return c;
  }
  return null;
}
