import { AdminLink } from "@/components/admin/AdminLink";
import { PlainSubmitButton } from "@/components/admin/PlainSubmitButton";
import styles from "./admin.module.css";

const TABS = [
  { href: "/admin/play-days", label: "Play days" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/day-requests", label: "Day requests" },
  { href: "/admin/financials", label: "Financials" },
] as const;

export function AdminNav({
  active,
}: {
  active: "play-days" | "members" | "day-requests" | "financials";
}) {
  return (
    <nav className={styles.nav}>
      <div className={styles.tabs}>
        {TABS.map((tab) => {
          const isActive = tab.href.endsWith(active);
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
