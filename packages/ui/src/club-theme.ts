// A club's stored theme (tenants.theme) as the full set of semantic tokens
// for both modes (build plan §6.3, decision AM). Pure and forgiving: a
// missing or malformed value falls back token by token, so a bad theme can
// never leave the app unstyled.
import { COLOR_SCHEMES, DEFAULT_SCHEME, SEMANTIC_TOKENS, schemeTheme, type Theme } from "./semantic.ts";
import { threeWolvesTheme } from "./three-wolves.ts";

export type ResolvedClubTheme = {
  /** The ready-made scheme in use, or null for an imported brand. */
  scheme: string | null;
  /** Which artwork set (rank art and so on) the club uses. */
  artSet: string;
  logoUrl: string | null;
  light: Theme;
  dark: Theme;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
// Colours and font stacks only: nothing that could close the declaration or open a url().
const SAFE_VALUE = /^[#(),.%'"\w\s-]{1,200}$/;

function overlay(base: Theme, stored: unknown): Theme {
  if (!isObj(stored)) return base;
  const out = { ...base };
  for (const token of SEMANTIC_TOKENS) {
    const v = stored[token];
    if (typeof v === "string" && SAFE_VALUE.test(v) && !/url\s*\(/i.test(v)) out[token] = v;
  }
  return out;
}

function safeUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 500) return null;
  return /^https:\/\/[^\s"'<>]+$/.test(v) || /^\/[^/\s"'<>][^\s"'<>]*$/.test(v) ? v : null;
}

/**
 * `stored` is tenants.theme: `{ scheme?, light?, dark?, logoUrl?, artSet? }`.
 * - a known `scheme` gives that scheme's tokens;
 * - `light` / `dark` token maps (an imported brand) are laid over them;
 * - Three Wolves with nothing stored wears its own brand (packages/ui/three-wolves).
 */
export function resolveClubTheme(stored: unknown, slug: string): ResolvedClubTheme {
  const t = isObj(stored) ? stored : {};
  const known = typeof t.scheme === "string" && COLOR_SCHEMES.some((s) => s.id === t.scheme) ? t.scheme : null;
  const imported = isObj(t.light) || isObj(t.dark);
  const logoUrl = safeUrl(t.logoUrl);
  const artSet = typeof t.artSet === "string" && /^[a-z0-9-]{1,40}$/.test(t.artSet) ? t.artSet : null;

  if (!known && !imported && slug === "three-wolves") {
    return { scheme: null, artSet: artSet ?? "three-wolves", logoUrl: logoUrl ?? "/uploads/Three%20wolves%20logo%20transparent.svg", light: threeWolvesTheme("light"), dark: threeWolvesTheme("dark") };
  }
  const base = known ?? DEFAULT_SCHEME;
  return {
    scheme: imported ? null : base,
    artSet: artSet ?? "luvallplay",
    logoUrl,
    light: overlay(schemeTheme(base, "light"), t.light),
    dark: overlay(schemeTheme(base, "dark"), t.dark),
  };
}
