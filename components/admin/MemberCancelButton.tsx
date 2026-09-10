"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";

export function MemberCancelButton({
  membershipId,
  memberName,
  mode = "cancel",
}: {
  membershipId: number;
  memberName: string;
  // "cancel" schedules a recurring member's Stripe subscription to stop
  // renewing at period end (existing behavior). "remove" is for cash
  // (non-recurring) members, who have no subscription to schedule against —
  // it deactivates the membership immediately, freeing their spot right away.
  mode?: "cancel" | "remove";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const showBusy = useDelayedLoading(busy);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    const confirmMessage =
      mode === "remove"
        ? `Remove ${memberName}'s membership? This takes effect immediately and frees their spot right away.`
        : `Cancel ${memberName}'s membership at the end of their current billing period?`;
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cancel-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error ?? `Failed to ${mode === "remove" ? "remove" : "cancel"}`);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : `Failed to ${mode === "remove" ? "remove" : "cancel"}`,
      );
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
          border: "1px solid #b00020",
          background: "#fff",
          color: "#b00020",
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
            {mode === "remove" ? "Removing…" : "Canceling…"}
          </>
        ) : mode === "remove" ? (
          "Remove"
        ) : (
          "Cancel"
        )}
      </button>
      {error && <div style={{ color: "#b00020", fontSize: 11, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
