// The admin menu, generated from the module registry (Track A step A1,
// build plan §6.2.4). Server-side: the shell only receives the groups one
// person may see. Each person sees the pages their role opens and their
// club's modules switch on (app/admin/(console)/layout.tsx).

import { MODULES, PLATFORM_CONSOLE_PAGES, adminMenu, type AdminMenuItem } from "@luvallplay/modules";
import type { NavGroup, NavItem } from "./nav-config";

/** The menu for one person: `allowed` says which pages they may open at this club. */
export function navGroups(allowed?: (item: NavItem) => boolean): NavGroup[] {
  return adminMenu(MODULES, PLATFORM_CONSOLE_PAGES, allowed as ((item: AdminMenuItem) => boolean) | undefined) as NavGroup[];
}

/** Every page, whoever is looking (labels for the audit log, tests). */
export const NAV_GROUPS: NavGroup[] = navGroups();
