"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/context/ToastContext";
import { MINI_GAME_MAX_PLAYERS } from "@/lib/constants";

// Toast for the "Add offline payment" actions (play-day player, member):
// the redirect carries the method, or "matched" when a bank transfer was
// reconciled against the bank feed on the spot.
export function offlineAddedMessage(value: string, who: "Player" | "Member"): string {
  if (value === "matched") {
    return `${who} added — bank transfer recorded and matched to the bank transaction.`;
  }
  if (value === "bank_transfer") {
    return `${who} added — bank transfer recorded. It'll be matched automatically when the transaction shows up in the bank feed.`;
  }
  return `${who} added — cash payment recorded in Stripe.`;
}

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
  "miniGame",
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
    const miniGame = searchParams.get("miniGame");

    if (cashAdded) showToast(offlineAddedMessage(cashAdded, "Player"), "success");
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
    if (miniGame === "on") {
      showToast(
        `Mini game day on — registration locked and capped at ${MINI_GAME_MAX_PLAYERS} players.`,
        "success",
      );
    }
    if (miniGame === "off") {
      showToast("Mini game day off — court-based capacity is back and registration reopened.", "success");
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
      fillInError ||
      registration ||
      miniGame
    ) {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of TOAST_PARAMS) params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/admin/play-days?${qs}` : "/admin/play-days", { scroll: false });
    }
  }, [searchParams, showToast, router]);

  return null;
}
