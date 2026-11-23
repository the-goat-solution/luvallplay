// The admin menu: every page, grouped by what the club is doing. One place
// to add, rename or hide a page. Each person only sees the pages their role
// opens (AdminSidebar filters with adminPathAllowed).
//
// Keep `href: "/admin/..."` written out literally: tests/phase1-rules.test.ts
// reads this file and checks every href against the permission matrix.

import type { AttentionKey } from "@/lib/admin-attention";

export type BadgeKey = AttentionKey;

export type NavItem = {
  href: string;
  label: string;
  badge?: BadgeKey;
  /** Extra paths that count as this page (sub-pages, old URLs). */
  match?: string[];
  /** Only this exact path counts (the admin home, which every page is under). */
  exact?: boolean;
};

/** A group with an empty label shows its items without a heading. */
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  { label: "", items: [{ href: "/admin", label: "Today", exact: true }] },
  {
    label: "Play",
    items: [
      { href: "/admin/play-days", label: "Play days" },
      { href: "/admin/play-days/schedule", label: "Schedule", badge: "dayRequests", match: ["/admin/day-requests"] },
      { href: "/admin/challenges", label: "Arena", badge: "disputes" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/admin/members", label: "Members", badge: "members" },
      { href: "/admin/players", label: "Players", badge: "checkins" },
      { href: "/admin/inbox", label: "Inbox", badge: "inbox" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/admin/financials", label: "Ledger" },
      { href: "/admin/financials/bank", label: "Bank", badge: "bank" },
      { href: "/admin/financials/report", label: "Annual report" },
      { href: "/admin/shop", label: "Shop", badge: "shop" },
    ],
  },
  {
    label: "Club",
    items: [
      { href: "/admin/photos", label: "Photos", badge: "photos" },
      { href: "/admin/people/admins", label: "Admins" },
      { href: "/admin/platform/admins", label: "Platform staff" },
      { href: "/admin/setup", label: "System check", match: ["/admin/device-check"] },
    ],
  },
];

/** Is this menu item the current page? The longest matching href wins, so
 * /admin/financials/bank lights up Bank, not Ledger. */
export function activeHref(pathname: string, groups: NavGroup[] = NAV_GROUPS): string | null {
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
