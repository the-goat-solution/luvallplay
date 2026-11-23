import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/shell/AdminShell";
import { NAV_GROUPS, type BadgeKey, type NavGroup } from "@/components/admin/nav-config";
import { canOpenAdminPage, currentAdmin } from "@/lib/admin-access";
import { attentionCount } from "@/lib/admin-attention";

// Every admin page (except the break-glass login and the app handoff) sits
// in this frame: the grouped sidebar, badges for what needs attention, and
// the way back to your profile.
export default async function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const ctx = await currentAdmin().catch(() => null);
  // Each person sees the pages their role opens (coaches: play pages).
  const allowed = (href: string) => canOpenAdminPage(ctx, href);
  const groups: NavGroup[] = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i.href)) })).filter(
    (g) => g.items.length > 0,
  );

  // Only count what this person can open; a failing count just hides its badge.
  const shown = new Set(groups.flatMap((g) => g.items.map((i) => i.badge)).filter(Boolean) as BadgeKey[]);
  const entries = await Promise.all([...shown].map(async (key) => [key, await attentionCount(key)] as const));
  const badges = Object.fromEntries(entries) as Partial<Record<BadgeKey, number>>;

  const who =
    ctx?.kind === "player" ? `${ctx.player.firstName} ${ctx.player.lastName}`.trim() || ctx.player.email : null;

  return (
    <AdminShell groups={groups} badges={badges} who={who}>
      {children}
    </AdminShell>
  );
}
