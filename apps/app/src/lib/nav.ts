// The app's tabs, and which of them a club shows (a module that is off
// takes its screens away: build plan §6.2.3).
import type { AppKey } from "@luvallplay/i18n/app";

export type TabId = "me" | "arena" | "vision" | "player" | "settings";
export type Tab = { id: TabId; path: `/${TabId}`; label: AppKey; module: string | null };

export const TABS: readonly Tab[] = [
  { id: "me", path: "/me", label: "nav_me", module: null },
  { id: "arena", path: "/arena", label: "nav_arena", module: "arena" },
  { id: "vision", path: "/vision", label: "nav_vision", module: "vision" },
  { id: "player", path: "/player", label: "nav_player", module: null },
  { id: "settings", path: "/settings", label: "nav_settings", module: null },
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
