import "./club-terms.ts";
import { useCallback } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { translate, type ArenaKey, type Lang, type Vars } from "@luvallplay/i18n";

// The Arena, the rank card and the Wolf Points leaderboard tabs. The text lives in @luvallplay/i18n
// (namespace "arena", Phase 2); this keeps the app's at() and useArenaT().
export type { ArenaKey };

export function at(lang: Lang, key: ArenaKey, vars?: Vars): string {
  return translate("arena", lang, key, vars);
}

export function useArenaT() {
  const { lang } = useLanguage();
  const t = useCallback((key: ArenaKey, vars?: Vars) => at(lang, key, vars), [lang]);
  return { lang, t };
}
