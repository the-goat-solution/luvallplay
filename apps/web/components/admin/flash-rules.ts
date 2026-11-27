// The play-day toasts, as plain functions so tests can load them
// (FlashToast.tsx is a client component).
import type { FlashRules } from "@/hooks/useFlashToast";
import { at } from "@luvallplay/i18n/admin";
import type { Lang } from "@luvallplay/i18n";

export const ok = (text: string) => ({ text, kind: "success" as const });
export const err = (text: string) => ({ text, kind: "error" as const });

// "Add offline payment" (play-day player, member): the redirect carries the
// method, or "matched" when a bank transfer was reconciled on the spot.
export function offlineAddedMessage(value: string, who: "Player" | "Member", lang: Lang = "en"): string {
  const w = at(lang, who === "Player" ? "flash_who_player" : "flash_who_member");
  if (value === "matched") return at(lang, "flash_added_matched", { who: w });
  if (value === "bank_transfer") return at(lang, "flash_added_transfer", { who: w });
  return at(lang, "flash_added_cash", { who: w });
}

export const generic: FlashRules = {
  toast: (v) => (v ? ok(v) : null),
  toastError: (v) => (v ? err(v) : null),
};

// The mini-game cap is the club's setting, so these rules are built per club.
export const playDaysFor = (miniGameMax: number, lang: Lang): FlashRules => {
  const t = (key: Parameters<typeof at>[1], vars?: Parameters<typeof at>[2]) => at(lang, key, vars);
  return {
    ...generic,
    cashAdded: (v) => ok(offlineAddedMessage(v, "Player", lang)),
    cashError: (v) => err(v),
    removed: () => ok(t("flash_removed")),
    courtsUpdated: (v) => ok(t(v === "1" ? "flash_courts_one" : "flash_courts_many", { n: v })),
    courtsError: (v) => err(v),
    waitlistNotified: (v) => {
      const n = Number(v);
      return n > 0 ? ok(t(n === 1 ? "flash_wl_notified_one" : "flash_wl_notified_many", { n })) : err(t("flash_wl_none"));
    },
    waitlistRemoved: () => ok(t("flash_wl_removed")),
    registration: (v) => (v === "locked" ? ok(t("flash_reg_locked")) : v === "unlocked" ? ok(t("flash_reg_unlocked")) : null),
    miniGame: (v) => (v === "on" ? ok(t("flash_mini_on", { n: miniGameMax })) : v === "off" ? ok(t("flash_mini_off")) : null),
    fillInSaved: () => ok(t("flash_fillin_saved")),
    fillInRemoved: () => ok(t("flash_fillin_removed")),
    fillInError: (v) => err(v),
  };
};

