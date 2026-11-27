"use client";

import k from "@/components/admin/kit/kit.module.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import { useAdminText } from "@/components/admin/AdminLang";

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
  const { t } = useAdminText();
  const [busy, setBusy] = useState(false);
  const showBusy = useDelayedLoading(busy);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState<string | null>(null);

  const confirmText = !recurring
    ? t("mem_free_confirm_onetime", { name: memberName, current: periodEnd ? t("mem_free_confirm_onetime_current", { date: periodEnd }) : "" })
    : plan === "quarterly"
      ? t("mem_free_confirm_quarter", { name: memberName, ends: periodEnd ? t("mem_free_confirm_quarter_ends", { date: periodEnd }) : "" })
      : t("mem_free_confirm_month", { name: memberName, date: periodEnd ? t("mem_free_confirm_month_date", { date: periodEnd }) : "" });

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
        window.location.assign(new URL(`/login?stepup=1&next=${encodeURIComponent(window.location.pathname)}`, window.location.origin));
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("mem_free_err"));
      setSucceeded(
        data.kind === "extended"
          ? t("mem_free_done_extended", { date: data.periodEnd })
          : data.kind === "deferred"
            ? t("mem_free_done_deferred", { date: data.billingResumes })
            : t("mem_free_done_waived"),
      );
      setBusy(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("mem_free_err"));
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
            {t("mem_free_applying")}
          </>
        ) : (
          t("mem_free_btn")
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
