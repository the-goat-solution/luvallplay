// The shared pieces of every namespace: the languages the club speaks, the
// shape of a dictionary, and how {var} placeholders are filled.

export const LANGS = ["en", "vi"] as const;
export type Lang = (typeof LANGS)[number];

/** Every key of a namespace, each a string. Vietnamese dictionaries use this so a missing key is a type error. */
export type Messages<K extends string> = { readonly [P in K]: string };

export type Vars = Record<string, string | number>;

/** Fill {name} placeholders. Placeholders without a value are left as they are. */
export function format(template: string, vars?: Vars): string {
  let s = template;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
