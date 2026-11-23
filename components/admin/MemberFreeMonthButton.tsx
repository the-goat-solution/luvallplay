"use client";

import k from "@/components/admin/kit/kit.module.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";

// Gives any active member a free month (e.g. a competition prize). What
// that means depends on the membership — see app/api/admin/free-month:
// one-time gets 4 more weeks, recurring monthly gets its next renewal free,
// recurring quarterly gets 4 free weeks before its next charge.
export function MemberFreeMonthButton({
  membershipId,
  memberName,
  periodEnd,
  plan,
  recurring,
}: {
  membershipId: number;
  memberName: string;
  periodEnd: string | null;
  plan: "monthly" | "quarterly";
  recurring: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const showBusy = useDelayedLoading(busy);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState<string | null>(null);

  const confirmText = !recurring
    ? `Give ${memberName} a free month? 4 weeks will be added to the end of their membership${periodEnd ? ` (currently ${periodEnd})` : ""}.`
    : plan === "quarterly"
      ? `Give ${memberName} a free month? They get 4 free weeks after their current quarter${periodEnd ? ` (ends ${periodEnd})` : ""}, then quarterly billing carries on.`
      : `Give ${memberName} their next month free? Their next renewal${periodEnd ? ` (${periodEnd})` : ""} won't be charged, and normal billing resumes the month after.`;

  const onClick = async () => {
    if (
      !window.confirm(confirmText)
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setSucceeded(null);
    try {
      const res = await fetch("/api/admin/free-month", {
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
      if (!res.ok) throw new Error(data.error ?? "Failed to give a free month");
      setSucceeded(
        data.kind === "extended"
          ? `Done — membership now ends ${data.periodEnd}.`
          : data.kind === "deferred"
            ? `Done — next charge moved to ${data.billingResumes}.`
            : "Done — their next renewal won't be charged.",
      );
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
        className={k.btnSecondary}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
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
          {succeeded}
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
