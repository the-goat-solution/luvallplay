// The regional services matrix (build plan §6.9; test plan §3.16).
//
// The rule: anything that sends personal data out of the Vietnam region
// needs a written decision (who, what, why, and counsel's view). This file
// is the list the rule is checked against: every outside service the product
// talks to, what personal data it receives, and whether each region may use
// it. Pure data: the check that reads the code is
// apps/web/scripts/regional-services.ts, and CI runs it
// (apps/web/tests/regional-services.test.ts).
//
// How a service gets used in the Hanoi region ("han"):
//   approved      it may be used there. If it receives personal data and
//                 isn't inside the region, that needs `decision`: the file of
//                 the written decision (docs/decisions/vietnam-data/).
//   switched-off  the code is in the build but a setting keeps it off in
//                 this region; the region's build checks the setting.
//   blocked       it may not be used there. A Hanoi build fails while the
//                 code still uses it.
//
// Nothing is approved for Hanoi by default: a service nobody has decided
// about is blocked.

import type { Region } from "./host-routing.ts";

export type ServiceSwitch = {
  /** The setting that keeps the service off. */
  env: string;
  /** Off when the setting is one of these ("" means not set). */
  is?: readonly string[];
  /** Off when the setting is none of these. */
  isNot?: readonly string[];
};

export type RegionStatus =
  | { status: "approved"; decision?: string }
  | { status: "switched-off"; by: ServiceSwitch; instead: string }
  | { status: "blocked"; why: string; needs: string };

export type RegionalService = {
  id: string;
  name: string;
  purpose: string;
  /** Where the provider processes what we send. */
  processedIn: string;
  /** The personal data it receives. Empty: none. */
  personalData: readonly string[];
  /** How the code check recognises its use: packages imported, hosts written in the source. */
  packages: readonly string[];
  hosts: readonly string[];
  regions: Record<Region, RegionStatus>;
};

const sydney: RegionStatus = { status: "approved" };
const undecided = (needs: string): RegionStatus => ({ status: "blocked", why: "Nobody has decided that the Vietnam region may use it.", needs });

export const REGIONAL_SERVICES: readonly RegionalService[] = [
  {
    id: "neon",
    name: "Neon (serverless Postgres driver)",
    purpose: "The database, in regions on Neon",
    processedIn: "Sydney",
    personalData: ["everything in the database"],
    packages: ["@neondatabase/serverless", "@vercel/postgres"],
    hosts: [],
    regions: { syd: sydney, han: { status: "switched-off", by: { env: "DATABASE_DRIVER", is: ["postgres", "pg"] }, instead: "Managed Postgres at the Vietnamese cloud, through the standard driver (lib/database-pg.ts)" } },
  },
  {
    id: "vercel-blob",
    name: "Vercel Blob",
    purpose: "Photos, avatars, shop pictures and finance receipts",
    processedIn: "Outside Vietnam",
    personalData: ["photos of members", "profile pictures", "receipt images"],
    packages: ["@vercel/blob"],
    hosts: ["blob.vercel-storage.com", "vercel.com"],
    regions: {
      syd: sydney,
      han: {
        status: "blocked",
        why: "Photos are personal data. STORAGE_DRIVER=s3 moves server-side uploads to S3-compatible storage in the region, but browser photo uploads and finance receipts still call Vercel Blob directly.",
        needs: "Browser uploads (lib/photos-service.ts, the app) and receipts (lib/finance-receipts.ts) behind the storage interface; then this becomes switched-off by STORAGE_DRIVER=s3.",
      },
    },
  },
  {
    id: "resend",
    name: "Resend",
    purpose: "Email: sign-in codes, receipts, messages, alerts",
    processedIn: "Outside Vietnam",
    personalData: ["email address", "name", "the email's content"],
    packages: ["resend"],
    hosts: ["api.resend.com"],
    regions: { syd: sydney, han: undecided("An email provider whose data handling counsel accepts, or a written decision for Resend (§6.9).") },
  },
  {
    id: "stripe",
    name: "Stripe",
    purpose: "Online card payments and subscriptions",
    processedIn: "Outside Vietnam",
    personalData: ["name", "email address", "payment details", "what was bought"],
    packages: ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js"],
    hosts: ["js.stripe.com", "api.stripe.com", "hooks.stripe.com", "dashboard.stripe.com"],
    regions: {
      syd: sydney,
      han: { status: "blocked", why: "Stripe isn't a realistic option in Vietnam (§6.5): clubs there pay by VietQR bank transfer, later MoMo.", needs: "Every card flow behind the payments interface (lane W), so a Vietnamese club's build and pages never load Stripe." },
    },
  },
  {
    id: "google-identity",
    name: "Google Identity Platform and reCAPTCHA",
    purpose: "Sign-in codes by text message",
    processedIn: "Outside Vietnam",
    personalData: ["phone number", "IP address and browser signals (reCAPTCHA)"],
    packages: [],
    hosts: ["identitytoolkit.googleapis.com", "www.google.com", "recaptcha.google.com", "www.gstatic.com"],
    regions: { syd: sydney, han: undecided("A Vietnamese SMS provider or Zalo notifications for sign-in codes (§6.9), or a written decision.") },
  },
  {
    id: "google-vision",
    name: "Google Cloud Vision SafeSearch",
    purpose: "Checking uploaded photos before they are shown",
    processedIn: "Outside Vietnam",
    personalData: ["photos of members"],
    packages: ["google-auth-library"],
    hosts: ["vision.googleapis.com"],
    regions: { syd: sydney, han: { status: "switched-off", by: { env: "GOOGLE_VISION_ENABLED", isNot: ["1"] }, instead: "A local or self-hosted classifier, because photos are personal data (§6.9); until then photos wait for a person to approve them" } },
  },
  {
    id: "firebase-messaging",
    name: "Firebase Cloud Messaging",
    purpose: "Push notifications to the store app",
    processedIn: "Outside Vietnam",
    personalData: ["a device's push address", "the club's name and a short line of the notification"],
    packages: ["google-auth-library"],
    hosts: ["fcm.googleapis.com"],
    regions: { syd: sydney, han: { status: "switched-off", by: { env: "FCM_SERVICE_ACCOUNT", is: [""] }, instead: "A written decision that device addresses may go to Firebase, or a push service inside Vietnam (§6.9); until then notifications go by the other channels." } },
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    purpose: "Reading the club's public session calendar",
    processedIn: "Outside Vietnam",
    personalData: [],
    packages: ["google-auth-library"],
    hosts: ["www.googleapis.com", "calendar.google.com"],
    regions: { syd: sydney, han: undecided("A decision that a club's public calendar may be read from Google (no personal data is sent), or play days from the database only.") },
  },
  {
    id: "cloudflare-turnstile",
    name: "Cloudflare Turnstile",
    purpose: "Telling people from bots on sign-up and sign-in forms",
    processedIn: "Outside Vietnam",
    personalData: ["IP address and browser signals"],
    packages: [],
    hosts: ["challenges.cloudflare.com"],
    regions: { syd: sydney, han: undecided("A written decision, or a bot check that stays in the region.") },
  },
  {
    id: "sanity",
    name: "Sanity",
    purpose: "The club website's content",
    processedIn: "Outside Vietnam",
    personalData: [],
    packages: ["@sanity/client", "@sanity/image-url", "@sanity/webhook"],
    hosts: ["cdn.sanity.io", "sanity.io"],
    regions: { syd: sydney, han: undecided("The per-club website content model (lane W) in the region's own database, or a decision that website content (no personal data) may live at Sanity.") },
  },
  {
    id: "akahu",
    name: "Akahu",
    purpose: "New Zealand bank feed for matching transfers",
    processedIn: "New Zealand",
    personalData: ["names and references on bank transfers"],
    packages: [],
    hosts: ["api.akahu.io", "akahu.nz"],
    regions: { syd: sydney, han: { status: "switched-off", by: { env: "AKAHU_APP_TOKEN", is: [""] }, instead: "A Vietnamese bank-feed provider (to choose), or matching VietQR transfers by hand" } },
  },
  {
    id: "google-model-hosting",
    name: "Google Cloud Storage (public model files)",
    purpose: "Downloading the pose model Vision runs on the player's own device",
    processedIn: "Outside Vietnam",
    personalData: [],
    packages: [],
    hosts: ["storage.googleapis.com"],
    regions: { syd: sydney, han: undecided("Host the model file in the region; the video itself never leaves the device.") },
  },
];

/**
 * Parts of the stack that aren't a line of code to detect, listed so the
 * matrix is the whole picture (§6.9 "The Hanoi stack").
 */
export const REGIONAL_PLATFORM: readonly { piece: string; syd: string; han: string }[] = [
  { piece: "Runtime", syd: "Vercel", han: "Containers on managed Kubernetes at a Vietnamese cloud (not chosen)" },
  { piece: "Scheduled jobs", syd: "Vercel Cron", han: "Kubernetes CronJobs calling the same routes" },
  { piece: "CDN, WAF, secrets", syd: "Vercel", han: "The provider's, or Cloudflare (Check)" },
  { piece: "Backups", syd: "Neon history and branches", han: "Point-in-time recovery at the provider, with a restore drill" },
  { piece: "Error tracking, analytics", syd: "Hosted services", han: "Self-hosted, or only with consent and counsel's agreement" },
  { piece: "Push notifications", syd: "FCM", han: "FCM sends device tokens abroad (Check with counsel)" },
];

/** Packages that are code only: they talk to nothing outside the deployment by themselves. */
export const LOCAL_PACKAGES: readonly string[] = [
  "next",
  "react",
  "react-dom",
  "zod",
  "drizzle-orm",
  "pg", // the standard Postgres driver: it connects to whatever database the region gives it
  "exceljs",
  "jsqr",
  "qrcode",
  "@mediapipe/tasks-vision", // runs on the player's device; its model download is "google-model-hosting"
  "@tanstack/react-query",
  "@tanstack/react-router",
  "@fontsource/barlow-condensed",
  "@fontsource/be-vietnam-pro",
];

/** Hosts written in the source that are links for a person to follow or our own addresses, not somewhere the product sends data. */
export const LINK_ONLY_HOSTS: readonly string[] = [
  "www.facebook.com", // the club's Facebook page link
  "threewolves.sanity.studio", // link to the content editor
  "threewolvesbadminton.org",
  "houseofbarber.co.nz", // a sponsor's link
  "luvallplay.com",
  "app.luvallplay.com",
  "api.luvallplay.com",
  "apps.apple.com", // store links
  "play.google.com",
  "files.test", // the in-memory test storage
];

export function serviceSwitchedOff(by: ServiceSwitch, env: Record<string, string | undefined>): boolean {
  const value = (env[by.env] ?? "").trim().toLowerCase();
  if (by.is && !by.is.includes(value)) return false;
  if (by.isNot && by.isNot.includes(value)) return false;
  return true;
}

export type RegionFinding = { service: string; status: RegionStatus["status"]; ok: boolean; detail: string };

/**
 * What a region's build may and may not do with the services its code uses.
 * `env` is the build's settings: a switched-off service is only fine when its
 * setting really is in the "off" position.
 */
export function checkRegion(region: Region, usedServiceIds: readonly string[], env: Record<string, string | undefined>, services: readonly RegionalService[] = REGIONAL_SERVICES): RegionFinding[] {
  return services
    .filter((s) => usedServiceIds.includes(s.id))
    .map((s) => {
      const r = s.regions[region];
      if (r.status === "approved") return { service: s.id, status: r.status, ok: true, detail: r.decision ? `decision: ${r.decision}` : "" };
      if (r.status === "switched-off") {
        const off = serviceSwitchedOff(r.by, env);
        return { service: s.id, status: r.status, ok: off, detail: off ? `off by ${r.by.env}` : `${r.by.env} must be ${r.by.is ? `one of [${r.by.is.map((v) => v || "not set").join(", ")}]` : `none of [${r.by.isNot!.join(", ")}]`} in this region` };
      }
      return { service: s.id, status: r.status, ok: false, detail: `${r.why} Needs: ${r.needs}` };
    });
}

/**
 * The rule itself (§6.9): a service approved for the Vietnam region that
 * receives personal data outside it must name its written decision.
 * Returns the ids that break the rule.
 */
export function approvedWithoutDecision(services: readonly RegionalService[] = REGIONAL_SERVICES): string[] {
  return services.filter((s) => s.regions.han.status === "approved" && s.personalData.length > 0 && s.processedIn !== "Vietnam" && !s.regions.han.decision).map((s) => s.id);
}
