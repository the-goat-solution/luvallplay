// The Family section's own words (packages/i18n, the `juniors` namespace).
import { useMemo } from "react";
import { format, type Vars } from "@luvallplay/i18n/format";
import { juniors, type JuniorsKey } from "@luvallplay/i18n/juniors";
import { useLang } from "../../hooks.tsx";

export type FamilyT = (key: JuniorsKey, vars?: Vars) => string;

export function useFamilyT(): FamilyT {
  const lang = useLang();
  return useMemo(() => (key, vars) => format(juniors[lang][key], vars, lang), [lang]);
}

/** The message for a refusal's code, or the general one. */
export function errorKey(code: string | undefined): JuniorsKey {
  const key = `err_${code}` as JuniorsKey;
  return code && key in juniors.en ? key : "err_generic";
}
