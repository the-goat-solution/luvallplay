const TABS = [
  { href: "/admin/play-days", label: "Play days" },
  { href: "/admin/members", label: "Members" },
] as const;

export function AdminNav({ active }: { active: "play-days" | "members" }) {
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
          <a
            key={tab.href}
            href={tab.href}
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
          </a>
        );
      })}
      {/* A plain form post, so logging out still works when the session is
          already broken — no JavaScript and no valid cookie required. */}
      <form
        method="POST"
        action="/api/admin-logout"
        style={{ marginLeft: "auto", paddingBottom: 6 }}
      >
        <button
          type="submit"
          style={{
            padding: "5px 12px",
            borderRadius: 6,
            border: "1px solid #ccc",
            background: "#fff",
            color: "#555",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Log out
        </button>
      </form>
    </nav>
  );
}
