"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import type { StripeSyncReport } from "@/lib/stripe-sync";

// Runs the membership ⇄ Stripe sync on demand and shows what it changed.
export function StripeSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const showBusy = useDelayedLoading(busy);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<StripeSyncReport | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/admin/stripe-sync", { method: "POST" });
      if (res.status === 401) {
        window.location.href = "/admin/login?expired=1";
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Sync failed");
      setReport(data.report);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        style={{
          padding: "6px 12px",
          borderRadius: 6,
          border: "1px solid #1a2a4a",
          background: "#1a2a4a",
          color: "#fff",
          fontSize: 13,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {showBusy ? (
          <>
            <LoadingIcon size="sm" />
            Syncing with Stripe…
          </>
        ) : (
          "Sync with Stripe now"
        )}
      </button>
      <span style={{ marginLeft: 10, fontSize: 12, color: "#666" }}>
        Also runs automatically every day.
      </span>
      {error && (
        <p style={{ color: "#b00020", fontSize: 13, marginTop: 8 }}>{error}</p>
      )}
      {report && (
        <div
          role="status"
          style={{
            marginTop: 10,
            background: "#eef2f7",
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 13,
            color: "#1a2a4a",
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>
            Checked {report.checked} membership{report.checked === 1 ? "" : "s"} against
            Stripe —{" "}
            {report.changed.length === 0
              ? "everything already matched."
              : `fixed ${report.changed.length}:`}
          </p>
          {report.changed.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {report.changed.map((c) => (
                <li key={c.membershipId}>
                  <strong>{c.name}</strong> ({c.email}): {c.changes.join("; ")}
                </li>
              ))}
            </ul>
          )}
          {report.issues.length > 0 && (
            <>
              <p style={{ margin: "10px 0 0", fontWeight: 600, color: "#8a4b00" }}>
                Needs a look ({report.issues.length}):
              </p>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#8a4b00" }}>
                {report.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </>
          )}
          {report.errors > 0 && (
            <p style={{ margin: "10px 0 0", color: "#b00020" }}>
              {report.errors} couldn&apos;t be checked (Stripe error) — try again shortly.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
