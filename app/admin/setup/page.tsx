import { AdminNav } from "@/components/admin/AdminNav";
import { AdminLink } from "@/components/admin/AdminLink";
import adminStyles from "@/components/admin/admin.module.css";
import { card, pill } from "@/components/admin/ui";
import { runSetupChecks, type CheckStatus } from "@/lib/setup-check";

export const dynamic = "force-dynamic";

const LOOK: Record<CheckStatus, [string, string, string]> = {
  ok: ["Working", "#e9f6ee", "#1d6b3d"],
  warn: ["Check", "#fff4e5", "#8a4b00"],
  fail: ["Needs fixing", "#fdecec", "#a12a2a"],
  off: ["Switched off", "#eee", "#555"],
};

// Live test of everything player accounts rely on. Step-by-step set-up:
// docs/SETUP-player-accounts.md.
export default async function SetupCheckPage() {
  const checks = process.env.POSTGRES_URL ? await runSetupChecks() : [];
  const areas = [...new Set(checks.map((c) => c.area))];
  const failing = checks.filter((c) => c.status === "fail").length;
  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Setup check</h1>
      <p className={adminStyles.subtitle}>
        Tests each service player accounts use, live. {failing ? `${failing} thing${failing === 1 ? "" : "s"} need fixing.` : "Nothing is broken."} “Switched
        off” items are optional: the site works without them. Step-by-step instructions are in <code>docs/SETUP-player-accounts.md</code>.
      </p>
      <AdminNav active="players" />
      <p style={{ marginTop: 0 }}>
        <AdminLink href="/admin/players">← Players</AdminLink>
      </p>
      {!process.env.POSTGRES_URL && <p>Database is not configured.</p>}
      {areas.map((area) => (
        <section key={area} style={card}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>{area}</h2>
          {checks
            .filter((c) => c.area === area)
            .map((c) => {
              const [label, bg, color] = LOOK[c.status];
              return (
                <div key={c.name} style={{ borderTop: "1px solid #eee", padding: "10px 0", fontSize: 14 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{c.name}</strong>
                    <span style={pill(bg, color)}>{label}</span>
                  </div>
                  <div style={{ color: "#555", marginTop: 4 }}>{c.detail}</div>
                  {c.fix && c.status !== "ok" && <div style={{ color: "#8a4b00", marginTop: 4 }}>→ {c.fix}</div>}
                </div>
              );
            })}
        </section>
      ))}
    </div>
  );
}
