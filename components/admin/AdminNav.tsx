const TABS = [
  { href: "/admin/play-days", label: "Play days" },
  { href: "/admin/members", label: "Members" },
] as const;

export function AdminNav({ active }: { active: "play-days" | "members" }) {
  return (
    <nav style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid #ddd" }}>
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
    </nav>
  );
}
