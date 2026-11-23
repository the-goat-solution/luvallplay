// The Three Wolves club theme: exactly the custom properties in
// apps/web/app/globals.css (:root), which is what the site renders with.
// The club keeps its navy, cream and bronze, Copperplate and Montserrat
// (decision: Three Wolves stays branded). tests/design-tokens.test.ts fails if
// this and globals.css ever disagree.

export const threeWolves = {
  name: "Three Wolves Badminton Club",
  color: {
    navy: "#184467",
    "navy-dark": "#0e2c3f",
    "navy-mid": "#1e5a8a",
    cream: "#fcfbf2",
    "cream-dark": "#f2efe3",
    steel: "#b4ccd9",
    "steel-light": "#daeaf2",
    bronze: "#C4892A",
    "bronze-dark": "#9e6d1f",
    "bronze-light": "#e2ae60",
    white: "#ffffff",
    "text-dark": "#0d1b26",
    "text-mid": "#3a526a",
    "text-light": "#7a9ab0",
  },
  font: {
    display: "'Copperplate', 'Copperplate Gothic Light', serif",
    sans: "'Montserrat', 'Helvetica Neue', sans-serif",
  },
  radius: { sm: "4px", md: "8px", lg: "16px", xl: "24px", pill: "999px" },
  shadow: {
    card: "0 2px 16px rgba(24,68,103,.08)",
    elevated: "0 8px 40px rgba(24,68,103,.14)",
    hover: "0 16px 48px rgba(24,68,103,.20)",
  },
  ease: { default: ".25s ease", slow: ".5s ease" },
} as const;

/** The club theme as the CSS custom properties globals.css declares (name without "--" → value). */
export function threeWolvesCssVars(): Record<string, string> {
  const t = threeWolves;
  return {
    ...t.color,
    "font-display": t.font.display,
    "font-sans": t.font.sans,
    ...Object.fromEntries(Object.entries(t.radius).map(([k, v]) => [`radius-${k}`, v])),
    ...Object.fromEntries(Object.entries(t.shadow).map(([k, v]) => [`shadow-${k}`, v])),
    ease: t.ease.default,
    "ease-slow": t.ease.slow,
  };
}
