// Marketing-site text. The dictionaries live in @luvallplay/i18n (Phase 2);
// this keeps the app's t() and its types.
import { translate, type Lang, type SiteKey, type Vars } from "@luvallplay/i18n";

export type { Lang };
export type I18nKey = SiteKey;

export function t(lang: Lang, key: I18nKey, vars?: Vars): string {
  return translate("site", lang, key, vars);
}
