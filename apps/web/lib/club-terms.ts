// The club's own names in translated text (Phase 3 step 4; build plan §6.3).
//
// The dictionaries in @luvallplay/i18n say {pointsName} and {visionName}.
// Importing this file sets the built-in club's names, so every translated
// string has them wherever it is produced (pages, API routes, emails). The
// root layout and ClubProvider then set the names from the club's settings.
//
// One club per deployment (until step 11 gives each request its club), so
// one set of names per server process is correct today.
import { currentTerms, format, setTerms, type Terms } from "@luvallplay/i18n";
import { CLUB_TERMS } from "./constants.ts";
import { BUILT_IN_CLUB, DeploymentSettingsError, tenantSlugSetting } from "./tenant-settings.ts";

// Three Wolves' names only on Three Wolves' deployment (audit C7). Any other
// club starts from the neutral names ("Points", "Vision") until its settings
// are applied, never from Three Wolves'. With TENANT_SLUG missing on
// production the names stay neutral; the server refuses to start anyway.
function builtInClub(): boolean {
  try {
    return tenantSlugSetting() === BUILT_IN_CLUB;
  } catch (err) {
    if (err instanceof DeploymentSettingsError) return false;
    throw err;
  }
}
if (builtInClub()) setTerms(CLUB_TERMS);

/** Use the club's names from its settings. */
export function applyClubTerms(terms: Terms): void {
  setTerms(terms);
}

/** The club's name for its points ("Wolf Points" at Three Wolves), in `lang`'s own wording when it has one. */
export function pointsName(lang?: string): string {
  const t = currentTerms();
  return (lang ? t.localized?.[lang]?.pointsName : undefined) ?? t.pointsName;
}

/** The club's name for the match tracker ("Wolf Vision" at Three Wolves). */
export function visionName(lang?: string): string {
  const t = currentTerms();
  return (lang ? t.localized?.[lang]?.visionName : undefined) ?? t.visionName;
}

/** The title of the top seat on the points board ("Alpha Wolf" at Three Wolves). */
export function alphaName(lang?: string): string {
  const t = currentTerms();
  return (lang ? t.localized?.[lang]?.alphaName : undefined) ?? t.alphaName;
}

/** The title of the seats below it ("Silver Wolf" at Three Wolves). */
export function silverName(lang?: string): string {
  const t = currentTerms();
  return (lang ? t.localized?.[lang]?.silverName : undefined) ?? t.silverName;
}

/** Fills {pointsName}, {visionName}, {alphaName} and {silverName} in text that isn't in the dictionaries (emails, admin screens). */
export function withTerms(text: string, lang?: string): string {
  return format(text, undefined, lang);
}

function fill(value: unknown, lang?: string): unknown {
  if (typeof value === "string") return withTerms(value, lang);
  if (Array.isArray(value)) return value.map((item) => fill(item, lang));
  if (value && typeof value === "object") return termed(value as object, lang);
  return value;
}

/**
 * A copy table (an object of strings, functions that return strings, and
 * nested tables) with the club's terms filled in as each entry is read. For
 * tables written at module level, before the club is known.
 */
export function termed<T extends object>(table: T, lang?: string): T {
  return new Proxy(table, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "string") return withTerms(value, lang);
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          const out = (value as (...a: unknown[]) => unknown).apply(target, args);
          return typeof out === "string" ? withTerms(out, lang) : out;
        };
      }
      if (Array.isArray(value)) return value.map((item) => fill(item, lang));
      if (value && typeof value === "object" && !Array.isArray(value)) return termed(value as object, lang);
      return value;
    },
  });
}
