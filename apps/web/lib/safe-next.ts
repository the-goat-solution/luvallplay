// Post-sign-in redirect guard, free of imports so it can be unit-tested.

/**
 * Only same-site relative paths are allowed after sign-in, so a crafted
 * `next` can't bounce someone to another website.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/profile"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.startsWith("/api/")) return fallback;
  return next;
}
