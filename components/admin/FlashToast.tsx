"use client";

import { useFlashToast, type FlashRules } from "@/hooks/useFlashToast";
import { MINI_GAME_MAX_PLAYERS } from "@/lib/constants";

// The messages each admin page's server actions redirect back with. The
// admin frame renders <FlashToast />; the hook does the rest.

const ok = (text: string) => ({ text, kind: "success" as const });
const err = (text: string) => ({ text, kind: "error" as const });

// "Add offline payment" (play-day player, member): the redirect carries the
// method, or "matched" when a bank transfer was reconciled on the spot.
export function offlineAddedMessage(value: string, who: "Player" | "Member"): string {
  if (value === "matched") return `${who} added — bank transfer recorded and matched to the bank transaction.`;
  if (value === "bank_transfer") {
    return `${who} added — bank transfer recorded. It'll be matched automatically when the transaction shows up in the bank feed.`;
  }
  return `${who} added — cash payment recorded in Stripe.`;
}

const generic: FlashRules = {
  toast: (v) => (v ? ok(v) : null),
  toastError: (v) => (v ? err(v) : null),
};

const playDays: FlashRules = {
  ...generic,
  cashAdded: (v) => ok(offlineAddedMessage(v, "Player")),
  cashError: (v) => err(v),
  removed: () => ok("Player removed from the roster."),
  courtsUpdated: (v) => ok(`Courts booked updated to ${v} court${v === "1" ? "" : "s"}.`),
  courtsError: (v) => err(v),
  waitlistNotified: (v) => {
    const n = Number(v);
    return n > 0 ? ok(`Notified ${n} waitlisted player${n === 1 ? "" : "s"} that a spot opened up.`) : err("No spots available to notify the waitlist about yet.");
  },
  waitlistRemoved: () => ok("Removed from the waitlist."),
  registration: (v) =>
    v === "locked" ? ok("Registration locked — no new sign-ups for this play day.") : v === "unlocked" ? ok("Registration reopened for this play day.") : null,
  miniGame: (v) =>
    v === "on"
      ? ok(`Mini game day on — casual sign-ups closed, capped at ${MINI_GAME_MAX_PLAYERS} players. Members are included.`)
      : v === "off"
        ? ok("Mini game day off — court-based capacity is back and registration reopened.")
        : null,
  fillInSaved: () => ok("Fill-in saved and emailed the session details."),
  fillInRemoved: () => ok("Fill-in removed — the original player is back on the roster."),
  fillInError: (v) => err(v),
};

const members: FlashRules = {
  cashMemberAdded: (v) => ok(offlineAddedMessage(v, "Member")),
  cashMemberError: (v) => err(v),
};

const financials: FlashRules = {
  // Free-text success message (bank page actions).
  notice: (v) => (v ? ok(v) : null),
  saved: (v) => (v === "new" ? ok("Entry added.") : v ? ok("Changes saved.") : null),
  deleted: (v) => (v ? ok("Entry deleted.") : null),
  synced: (v) => {
    const n = Number(v);
    return ok(n > 0 ? `Synced with Stripe — ${n} new ${n === 1 ? "entry" : "entries"}.` : "Synced with Stripe — already up to date.");
  },
  financeError: (v) => (v ? err(v) : null),
};

const membersAll: FlashRules = { ...generic, ...members };
const financialsAll: FlashRules = { ...generic, ...financials };

export const FLASH_RULES = { generic, playDays, members: membersAll, financials: financialsAll } as const;

/** The messages a page's server actions can redirect back with. */
export function flashRulesFor(pathname: string): FlashRules {
  if (pathname.startsWith("/admin/play-days")) return playDays;
  if (pathname.startsWith("/admin/members")) return membersAll;
  if (pathname.startsWith("/admin/financials")) return financialsAll;
  return generic;
}

/**
 * Rendered once by the admin frame (AdminShell), not by each page: the frame
 * stays mounted across navigations, so it always sees the ?toast=… a server
 * action redirects back with. (Inside a page it could miss one when the
 * action's redirect re-rendered the page.)
 */
export function FlashToast({ pathname }: { pathname: string }) {
  useFlashToast(flashRulesFor(pathname));
  return null;
}
