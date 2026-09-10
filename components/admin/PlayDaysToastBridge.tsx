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
  "waitlistNotified",
  "waitlistRemoved",
  "wedCourtsUpdated",
  "wedCourtsSkipped",
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
    const waitlistNotified = searchParams.get("waitlistNotified");
    const waitlistRemoved = searchParams.get("waitlistRemoved");
    const wedCourtsUpdated = searchParams.get("wedCourtsUpdated");
    const wedCourtsSkipped = searchParams.get("wedCourtsSkipped");

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
    if (waitlistNotified) {
      const n = Number(waitlistNotified);
      showToast(
        n > 0
          ? `Notified ${n} waitlisted player${n === 1 ? "" : "s"} that a spot opened up.`
          : "No spots available to notify the waitlist about yet.",
        n > 0 ? "success" : "error",
      );
    }
    if (waitlistRemoved) showToast("Removed from the waitlist.", "success");
    if (wedCourtsUpdated !== null) {
      const u = Number(wedCourtsUpdated);
      const s = Number(wedCourtsSkipped ?? "0");
      showToast(
        u === 0 && s === 0
          ? "No upcoming Wednesday sessions needed updating."
          : `Fixed ${u} Wednesday session${u === 1 ? "" : "s"} to 1 court${s > 0 ? ` (${s} left unchanged — already over capacity)` : ""}.`,
        "success",
      );
    }

    if (
      cashAdded ||
      cashError ||
      removed ||
      courtsUpdated ||
      courtsError ||
      waitlistNotified ||
      waitlistRemoved ||
      wedCourtsUpdated
    ) {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of TOAST_PARAMS) params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/admin/play-days?${qs}` : "/admin/play-days", { scroll: false });
    }
  }, [searchParams, showToast, router]);

  return null;
}
