import type { Viewport } from "next";
import adminStyles from "@/components/admin/admin.module.css";
import { Badge, EmptyState, PageHeader, Section, Tabs, kit, type BadgeTone } from "@/components/admin/kit";
import { DeviceCheck } from "@/components/admin/DeviceCheck";
import { runSetupChecks, type CheckStatus } from "@/lib/setup-check";
import { photoStorageBytes } from "@/lib/photos-db";
import { publicBlobConfigured } from "@/lib/public-blob";

export const dynamic = "force-dynamic";

// Same viewport settings as the profile app, so "This device" reports the
// numbers the app sees.
export const viewport: Viewport = { viewportFit: "cover", themeColor: "#0e2c3f" };

const LOOK: Record<CheckStatus, { label: string; tone: BadgeTone }> = {
  ok: { label: "Working", tone: "good" },
  warn: { label: "Check", tone: "warn" },
  fail: { label: "Needs fixing", tone: "bad" },
  off: { label: "Switched off", tone: "default" },
};

const STORAGE_FREE_BYTES = 1024 * 1024 * 1024;

// System check: a live test of every service the site relies on (step-by-
// step set-up: docs/SETUP-player-accounts.md), and what this device reports.
export default async function SystemCheckPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: tabParam } = await searchParams;
  const tab = tabParam === "device" ? "device" : "services";
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const [checks, used] = tab === "services" && hasDb ? await Promise.all([runSetupChecks(), photoStorageBytes().catch(() => null)]) : [[], null];
  const areas = [...new Set(checks.map((c) => c.area))];
  const failing = checks.filter((c) => c.status === "fail").length;
  const pct = used === null ? null : Math.round((used / STORAGE_FREE_BYTES) * 100);

  return (
    <div className={adminStyles.page}>
      <PageHeader
        title="System check"
        subtitle="Live tests of the services the site relies on, and what this phone or computer reports. For whoever looks after the website."
      />
      <Tabs
        label="System check"
        current={tab}
        items={[
          { key: "services", label: "Services", href: "/admin/setup", count: tab === "services" ? failing : undefined },
          { key: "device", label: "This device", href: "/admin/setup?tab=device" },
        ]}
      />

      {tab === "device" ? (
        <>
          <p className={kit.muted} style={{ fontSize: 13, marginTop: 0 }}>
            Open this on a phone, tablet or foldable (or in Xcode&apos;s iPhone simulator) to see exactly what the website gets: size, safe areas, whether a
            fold is reported, and whether it&apos;s running as a home-screen app. Fold, unfold and rotate: it updates live.
          </p>
          <DeviceCheck />
        </>
      ) : !hasDb ? (
        <EmptyState>Database is not configured.</EmptyState>
      ) : (
        <>
          <p className={kit.muted} style={{ fontSize: 13, marginTop: 0 }}>
            {failing ? `${failing} thing${failing === 1 ? "" : "s"} need fixing.` : "Nothing is broken."} &ldquo;Switched off&rdquo; items are optional: the
            site works without them. Step-by-step set-up is in <code>docs/SETUP-player-accounts.md</code>.
          </p>
          <Section title="Photo storage">
            <div className={kit.rowActions}>
              {pct === null ? <Badge>Unknown</Badge> : <Badge tone={pct > 70 ? "warn" : "good"}>{pct}% of the free 1 GB used</Badge>}
              {!publicBlobConfigured() && <Badge tone="bad">Photo sharing off</Badge>}
              {process.env.GOOGLE_VISION_ENABLED !== "1" && <Badge tone="warn">Safety check off</Badge>}
            </div>
            <p className={kit.muted} style={{ fontSize: 13, marginBottom: 0 }}>
              {pct !== null && pct > 70 ? "Time to move photos to Cloudflare R2 (10 GB free): see the README. " : ""}
              {!publicBlobConfigured() ? "Photo sharing stays off until the public Blob store is connected (prefix PHOTO). " : ""}
              {process.env.GOOGLE_VISION_ENABLED !== "1"
                ? "Google SafeSearch is off (GOOGLE_VISION_ENABLED), so every shared photo waits for review on the Photos page."
                : "Google SafeSearch checks every shared photo."}
            </p>
          </Section>
          {areas.map((area) => (
            <Section key={area} title={area}>
              {checks
                .filter((c) => c.area === area)
                .map((c) => (
                  <div key={c.name} style={{ borderTop: "1px solid #eee", padding: "10px 0", fontSize: 14 }}>
                    <div className={kit.rowActions}>
                      <strong>{c.name}</strong>
                      <Badge tone={LOOK[c.status].tone}>{LOOK[c.status].label}</Badge>
                    </div>
                    <div style={{ color: "#555", marginTop: 4 }}>{c.detail}</div>
                    {c.fix && c.status !== "ok" && <div style={{ color: "#8a4b00", marginTop: 4 }}>→ {c.fix}</div>}
                  </div>
                ))}
            </Section>
          ))}
        </>
      )}
    </div>
  );
}
