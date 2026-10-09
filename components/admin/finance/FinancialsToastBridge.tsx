"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/context/ToastContext";

const TOAST_PARAMS = ["saved", "deleted", "synced", "notice", "financeError"] as const;

// Server actions on the Financials page redirect back with one of these
// params; this turns it into a toast and strips it so a refresh doesn't
// re-fire it. Mirrors MembersToastBridge / PlayDaysToastBridge.
export function FinancialsToastBridge() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();

  useEffect(() => {
    const saved = searchParams.get("saved");
    const deleted = searchParams.get("deleted");
    const synced = searchParams.get("synced");
    const error = searchParams.get("financeError");
    // Free-text success message (bank page actions).
    const notice = searchParams.get("notice");
    if (notice) showToast(notice, "success");

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

    if (saved || deleted || synced !== null || error || notice) {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of TOAST_PARAMS) params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [searchParams, showToast, router, pathname]);

  return null;
}
