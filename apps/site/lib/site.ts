// Where the site lives, its routes, and where each call to action leads.
import type { Availability, AvailabilityItem, Lang, SiteSettings } from "./types";

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
  "/availability",
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
  "/safety/child-safety",
] as const;

/** The notices kept in content/legal, one file per language. */
export const LEGAL_SLUGS = ["privacy", "terms", "child-safety"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

/** Where a notice lives. The child-safety standards have the address the stores are given. */
export function legalPath(slug: LegalSlug): string {
  return slug === "child-safety" ? "/safety/child-safety" : `/${slug}`;
}

/**
 * The address for child-safety concerns: SAFETY_CONTACT_EMAIL (the setting
 * the app's Help screen also shows) when it holds one address, else the
 * site's general contact. Undefined when there is neither: the page then
 * points at the contact form.
 */
export function safetyContact(settings: Pick<SiteSettings, "contactEmail">, env: Env = process.env): string | undefined {
  const own = (env.SAFETY_CONTACT_EMAIL ?? "").trim();
  if (/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(own)) return own;
  return settings.contactEmail || undefined;
}

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

/** The current state of one feature (content/availability.ts, or Sanity). */
export function availabilityOf(content: { availability: Availability }, key: string): AvailabilityItem | undefined {
  return content.availability.items.find((i) => i.key === key);
}
/** True unless the feature is fully live. An unknown key counts as not yet available. */
export function notYetLive(content: { availability: Availability }, key: string): boolean {
  return availabilityOf(content, key)?.status !== "live";
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

/** A club logo: sized by Sanity's CDN when it lives there, as is when local. */
export function logoSrc(url: string, width = 160): string {
  return url.startsWith("https://cdn.sanity.io/") ? `${url}?w=${width}&fit=max&auto=format` : url;
}
