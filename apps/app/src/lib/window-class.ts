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
export function navKind(cls: WindowClass): NavKind {
  return cls === "compact" ? "bar" : cls === "large" ? "sidebar" : "rail";
}
