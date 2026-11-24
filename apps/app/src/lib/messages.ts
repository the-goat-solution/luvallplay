// The app's text: packages/i18n's "app" namespace, in the person's language,
// with the club's own words filled in.
import { app, type AppKey } from "@luvallplay/i18n/app";
import { format, setTerms, type Terms, type Vars } from "@luvallplay/i18n/format";

export type Lang = "en" | "vi";
export type T = (key: AppKey, vars?: Vars) => string;

/** A chosen language first, then the account's, then the device's, then English. */
export function pickLang(chosen: Lang | null, account: string | null | undefined, device: string | null | undefined): Lang {
  if (chosen) return chosen;
  if (account === "en" || account === "vi") return account;
  return device?.toLowerCase().startsWith("vi") ? "vi" : "en";
}

/** A translator for `lang` using this club's terms (null: the platform's neutral words). */
export function translator(lang: Lang, terms: Terms | null): T {
  return (key, vars) => {
    setTerms(terms ?? { pointsName: "", visionName: "" });
    return format(app[lang][key] ?? app.en[key] ?? key, vars, lang);
  };
}
