import "./club-terms.ts";
import { useCallback } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { translate, type JerseyKey, type Lang, type Vars } from "@luvallplay/i18n";

// The /jersey page. The text lives in @luvallplay/i18n
// (namespace "jersey", Phase 2); this keeps the app's jt() and useJerseyT().
export type { JerseyKey };

export function jt(lang: Lang, key: JerseyKey, vars?: Vars): string {
  return translate("jersey", lang, key, vars);
}

export function useJerseyT() {
  const { lang } = useLanguage();
  const tr = useCallback((key: JerseyKey, vars?: Vars) => jt(lang, key, vars), [lang]);
  return { lang, tr };
}
