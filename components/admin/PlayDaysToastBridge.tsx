"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/context/ToastContext";

const TOAST_PARAMS = [
  "cashAdded",
  "cashError",
  "removed",
  "courtsUpdated",
  "courtsError",
] as const;

// Every admin action on the play-days page redirects back with one of these
// query params (server actions can't call client-side toast code directly).
// This bridges that redirect into a toast, then strips the param so a
// refresh doesn't re-fire it.
export function PlayDaysToastBridge() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    const cashAdded = searchParams.get("cashAdded");
    const cashError = searchParams.get("cashError");
    const removed = searchParams.get("removed");
    const courtsUpdated = searchParams.get("courtsUpdated");
    const courtsError = searchParams.get("courtsError");

    if (cashAdded) showToast("Cash player added and recorded in Stripe.", "success");
    if (cashError) showToast(cashError, "error");
    if (removed) showToast("Player removed from the roster.", "success");
    if (courtsUpdated) {
      showToast(
        `Courts booked updated to ${courtsUpdated} court${courtsUpdated === "1" ? "" : "s"}.`,
        "success",
      );
    }
    if (courtsError) showToast(courtsError, "error");

    if (cashAdded || cashError || removed || courtsUpdated || courtsError) {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of TOAST_PARAMS) params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/admin/play-days?${qs}` : "/admin/play-days", { scroll: false });
    }
  }, [searchParams, showToast, router]);

  return null;
}
