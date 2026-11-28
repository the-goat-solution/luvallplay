// Where to land after signing in (cutover gap B3): a link opened signed out
// (an email's "the club replied", an Arena invite) keeps its target through
// the sign-in, as `/signin?next=<path>` does on the website. The same rule as
// the website's (packages/core safe-next: a path on this site, never another
// website or the API), and never back to sign-in itself.
import { safeNextPath } from "@luvallplay/core/safe-next";

export const HOME = "/home";
const MAX = 512;

/** The screen to open after sign-in: `raw` when it is a safe path of this app, else Home. */
export function appNext(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > MAX || /[\u0000-\u001f\\]/.test(raw)) return HOME;
  const next = safeNextPath(raw, HOME);
  const path = next.split(/[?#]/)[0];
  if (path === "/" || path === "/signin" || path === "/handover" || path === "/welcome") return HOME;
  return next;
}

/** The `next` search value for /signin and /welcome: kept only when it leads somewhere other than Home. */
export function nextSearch(search: Record<string, unknown>): { next?: string } {
  const next = appNext(search.next);
  return next === HOME ? {} : { next };
}
