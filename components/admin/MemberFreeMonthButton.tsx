"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";

// Makes a monthly member's next renewal free (e.g. a competition prize)
// without touching their subscription otherwise — they stay active, aren't
// charged on their next renewal date, and billing resumes the month after.
export function MemberFreeMonthButton({
  membershipId,
  memberName,
  renewsOn,
}: {
  membershipId: number;
  memberName: string;
  renewsOn: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const showBusy = useDelayedLoading(busy);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const onClick = async () => {
    if (
      !window.confirm(
        `Give ${memberName} their next month free? Their next renewal${renewsOn ? ` (${renewsOn})` : ""} won't be charged, and normal billing resumes the month after.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setSucceeded(false);
    try {
      const res = await fetch("/api/admin/free-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId }),
      });
      // The session can lapse while this page sits open. Send them to the
      // login page rather than showing an "Unauthorized" they can't act on.
      if (res.status === 401) {
        window.location.href = "/admin/login?expired=1";
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to give a free month");
      setSucceeded(true);
      setBusy(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to give a free month");
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          padding: "5px 12px",
          borderRadius: 6,
          border: "1px solid #1a7a3c",
          background: "#fff",
          color: "#1a7a3c",
          fontSize: 12,
          fontWeight: 600,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {showBusy ? (
          <>
            <LoadingIcon size="sm" />
            Applying…
          </>
        ) : (
          "Give free month"
        )}
      </button>
      {succeeded ? (
        <div style={{ marginTop: 6, color: "#1a7a3c", fontSize: 11, maxWidth: 220 }}>
          Done — their next renewal won&apos;t be charged.
        </div>
      ) : null}
      {error && (
        <div style={{ color: "#b00020", fontSize: 11, marginTop: 4, maxWidth: 220 }}>
          {error}
        </div>
      )}
    </div>
  );
}
