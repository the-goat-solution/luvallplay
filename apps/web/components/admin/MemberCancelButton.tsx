"use client";

import k from "@/components/admin/kit/kit.module.css";
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
        ? `End ${memberName}'s membership now? It ends today and their spot is freed straight away. No refund is made here.`
        : `Stop ${memberName}'s membership from renewing? They keep playing until the end of the period they've paid for, then it ends.`;
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
      // The session can lapse while this page sits open. Send them to the
      // login page rather than showing an "Unauthorized" they can't act on.
      if (res.status === 401) {
        window.location.href = `/login?stepup=1&next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
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
        className={k.btnDanger}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        {showBusy ? (
          <>
            <LoadingIcon size="sm" />
            {mode === "remove" ? "Ending…" : "Stopping…"}
          </>
        ) : mode === "remove" ? (
          "End now"
        ) : (
          "Stop renewing"
        )}
      </button>
      {error && <div style={{ color: "#b00020", fontSize: 11, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
