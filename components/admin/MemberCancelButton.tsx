"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MemberCancelButton({
  membershipId,
  memberName,
}: {
  membershipId: number;
  memberName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (
      !window.confirm(
        `Cancel ${memberName}'s membership at the end of their current billing period?`,
      )
    ) {
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
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel");
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
        }}
      >
        {busy ? "Canceling…" : "Cancel"}
      </button>
      {error && <div style={{ color: "#b00020", fontSize: 11, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
