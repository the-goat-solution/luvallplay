import "./club-terms.ts";
import { useCallback } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { translate, type ProfileKey, type Lang, type Vars } from "@luvallplay/i18n";

// Sign-in, the player profile, the shop and the leaderboard. The text lives in @luvallplay/i18n
// (namespace "profile", Phase 2); this keeps the app's pt() and useProfileT().
export type { ProfileKey };

export function pt(lang: Lang, key: ProfileKey, vars?: Vars): string {
  return translate("profile", lang, key, vars);
}

export function useProfileT() {
  const { lang } = useLanguage();
  const tr = useCallback((key: ProfileKey, vars?: Vars) => pt(lang, key, vars), [lang]);
  return { lang, tr };
}
