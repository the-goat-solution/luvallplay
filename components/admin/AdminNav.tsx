import { AdminLink } from "@/components/admin/AdminLink";
import { PlainSubmitButton } from "@/components/admin/PlainSubmitButton";

const TABS = [
  { href: "/admin/play-days", label: "Play days" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/financials", label: "Financials" },
] as const;

export function AdminNav({
  active,
}: {
  active: "play-days" | "members" | "financials";
}) {
  return (
    <nav
      style={{
        display: "flex",
        gap: 4,
        marginBottom: 24,
        borderBottom: "1px solid #ddd",
        alignItems: "center",
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.href.endsWith(active);
        return (
          <AdminLink
            key={tab.href}
            href={tab.href}
            current={isActive}
            prefetchShell
            style={{
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 600,
              color: isActive ? "#1a2a4a" : "#888",
              borderBottom: isActive ? "2px solid #1a2a4a" : "2px solid transparent",
              marginBottom: -1,
              textDecoration: "none",
            }}
          >
            {tab.label}
          </AdminLink>
        );
      })}
      <a
        href="/casual-play"
        target="_blank"
        rel="noopener"
        style={{
          marginLeft: "auto",
          padding: "10px 16px",
          fontSize: 14,
          fontWeight: 600,
          color: "#888",
          textDecoration: "none",
        }}
      >
        Court board ↗
      </a>
      {/* A plain form post, so logging out still works when the session is
          already broken — no JavaScript and no valid cookie required. */}
      <form
        method="POST"
        action="/api/admin-logout"
        style={{ paddingBottom: 6 }}
      >
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
          }}
        >
          Log out
        </PlainSubmitButton>
      </form>
    </nav>
  );
}
