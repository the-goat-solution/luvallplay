// A club's theme (semantic tokens from the API) as CSS custom properties on
// the page (build plan §6.3, decision AM). With no club theme the page wears
// Luvallplay's own (packages/ui tokens.css), light or dark.

export type Mode = "light" | "dark";
export type ThemeChoice = "system" | Mode;
export type ClubTheme = { light: Record<string, string>; dark: Record<string, string> };

export function resolveMode(choice: ThemeChoice, systemPrefersDark: boolean): Mode {
  return choice === "system" ? (systemPrefersDark ? "dark" : "light") : choice;
}

const TOKEN_NAME = /^[a-z][a-z0-9-]{0,40}$/;
// Colours and font stacks only. The server already filters; this is the app's own guard.
const TOKEN_VALUE = /^[#(),.%'"\w\s-]{1,200}$/;

/** `{ primary: "#184467" }` → `{ "--primary": "#184467" }`, dropping anything that isn't a plain colour or font value. */
export function themeVars(tokens: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    if (TOKEN_NAME.test(name) && typeof value === "string" && TOKEN_VALUE.test(value) && !/url\s*\(/i.test(value)) out[`--${name}`] = value;
  }
  return out;
}

type Target = {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
  setAttribute(name: string, value: string): void;
  dataset: Record<string, string | undefined>;
};

/**
 * Dress `root` (the <html> element): the club's tokens for `mode`, or none
 * (Luvallplay's own). Tokens set by a previous club and not by this one are
 * removed, so nothing of the last club lingers. Returns the page's primary
 * colour for the browser's theme-color, or null when it is Luvallplay's.
 */
export function applyTheme(root: Target, theme: ClubTheme | null, mode: Mode): string | null {
  const vars = theme ? themeVars(theme[mode]) : {};
  const before = (root.dataset.themeVars ?? "").split(" ").filter(Boolean);
  for (const name of before) if (!(name in vars)) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.dataset.themeVars = Object.keys(vars).join(" ");
  root.setAttribute("data-theme", mode);
  root.dataset.look = theme ? "club" : "luvallplay";
  return vars["--primary"] ?? null;
}
