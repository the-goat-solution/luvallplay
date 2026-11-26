// The admin menu's shape, for the shell (a client component). The menu has no
// list of its own: every page is declared by the module that owns it
// (packages/modules/src/registry.ts, `admin.nav`) and generated from that
// registry on the server, in components/admin/nav-registry.ts.
//
// To add, rename or move a page, edit its module's manifest.

import type { AdminMenuItem } from "@luvallplay/modules";
import type { AttentionKey } from "@/lib/admin-attention";

export type BadgeKey = AttentionKey;

export type NavItem = Omit<AdminMenuItem, "badge"> & { badge?: BadgeKey };

/** A group with an empty label shows its items without a heading. */
export type NavGroup = { label: string; items: NavItem[] };

/** Is this menu item the current page? The longest matching href wins, so
 * /admin/financials/bank lights up Bank, not Ledger. */
export function activeHref(pathname: string, groups: NavGroup[]): string | null {
  let best: { href: string; len: number } | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    for (const p of [item.href, ...(item.match ?? [])]) {
      const hit = pathname === p || (!item.exact && pathname.startsWith(`${p}/`));
      if (hit && (!best || p.length > best.len)) {
        best = { href: item.href, len: p.length };
      }
    }
  }
  return best?.href ?? null;
}
