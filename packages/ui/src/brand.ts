// Bring your own brand (build plan §6.3.2): a club's own colours turned into
// a full theme for both modes, with contrast fixed automatically.
//
// Pure: no I/O. A colour that can't carry readable text is kept for the logo
// and decoration, and the shade used behind text is adjusted; every
// adjustment is returned with the original, so the screen can show both side
// by side and say why in one sentence.
//
// The floors are the ones the 12 ready-made schemes pass (§6.3.1):
//   text on a fill                               ≥ 4.5 : 1, both modes
//   primary on the light surface and raised one  ≥ 4.5 : 1 (it is link text too)
//   fills on BOTH dark grounds                   ≥ 3 : 1
import { luvallplay } from "./luvallplay.ts";

export const TEXT_CONTRAST = 4.5;
export const FILL_CONTRAST = 3;

type Rgb = [number, number, number];

/** "#1e3a8a", "1E3A8A", "#abc", "rgb(30, 58, 138)" → "#1E3A8A"; anything else → null. */
export function parseColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();
  let m = /^#?([0-9a-f]{3})$/i.exec(v);
  if (m) return `#${[...m[1]].map((c) => c + c).join("")}`.toUpperCase();
  m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(v);
  if (m) return `#${m[1]}`.toUpperCase();
  m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i.exec(v);
  if (m) {
    const rgb = [m[1], m[2], m[3]].map(Number);
    if (rgb.every((n) => n <= 255)) return toHex(rgb as Rgb);
  }
  return null;
}

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb): string => `#${rgb.map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((n) => {
    const v = n / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes `hex` toward white (amount > 0) or black (amount < 0); |amount| from 0 to 1. Keeps the hue. */
function shade(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return toHex(toRgb(hex).map((n) => n + (target - n) * t) as Rgb);
}

/** How far each try moves the colour toward black or white. */
const STEP = 0.01;

const worst = (color: string, against: readonly string[]) => Math.min(...against.map((g) => contrastRatio(color, g)));

/**
 * The nearest shade of `color` that reaches `min` against every colour in
 * `against`: unchanged when it already does, otherwise darkened or lightened
 * (whichever gets there with the smaller change) in small steps.
 */
export function adjustForContrast(color: string, against: readonly string[], min: number): string {
  if (worst(color, against) >= min) return color;
  for (let step = 1; step <= 100; step++) {
    for (const direction of [-1, 1]) {
      const candidate = shade(color, direction * step * STEP);
      if (worst(candidate, against) >= min) return candidate;
    }
  }
  // Black or white always reaches it against a single ground; against grounds on both sides, take the better.
  return worst("#000000", against) >= worst("#FFFFFF", against) ? "#000000" : "#FFFFFF";
}

/** The text colour for a fill: the brand's dark ink or white, whichever reads better (both tried against 4.5 : 1). */
export function readableOn(fill: string): string {
  const dark = luvallplay.color.ink.light;
  return contrastRatio("#FFFFFF", fill) >= contrastRatio(dark, fill) ? "#FFFFFF" : dark;
}

export type BrandColors = { primary: string; onPrimary: string; accent: string; onAccent: string };

export type BrandAdjustment = {
  mode: "light" | "dark";
  token: "primary" | "accent";
  /** The club's own colour, still used for the logo and decoration. */
  original: string;
  /** The shade used behind and as text. */
  adjusted: string;
  /** Why, as a key for the screen's one sentence. */
  reason: "text-on-fill" | "link-on-light" | "fill-on-dark";
};

export type ImportedBrand = {
  /** What goes into tenants.theme (resolveClubTheme lays these over the default scheme). */
  theme: { light: Record<string, string>; dark: Record<string, string> };
  light: BrandColors;
  dark: BrandColors;
  adjustments: BrandAdjustment[];
};

/** A fill and its text, with the fill moved only as far as it must to let text on it reach 4.5 : 1. */
function fillWithText(fill: string): { fill: string; text: string } {
  let text = readableOn(fill);
  if (contrastRatio(text, fill) >= TEXT_CONTRAST) return { fill, text };
  // A mid-tone: neither white nor dark ink reads on it. Darken it for white text
  // or lighten it for dark text, whichever changes the colour less.
  const forWhite = adjustForContrast(fill, ["#FFFFFF"], TEXT_CONTRAST);
  const dark = luvallplay.color.ink.light;
  const forDark = adjustForContrast(fill, [dark], TEXT_CONTRAST);
  const distance = (a: string, b: string) => toRgb(a).reduce((t, n, i) => t + Math.abs(n - toRgb(b)[i]), 0);
  if (distance(forWhite, fill) <= distance(forDark, fill)) return { fill: forWhite, text: "#FFFFFF" };
  text = dark;
  return { fill: forDark, text };
}

/**
 * A club's primary and accent colours as a theme for both modes that passes
 * every floor above. Returns null when either colour can't be read.
 */
export function importBrand(input: { primary: unknown; accent: unknown }): ImportedBrand | null {
  const primary = parseColor(input.primary);
  const accent = parseColor(input.accent);
  if (!primary || !accent) return null;
  const c = luvallplay.color;
  const lightGrounds = [c.surface.light, c["surface-raised"].light];
  const darkGrounds = [c.surface.dark, c["surface-raised"].dark];
  const adjustments: BrandAdjustment[] = [];
  const note = (mode: "light" | "dark", token: "primary" | "accent", original: string, adjusted: string, reason: BrandAdjustment["reason"]) => {
    if (adjusted !== original) adjustments.push({ mode, token, original, adjusted, reason });
  };

  // Light: the primary is also link text on the light grounds.
  const linkSafe = adjustForContrast(primary, lightGrounds, TEXT_CONTRAST);
  note("light", "primary", primary, linkSafe, "link-on-light");
  const lightPrimary = fillWithText(linkSafe);
  if (lightPrimary.fill !== linkSafe) note("light", "primary", primary, lightPrimary.fill, "text-on-fill");
  const lightAccent = fillWithText(accent);
  note("light", "accent", accent, lightAccent.fill, "text-on-fill");

  // Dark: fills must stand off both dark grounds, then carry their text.
  const darkOf = (token: "primary" | "accent", original: string) => {
    const standsOff = adjustForContrast(original, darkGrounds, FILL_CONTRAST);
    note("dark", token, original, standsOff, "fill-on-dark");
    let out = fillWithText(standsOff);
    // Carrying text must not have pulled it back toward the ground.
    if (worst(out.fill, darkGrounds) < FILL_CONTRAST) {
      const lighter = adjustForContrast(shade(standsOff, 0.2), darkGrounds, FILL_CONTRAST);
      out = fillWithText(lighter);
    }
    if (out.fill !== standsOff) note("dark", token, original, out.fill, "text-on-fill");
    return out;
  };
  const darkPrimary = darkOf("primary", primary);
  const darkAccent = darkOf("accent", accent);

  const colors = (p: { fill: string; text: string }, a: { fill: string; text: string }): BrandColors => ({ primary: p.fill, onPrimary: p.text, accent: a.fill, onAccent: a.text });
  const tokens = (b: BrandColors) => ({ primary: b.primary, "on-primary": b.onPrimary, accent: b.accent, "on-accent": b.onAccent });
  const light = colors(lightPrimary, lightAccent);
  const dark = colors(darkPrimary, darkAccent);
  // One note per colour and mode: the last (final) shade.
  const last = new Map<string, BrandAdjustment>();
  for (const a of adjustments) last.set(`${a.mode}:${a.token}`, { ...a, adjusted: a.mode === "light" ? light[a.token] : dark[a.token] });
  return { theme: { light: tokens(light), dark: tokens(dark) }, light, dark, adjustments: [...last.values()].filter((a) => a.adjusted !== a.original) };
}

/** Whether a set of brand colours passes every floor (what the tests and the preview's "all good" tick check). */
export function brandPasses(light: BrandColors, dark: BrandColors): boolean {
  const c = luvallplay.color;
  return (
    [light, dark].every((b) => contrastRatio(b.onPrimary, b.primary) >= TEXT_CONTRAST && contrastRatio(b.onAccent, b.accent) >= TEXT_CONTRAST) &&
    worst(light.primary, [c.surface.light, c["surface-raised"].light]) >= TEXT_CONTRAST &&
    worst(dark.primary, [c.surface.dark, c["surface-raised"].dark]) >= FILL_CONTRAST &&
    worst(dark.accent, [c.surface.dark, c["surface-raised"].dark]) >= FILL_CONTRAST
  );
}

// ── Reading a brand from the club's own website ────────────────────────────

export type WebsiteBrand = {
  /** Colours found, most telling first (the page's theme colour, then colours in its styles by how often they appear). */
  colors: string[];
  /** Logo candidates as absolute https addresses, best first. */
  logos: string[];
  /** Font families the page names (not generic ones). */
  fonts: string[];
};

const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "inherit", "initial", "unset", "-apple-system", "blinkmacsystemfont", "segoe ui", "arial", "helvetica", "helvetica neue", "times new roman", "georgia", "verdana", "tahoma", "roboto"]);

// This package is built without the DOM or Node typings; URL exists in both.
declare const URL: new (url: string, base?: string) => { protocol: string; toString(): string };

function absolute(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * What a page says about its brand, from its HTML alone (the caller fetches
 * it safely: public addresses only, size and time limits). Nothing here is
 * trusted: colours are re-parsed, addresses must be https, names are plain.
 */
export function brandFromHtml(html: string, pageUrl: string): WebsiteBrand {
  const page = html.slice(0, 2_000_000);
  const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']{1,500})["']`, "i").exec(tag)?.[1] ?? null;
  const colors: string[] = [];
  const add = (v: string | null) => {
    const c = parseColor(v);
    if (c && !colors.includes(c)) colors.push(c);
  };
  const logos: string[] = [];
  const addLogo = (href: string | null) => {
    const u = href ? absolute(href, pageUrl) : null;
    if (u && !logos.includes(u)) logos.push(u);
  };

  for (const tag of page.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (attr(tag, "name") ?? attr(tag, "property") ?? "").toLowerCase();
    if (name === "theme-color" || name === "msapplication-tilecolor") add(attr(tag, "content"));
    if (name === "og:image") addLogo(attr(tag, "content"));
  }
  const icons: [number, string][] = [];
  for (const tag of page.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    if (rel.includes("mask-icon")) add(attr(tag, "color"));
    if (rel.includes("apple-touch-icon")) icons.push([0, href]);
    else if (rel.includes("icon")) icons.push([/\.svg(\?|$)/i.test(href) ? 1 : 2, href]);
  }
  // An image that calls itself the logo comes before icons and the share image.
  const named: string[] = [];
  for (const tag of page.match(/<img\b[^>]*>/gi) ?? []) {
    if (/logo/i.test(`${attr(tag, "class") ?? ""} ${attr(tag, "id") ?? ""} ${attr(tag, "alt") ?? ""} ${attr(tag, "src") ?? ""}`)) {
      const src = attr(tag, "src");
      if (src) named.push(src);
    }
  }
  const shared = [...logos];
  logos.length = 0;
  for (const src of named.slice(0, 3)) addLogo(src);
  for (const [, href] of icons.sort((a, b) => a[0] - b[0])) addLogo(href);
  for (const u of shared) if (!logos.includes(u)) logos.push(u);

  // Colours in the page's own styles, by how often they appear; near-white, near-black and greys say nothing about a brand.
  const counts = new Map<string, number>();
  const styles = [...(page.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []), ...(page.match(/style\s*=\s*["'][^"']*["']/gi) ?? [])].join("\n");
  for (const m of styles.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]{5,40}\)/gi)) {
    const c = parseColor(m[0]);
    if (!c) continue;
    const [r, g, b] = toRgb(c);
    if (Math.max(r, g, b) - Math.min(r, g, b) < 24) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  for (const [c] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)) add(c);

  const fonts: string[] = [];
  for (const m of styles.matchAll(/font-family\s*:\s*([^;}{]{1,200})/gi)) {
    for (const raw of m[1].split(",")) {
      const family = raw.trim().replace(/^["']|["']$/g, "").replace(/\s*!important$/i, "");
      if (/^[A-Za-z0-9 -]{2,60}$/.test(family) && !GENERIC_FONTS.has(family.toLowerCase()) && !/^var\b/i.test(family) && !fonts.includes(family)) fonts.push(family);
    }
  }
  for (const tag of page.match(/<link\b[^>]*fonts\.googleapis\.com[^>]*>/gi) ?? []) {
    for (const m of (attr(tag, "href") ?? "").matchAll(/family=([^:&]+)/g)) {
      const family = decodeURIComponent(m[1]).replace(/\+/g, " ");
      if (/^[A-Za-z0-9 -]{2,60}$/.test(family) && !fonts.includes(family)) fonts.unshift(family);
    }
  }
  return { colors: colors.slice(0, 6), logos: logos.slice(0, 6), fonts: fonts.slice(0, 4) };
}
