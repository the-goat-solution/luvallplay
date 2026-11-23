// Semantic theme tokens (build plan §6.3). Components use ONLY these names,
// never brand names (court-green, smash-lime, navy…), so a club's colour
// scheme (§6.3.1) or imported brand (§6.3.2) plugs in with no per-club code.

import { luvallplay } from "./luvallplay.ts";
import schemes from "./color-schemes.json" with { type: "json" };

export const SEMANTIC_TOKENS = [
  "primary",
  "on-primary",
  "accent",
  "on-accent",
  "surface",
  "surface-raised",
  "ink",
  "ink-muted",
  "line",
  "control-border",
  "focus",
  "danger",
  "font-display",
  "font-text",
] as const;
export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];
export type Theme = Record<SemanticToken, string>;
export type Mode = "light" | "dark";

/** One of the ready-made club colour schemes (docs/plans/assets/club-color-schemes.json). */
export type ColorScheme = {
  id: string;
  name: string;
  description: string;
  light: { primary: string; onPrimary: string; accent: string; onAccent: string };
  dark: { primary: string; onPrimary: string; accent: string; onAccent: string };
};

export const COLOR_SCHEMES: readonly ColorScheme[] = schemes;
export const DEFAULT_SCHEME = "court-green";

/** Neutrals are shared by every scheme (§6.3.1); they come from the Luvallplay brand. */
function neutrals(mode: Mode): Omit<Theme, "primary" | "on-primary" | "accent" | "on-accent"> {
  const c = luvallplay.color;
  return {
    surface: c.surface[mode],
    "surface-raised": c["surface-raised"][mode],
    ink: c.ink[mode],
    "ink-muted": c["ink-muted"][mode],
    line: c.line[mode],
    "control-border": c["control-border"][mode],
    focus: c.focus[mode],
    danger: c.danger[mode],
    "font-display": luvallplay.font.display,
    "font-text": luvallplay.font.text,
  };
}

/** The full semantic theme for a scheme in one mode. */
export function schemeTheme(schemeId: string, mode: Mode): Theme {
  const s = COLOR_SCHEMES.find((x) => x.id === schemeId);
  if (!s) throw new Error(`Unknown colour scheme "${schemeId}".`);
  const p = s[mode];
  return { primary: p.primary, "on-primary": p.onPrimary, accent: p.accent, "on-accent": p.onAccent, ...neutrals(mode) };
}

/** A theme as CSS custom properties: light on `selector`, dark values that differ under [data-theme="dark"]. */
export function themeCss(light: Theme, dark: Theme, selector = ":root"): string {
  const decl = (t: Theme, only?: Theme) =>
    SEMANTIC_TOKENS.filter((k) => !only || t[k] !== only[k]).map((k) => `  --${k}: ${t[k]};`);
  const darkSelector = `${selector === ":root" ? "" : selector}[data-theme="dark"]`;
  return [`${selector} {`, ...decl(light), "}", "", `${darkSelector} {`, ...decl(dark, light), "}", ""].join("\n");
}
