// Where the site lives, its routes, and where each call to action leads.
import type { Lang, SiteSettings } from "./types";

type Env = Record<string, string | undefined>;

/** The public origin of the English site (and the default for everything). */
export function siteOrigin(env: Env = process.env): string {
  if (env.SITE_ORIGIN) return env.SITE_ORIGIN.replace(/\/$/, "");
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "http://localhost:3100";
}

/** The origin of the Vietnamese home (luvallplay.vn once its DNS is live). */
export function originFor(lang: Lang, env: Env = process.env): string {
  if (lang === "vi" && env.SITE_VI_ORIGIN) return env.SITE_VI_ORIGIN.replace(/\/$/, "");
  return siteOrigin(env);
}

export function isProductionDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/**
 * Search engines may index only the production deployment, and only once
 * someone has switched "search indexing" on in the Studio (go-live).
 */
export function indexingAllowed(settings: Pick<SiteSettings, "searchIndexing">, env: Env = process.env): boolean {
  return isProductionDeployment(env) && settings.searchIndexing === true;
}

/** Every static page, as a path without the language prefix. "" is home. */
export const STATIC_PATHS = [
  "",
  "/vision",
  "/for-clubs",
  "/find-a-club",
  "/pricing",
  "/about",
  "/help",
  "/contact",
  "/waitlist",
  "/walkthrough",
  "/invite-a-club",
  "/get-the-app",
  "/privacy",
  "/terms",
] as const;

export function href(lang: Lang, path: string): string {
  if (/^(https?:|mailto:|#)/.test(path)) return path;
  return `/${lang}${path === "/" ? "" : path.replace(/^\/#/, "#")}`;
}

export type CtaKind = "startClub" | "getApp" | "appStore" | "playStore" | "walkthrough";
export type CtaTarget = { href: string; external: boolean; soon: boolean };

/**
 * Where a call to action leads. In `coming-soon` mode everything goes to the
 * waitlist forms; flipping launchMode to `live` in the Studio sends people to
 * the setup wizard and the stores, with no redeploy.
 */
export function ctaTarget(kind: CtaKind, lang: Lang, s: SiteSettings): CtaTarget {
  const live = s.launchMode === "live";
  const internal = (path: string, soon = false): CtaTarget => ({ href: href(lang, path), external: false, soon });
  const external = (url: string): CtaTarget => ({ href: url, external: true, soon: false });
  switch (kind) {
    case "startClub":
      return live && s.wizardUrl ? external(s.wizardUrl) : internal("/waitlist");
    case "getApp":
      return internal("/get-the-app", !(live && (s.appStoreUrl || s.playStoreUrl)));
    case "appStore":
      return live && s.appStoreUrl ? external(s.appStoreUrl) : internal("/get-the-app", true);
    case "playStore":
      return live && s.playStoreUrl ? external(s.playStoreUrl) : internal("/get-the-app", true);
    case "walkthrough":
      return s.bookingUrl ? external(s.bookingUrl) : internal("/walkthrough");
  }
}

/** Accent-insensitive, case-insensitive text for search (Vietnamese aware). */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}
