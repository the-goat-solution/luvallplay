import { AdminLink } from "@/components/admin/AdminLink";
import { PlainSubmitButton } from "@/components/admin/PlainSubmitButton";
import { CountBadge, kit } from "@/components/admin/kit";
import { currentAdmin } from "@/lib/admin-access";
import { adminPathAllowed } from "@/lib/admin-roles";
import { countUnreadForAdmin } from "@/lib/messages-db";
import { countPhotosNeedingReview } from "@/lib/photos-db";
import { countDisputes } from "@/lib/arena-db";
import styles from "./admin.module.css";

const TABS = [
  { href: "/admin/play-days", label: "Play days" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/players", label: "Players" },
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/shop", label: "Shop" },
  { href: "/admin/photos", label: "Photos" },
  { href: "/admin/challenges", label: "Challenges" },
  { href: "/admin/day-requests", label: "Day requests" },
  { href: "/admin/jersey", label: "Jersey" },
  { href: "/admin/financials", label: "Financials" },
  { href: "/admin/people/admins", label: "Admins" },
  { href: "/admin/platform/admins", label: "Platform" },
] as const;

export type AdminTab =
  | "play-days"
  | "members"
  | "players"
  | "inbox"
  | "shop"
  | "photos"
  | "challenges"
  | "day-requests"
  | "jersey"
  | "financials"
  | "people/admins"
  | "platform/admins";

export async function AdminNav({ active }: { active: AdminTab }) {
  const [unread, photosToReview, disputes, ctx] = await Promise.all([
    countUnreadForAdmin().catch(() => 0),
    countPhotosNeedingReview().catch(() => 0),
    countDisputes().catch(() => 0),
    currentAdmin().catch(() => null),
  ]);
  const badges: Partial<Record<string, number>> = { "/admin/inbox": unread, "/admin/photos": photosToReview, "/admin/challenges": disputes };
  // Each person sees the tabs their role opens (coaches: play-day pages).
  // Break-glass sees the club tabs, not the role pages.
  const tabs = TABS.filter((tab) =>
    ctx?.kind === "player" ? adminPathAllowed(ctx.access, tab.href) : !tab.href.startsWith("/admin/people") && !tab.href.startsWith("/admin/platform"),
  );
  const who = ctx?.kind === "player" ? `${ctx.player.firstName} ${ctx.player.lastName}`.trim() || ctx.player.email : null;
  return (
    <nav className={styles.nav}>
      <div className={styles.tabs}>
        {tabs.map((tab) => {
          const isActive = tab.href === `/admin/${active}`;
          return (
            <AdminLink
              key={tab.href}
              href={tab.href}
              current={isActive}
              prefetchShell
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              style={{ marginBottom: -1 }}
            >
              {tab.label}
              <CountBadge n={badges[tab.href] ?? 0} />
            </AdminLink>
          );
        })}
      </div>
      <div className={styles.extras}>
        <a href="/casual-play" target="_blank" rel="noopener" className={styles.extraLink}>
          Court board ↗
        </a>
        {ctx?.kind === "player" ? (
          // Signed in as yourself: admin is part of your account, so the way
          // out is back to your profile (sign out lives in Settings).
          <a href="/profile" className={styles.extraLink}>
            {who} · My profile
          </a>
        ) : (
          // Break-glass: a plain form post, so logging out still works when the
          // session is already broken (no JavaScript, no valid cookie needed).
          <form method="POST" action="/api/admin-logout">
            <PlainSubmitButton loadingText="Logging out…" className={kit.btnSecondary}>
              Log out
            </PlainSubmitButton>
          </form>
        )}
      </div>
    </nav>
  );
}
