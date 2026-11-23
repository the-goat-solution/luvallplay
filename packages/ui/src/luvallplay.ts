// The Luvallplay brand (platform identity), copied exactly from the brand
// system "Luvallplay" (claude.ai design system artifact, project/tokens.json,
// version 1). It frames the platform: store listing, app icon, sign-in, the
// platform site and the club finder. Clubs keep their own look inside the app
// (see ./three-wolves.ts). Change values there first, then here.
// These are the brand's own names: components never use them, only the
// semantic tokens in ./semantic.ts.

export const luvallplay = {
  name: "Luvallplay",
  tagline: "Love all, play.",
  themes: ["light", "dark"] as const,
  color: {
    "court-green": { light: "#0e6b4f", dark: "#157a5a" },
    "on-court-green": { light: "#fafaf7", dark: "#fafaf7" },
    "smash-lime": { light: "#d4f23c", dark: "#d4f23c" },
    "on-smash-lime": { light: "#0b1b2b", dark: "#0b1b2b" },
    "rally-coral": { light: "#ff6b4a", dark: "#ff6b4a" },
    "on-rally-coral": { light: "#0b1b2b", dark: "#0b1b2b" },
    surface: { light: "#fafaf7", dark: "#0b1b2b" },
    "surface-raised": { light: "#ffffff", dark: "#12263a" },
    ink: { light: "#0b1b2b", dark: "#f2f5f1" },
    "ink-muted": { light: "#4a5a55", dark: "#a9b8b2" },
    line: { light: "#e3e7e4", dark: "#22384c" },
    "control-border": { light: "#7b8a85", dark: "#6f8496" },
    "court-line": { light: "#fafaf7", dark: "#fafaf7" },
    focus: { light: "#157a5a", dark: "#d4f23c" },
    danger: { light: "#b42318", dark: "#ff8a75" },
  },
  font: {
    display: '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif',
    text: '"Be Vietnam Pro", system-ui, sans-serif',
  },
  type: {
    "display-xl": { family: "display", fontSize: "64px", lineHeight: "60px", fontWeight: 700 },
    display: { family: "display", fontSize: "44px", lineHeight: "44px", fontWeight: 700 },
    score: { family: "display", fontSize: "48px", lineHeight: "48px", fontWeight: 700 },
    title: { family: "display", fontSize: "28px", lineHeight: "32px", fontWeight: 600 },
    heading: { family: "text", fontSize: "18px", lineHeight: "26px", fontWeight: 600 },
    body: { family: "text", fontSize: "16px", lineHeight: "24px", fontWeight: 400 },
    small: { family: "text", fontSize: "14px", lineHeight: "20px", fontWeight: 400 },
    label: { family: "text", fontSize: "12px", lineHeight: "16px", fontWeight: 600, letterSpacing: "0.06em" },
  },
  space: { "space-1": "4px", "space-2": "8px", "space-4": "16px", "space-6": "24px", "space-10": "40px" },
  radius: { "radius-sm": "6px", "radius-lg": "16px", "radius-pill": "999px" },
} as const;

export type BrandTheme = (typeof luvallplay.themes)[number];
export type BrandColor = keyof typeof luvallplay.color;
