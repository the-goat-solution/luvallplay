// The shared pieces of every namespace: the languages the club speaks, the
// shape of a dictionary, and how {var} placeholders are filled.

export const LANGS = ["en", "vi"] as const;
export type Lang = (typeof LANGS)[number];

/** Every key of a namespace, each a string. Vietnamese dictionaries use this so a missing key is a type error. */
export type Messages<K extends string> = { readonly [P in K]: string };

export type Vars = Record<string, string | number>;

/**
 * A club's own names for things (build plan §6.3: "Wolf Points" is Three
 * Wolves' term, not the platform's). Dictionaries write {pointsName} and
 * {visionName}; format() fills them. The neutral names are the platform's;
 * the app sets the club's (setTerms).
 */
export type Terms = {
  pointsName: string;
  visionName: string;
  /** The titles of the top seat and the seats below it on the points board. */
  alphaName?: string;
  silverName?: string;
  localized?: Readonly<Record<string, { pointsName?: string; visionName?: string; alphaName?: string; silverName?: string }>>;
};
export const NEUTRAL_TERMS: Required<Omit<Terms, "localized">> = { pointsName: "Points", visionName: "Vision", alphaName: "Top seat", silverName: "Runner-up seat" };
let terms: Required<Terms> = { ...NEUTRAL_TERMS, localized: {} };

/** Use this club's names in every translated string from now on. */
export function setTerms(next: Terms): void {
  terms = {
    pointsName: next.pointsName || NEUTRAL_TERMS.pointsName,
    visionName: next.visionName || NEUTRAL_TERMS.visionName,
    alphaName: next.alphaName || NEUTRAL_TERMS.alphaName,
    silverName: next.silverName || NEUTRAL_TERMS.silverName,
    localized: next.localized ?? {},
  };
}
export function currentTerms(): Required<Terms> {
  return terms;
}

/**
 * Fill {name} placeholders: the caller's values, then the club's terms (in
 * `lang`'s own wording when the club has one). Placeholders without a value
 * are left as they are.
 */
export function format(template: string, vars?: Vars, lang?: string): string {
  let s = template;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  const own = lang ? terms.localized?.[lang] : undefined;
  if (s.includes("{pointsName}")) s = s.split("{pointsName}").join(own?.pointsName ?? terms.pointsName);
  if (s.includes("{visionName}")) s = s.split("{visionName}").join(own?.visionName ?? terms.visionName);
  if (s.includes("{alphaName}")) s = s.split("{alphaName}").join(own?.alphaName ?? terms.alphaName);
  if (s.includes("{silverName}")) s = s.split("{silverName}").join(own?.silverName ?? terms.silverName);
  return s;
}
