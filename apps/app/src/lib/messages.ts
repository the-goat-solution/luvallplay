// The app's text: packages/i18n's "app" namespace, in the person's language,
// with the club's own words filled in. English comes with the app;
// Vietnamese is its own file, fetched when it is the language shown (before
// the first screen, see main.tsx), so nobody downloads both.
import { en, type AppKey } from "@luvallplay/i18n/app-en";
import { format, setTerms, type Messages, type Terms, type Vars } from "@luvallplay/i18n/format";

export type Lang = "en" | "vi";
export type T = (key: AppKey, vars?: Vars) => string;

const loaded: Partial<Record<Lang, Messages<AppKey>>> = { en };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

/** Makes a language's text available. English always is. A failed fetch (no connection) is tried again next time. */
export function loadLang(lang: Lang): Promise<void> {
  if (loaded[lang]) return Promise.resolve();
  loading ??= import("@luvallplay/i18n/app-vi")
    .then((m) => {
      loaded.vi = m.vi;
      for (const l of listeners) l();
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Whether a language's text is here yet (screens draw again when it arrives). */
export const langs = {
  ready: (lang: Lang): boolean => !!loaded[lang],
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** A chosen language first, then the account's, then the device's, then English. */
export function pickLang(chosen: Lang | null, account: string | null | undefined, device: string | null | undefined): Lang {
  if (chosen) return chosen;
  if (account === "en" || account === "vi") return account;
  return device?.toLowerCase().startsWith("vi") ? "vi" : "en";
}

/** A translator for `lang` using this club's terms (null: the platform's neutral words). English until the language's text is here. */
export function translator(lang: Lang, terms: Terms | null): T {
  return (key, vars) => {
    setTerms(terms ?? { pointsName: "", visionName: "" });
    return format((loaded[lang] ?? en)[key] ?? en[key] ?? key, vars, lang);
  };
}
