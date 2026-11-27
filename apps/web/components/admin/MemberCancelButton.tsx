"use client";

import k from "@/components/admin/kit/kit.module.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import { useAdminText } from "@/components/admin/AdminLang";

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
  const { t } = useAdminText();
  const [busy, setBusy] = useState(false);
  const showBusy = useDelayedLoading(busy);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    const confirmMessage =
      mode === "remove" ? t("mem_confirm_end", { name: memberName }) : t("mem_confirm_stop", { name: memberName });
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
        // "step_up": cancelling needs a code entered in the last five minutes (H8).
        const kind = ((await res.json().catch(() => null)) as { scope?: string } | null)?.scope === "action" ? "action" : "1";
        window.location.assign(new URL(`/login?stepup=${kind}&next=${encodeURIComponent(window.location.pathname)}`, window.location.origin));
        return;
      }
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error ?? (mode === "remove" ? t("mem_err_remove") : t("mem_err_cancel")));
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : mode === "remove" ? t("mem_err_remove") : t("mem_err_cancel"),
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
            {mode === "remove" ? t("mem_btn_ending") : t("mem_btn_stopping")}
          </>
        ) : mode === "remove" ? (
          t("mem_btn_end_now")
        ) : (
          t("mem_btn_stop_renewing")
        )}
      </button>
      {error && <div style={{ color: "#b00020", fontSize: 11, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
