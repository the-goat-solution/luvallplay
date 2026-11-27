"use client";

import { useFlashToast, type FlashRules } from "@/hooks/useFlashToast";
import { useClub } from "@/context/ClubContext";
import { err, generic, offlineAddedMessage, ok, playDaysFor } from "@/components/admin/flash-rules";
import type { Lang } from "@luvallplay/i18n";

// The messages each admin page's server actions redirect back with. The
// admin frame renders <FlashToast />; the hook does the rest.

const members: FlashRules = {
  cashMemberAdded: (v) => ok(offlineAddedMessage(v, "Member")), // translated with the Members page
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

export const FLASH_RULES = { generic, playDays: playDaysFor, members: membersAll, financials: financialsAll } as const;

/** The messages a page's server actions can redirect back with. */
export function flashRulesFor(pathname: string, miniGameMax: number, lang: Lang = "en"): FlashRules {
  if (pathname.startsWith("/admin/play-days")) return playDaysFor(miniGameMax, lang);
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
export function FlashToast({ pathname, lang = "en" }: { pathname: string; lang?: Lang }) {
  const club = useClub();
  useFlashToast(flashRulesFor(pathname, club.miniGameMaxPlayers, lang));
  return null;
}
