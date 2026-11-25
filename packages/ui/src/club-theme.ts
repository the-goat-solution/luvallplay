// A club's stored theme (tenants.theme) as the full set of semantic tokens
// for both modes (build plan §6.3, decision AM). Pure and forgiving: a
// missing or malformed value falls back token by token, so a bad theme can
// never leave the app unstyled.
import { COLOR_SCHEMES, DEFAULT_SCHEME, SEMANTIC_TOKENS, schemeTheme, type Theme } from "./semantic.ts";
import { threeWolvesTheme } from "./three-wolves.ts";

/** A font file of the club's (on its own website), for a family its tokens name. */
export type ClubFont = { family: string; src: string; weight: number; style: "normal" | "italic" };

export type ResolvedClubTheme = {
  /** The ready-made scheme in use, or null for an imported brand. */
  scheme: string | null;
  /** Which artwork set (rank art and so on) the club uses. */
  artSet: string;
  logoUrl: string | null;
  light: Theme;
  dark: Theme;
  /** The files for the club's own font families (none: the families fall back to the next in their stacks). */
  fonts: ClubFont[];
};

// Three Wolves' fonts, as its website serves them (apps/web/app/globals.css); only the weights the app uses.
const THREE_WOLVES_FONTS: ClubFont[] = [
  { family: "Copperplate", src: "/fonts/UTM-Copperplate.ttf", weight: 400, style: "normal" },
  { family: "Copperplate", src: "/fonts/UTM-CopperplateB.ttf", weight: 700, style: "normal" },
  { family: "Montserrat", src: "/uploads/Montserrat-Regular.ttf", weight: 400, style: "normal" },
  { family: "Montserrat", src: "/uploads/Montserrat-SemiBold.ttf", weight: 600, style: "normal" },
  { family: "Montserrat", src: "/uploads/Montserrat-Bold.ttf", weight: 700, style: "normal" },
  { family: "Montserrat", src: "/uploads/Montserrat-ExtraBold.ttf", weight: 800, style: "normal" },
];

/** A stored theme's `fonts`: at most 12, each a plain family name, a safe address, a weight and a style. */
function fontsOf(v: unknown): ClubFont[] {
  if (!Array.isArray(v)) return [];
  const out: ClubFont[] = [];
  for (const f of v.slice(0, 12)) {
    if (!isObj(f)) continue;
    const family = typeof f.family === "string" && /^[A-Za-z0-9 -]{1,60}$/.test(f.family) ? f.family : null;
    const src = safeUrl(f.src);
    const weight = typeof f.weight === "number" && Number.isInteger(f.weight) && f.weight >= 100 && f.weight <= 900 ? f.weight : 400;
    const style = f.style === "italic" ? "italic" : "normal";
    if (family && src) out.push({ family, src, weight, style });
  }
  return out;
}

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
 * `stored` is tenants.theme: `{ scheme?, light?, dark?, logoUrl?, artSet?, fonts? }`.
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
    return { scheme: null, artSet: artSet ?? "three-wolves", logoUrl: logoUrl ?? "/uploads/Three%20wolves%20logo%20transparent.svg", light: threeWolvesTheme("light"), dark: threeWolvesTheme("dark"), fonts: THREE_WOLVES_FONTS };
  }
  const base = known ?? DEFAULT_SCHEME;
  return {
    scheme: imported ? null : base,
    artSet: artSet ?? "luvallplay",
    logoUrl,
    light: overlay(schemeTheme(base, "light"), t.light),
    dark: overlay(schemeTheme(base, "dark"), t.dark),
    fonts: fontsOf(t.fonts),
  };
}
