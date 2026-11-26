// Window classes (build plan §4.4): the width decides the navigation.
// The same numbers are in styles/app.css as media queries; a test keeps
// the two in step.

export type WindowClass = "compact" | "medium" | "expanded" | "large";
export type NavKind = "bar" | "rail" | "sidebar";

export const BREAKPOINTS = { medium: 600, expanded: 840, large: 1200 } as const;

export function windowClass(width: number): WindowClass {
  if (width >= BREAKPOINTS.large) return "large";
  if (width >= BREAKPOINTS.expanded) return "expanded";
  if (width >= BREAKPOINTS.medium) return "medium";
  return "compact";
}

/** Compact: bottom tab bar. Medium and expanded: navigation rail. Large: sidebar. */
export function navKind(cls: WindowClass, place?: Place): NavKind {
  if (cls === "compact") return place && shortAndWide(place) ? "rail" : "bar";
  return cls === "large" ? "sidebar" : "rail";
}

/** The screen (not the window: the on-screen keyboard can't change it) and the window's height. */
export type Place = { screenWidth: number; screenHeight: number; windowHeight: number };

/** A phone screen nearer square than tall (short side over long side). Phones today are 0.56 at most. */
export const SHORT_SCREEN = 0.62;

/**
 * A compact window on a short, wide screen, such as iPhone Duo's outer
 * display (about 466 × 678): the tabs move to a rail at the side, as Apple's
 * guidelines move bars there, to leave the height for content. Not a tablet's
 * narrow window beside another app: that one is tall.
 */
export function shortAndWide({ screenWidth, screenHeight, windowHeight }: Place): boolean {
  const ratio = Math.min(screenWidth, screenHeight) / Math.max(screenWidth, screenHeight || 1);
  return ratio >= SHORT_SCREEN && windowHeight <= 760;
}
