import { AdminLink } from "@/components/admin/AdminLink";
import { PlainSubmitButton } from "@/components/admin/PlainSubmitButton";
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
  | "financials";

const badgeStyle = {
  display: "inline-block",
  minWidth: 18,
  marginLeft: 6,
  padding: "0 6px",
  borderRadius: 9,
  background: "#d64545",
  color: "#fff",
  fontSize: 11,
  lineHeight: "18px",
  textAlign: "center",
} as const;

export async function AdminNav({ active }: { active: AdminTab }) {
  const [unread, photosToReview, disputes] = await Promise.all([
    countUnreadForAdmin().catch(() => 0),
    countPhotosNeedingReview().catch(() => 0),
    countDisputes().catch(() => 0),
  ]);
  const badges: Partial<Record<string, number>> = { "/admin/inbox": unread, "/admin/photos": photosToReview, "/admin/challenges": disputes };
  return (
    <nav className={styles.nav}>
      <div className={styles.tabs}>
        {TABS.map((tab) => {
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
              {(badges[tab.href] ?? 0) > 0 && <span style={badgeStyle}>{badges[tab.href]}</span>}
            </AdminLink>
          );
        })}
      </div>
      <div className={styles.extras}>
        <a href="/casual-play" target="_blank" rel="noopener" className={styles.extraLink}>
          Court board ↗
        </a>
        {/* A plain form post, so logging out still works when the session is
            already broken — no JavaScript and no valid cookie required. */}
        <form method="POST" action="/api/admin-logout">
          <PlainSubmitButton
            loadingText="Logging out…"
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              border: "1px solid #ccc",
              background: "#fff",
              color: "#555",
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            Log out
          </PlainSubmitButton>
        </form>
      </div>
    </nav>
  );
}
