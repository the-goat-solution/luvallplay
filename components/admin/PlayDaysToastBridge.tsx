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
  "fillInSaved",
  "fillInRemoved",
  "fillInError",
  "registration",
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
    const fillInSaved = searchParams.get("fillInSaved");
    const fillInRemoved = searchParams.get("fillInRemoved");
    const fillInError = searchParams.get("fillInError");
    const registration = searchParams.get("registration");

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
    if (registration === "locked") {
      showToast("Registration locked — no new sign-ups for this play day.", "success");
    }
    if (registration === "unlocked") {
      showToast("Registration reopened for this play day.", "success");
    }
    if (fillInSaved) showToast("Fill-in saved and emailed the session details.", "success");
    if (fillInRemoved) showToast("Fill-in removed — the original player is back on the roster.", "success");
    if (fillInError) showToast(fillInError, "error");

    if (
      cashAdded ||
      cashError ||
      removed ||
      courtsUpdated ||
      courtsError ||
      waitlistNotified ||
      waitlistRemoved ||
      fillInSaved ||
      fillInRemoved ||
      fillInError
    ) {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of TOAST_PARAMS) params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/admin/play-days?${qs}` : "/admin/play-days", { scroll: false });
    }
  }, [searchParams, showToast, router]);

  return null;
}
