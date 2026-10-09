"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/context/ToastContext";

const TOAST_PARAMS = ["saved", "deleted", "synced", "financeError"] as const;

// Server actions on the Financials page redirect back with one of these
// params; this turns it into a toast and strips it so a refresh doesn't
// re-fire it. Mirrors MembersToastBridge / PlayDaysToastBridge.
export function FinancialsToastBridge() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    const saved = searchParams.get("saved");
    const deleted = searchParams.get("deleted");
    const synced = searchParams.get("synced");
    const error = searchParams.get("financeError");

    if (saved === "new") showToast("Entry added.", "success");
    else if (saved) showToast("Changes saved.", "success");
    if (deleted) showToast("Entry deleted.", "success");
    if (synced !== null) {
      const n = Number(synced);
      showToast(
        n > 0 ? `Synced with Stripe — ${n} new ${n === 1 ? "entry" : "entries"}.` : "Synced with Stripe — already up to date.",
        "success",
      );
    }
    if (error) showToast(error, "error");

    if (saved || deleted || synced !== null || error) {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of TOAST_PARAMS) params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/admin/financials?${qs}` : "/admin/financials", { scroll: false });
    }
  }, [searchParams, showToast, router]);

  return null;
}
