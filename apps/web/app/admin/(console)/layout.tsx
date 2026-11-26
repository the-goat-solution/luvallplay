import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/shell/AdminShell";
import type { BadgeKey } from "@/components/admin/nav-config";
import { navGroups } from "@/components/admin/nav-registry";
import { canOpenAdminPage, currentAdmin } from "@/lib/admin-access";
import { attentionCount } from "@/lib/admin-attention";
import { enabledModules } from "@/lib/club-modules";
import { sql } from "@/lib/database";
import { blockedByModule } from "@luvallplay/modules";

// Every admin page (except the app handoff) sits
// in this frame: the grouped sidebar, badges for what needs attention, and
// the way back to your profile.
export default async function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const ctx = await currentAdmin().catch(() => null);
  // Each person sees the pages their role opens (coaches: play pages).
  // …and only pages whose module is switched on for the club.
  const modulesOn = await enabledModules(sql);
  const allowed = (href: string) => canOpenAdminPage(ctx, href) && !blockedByModule(href, modulesOn);
  // The menu comes from the module registry (components/admin/nav-config.ts).
  const groups = navGroups((item) => allowed(item.href));

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
