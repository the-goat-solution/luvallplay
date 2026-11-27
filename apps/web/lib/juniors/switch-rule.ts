// The pure rules behind the switches of the modules the platform keeps
// hidden (Juniors; Social, the Marketplace and Moderation), on their own so
// that lib/club-modules.ts (which modules count as on), lib/juniors/module.ts
// (the Juniors switch) and lib/social/access.ts can use them without
// importing each other.
import { MODULES, type Availability } from "@luvallplay/modules";

export type Env = Record<string, string | undefined>;

/**
 * Whether clubs can be offered Juniors on this deployment. The manifest's
 * word is final in production; anywhere else JUNIORS_AVAILABILITY can open
 * it ("available" or "beta") for tests and previews.
 */
export function juniorsAvailability(env: Env = process.env): Availability {
  const manifest = MODULES.find((m) => m.id === "juniors")?.availability ?? "available";
  if (env.VERCEL_ENV === "production") return manifest;
  const override = env.JUNIORS_AVAILABILITY?.trim().toLowerCase();
  return override === "available" || override === "beta" || override === "hidden" ? override : manifest;
}

export type SafeguardingAcknowledgement = { version: string; byPlayerId: number; at: string };

/** The owner's acknowledgement stored with the Juniors switch, or null when there is none (or it is malformed). */
export function readAcknowledgement(settings: unknown): SafeguardingAcknowledgement | null {
  const s = (settings as { safeguarding?: Record<string, unknown> } | null)?.safeguarding;
  if (!s || typeof s.version !== "string" || !s.version || typeof s.at !== "string" || !Number.isInteger(s.byPlayerId)) return null;
  return { version: s.version, byPlayerId: s.byPlayerId as number, at: s.at };
}

// ── Social, the Marketplace and Moderation (decision AQ: built hidden) ──────
// The manifests say "hidden" until gate Z passes. Until then one of them is
// on for a club only when that club is in the module's pilot list:
// SOCIAL_PILOT_TENANTS / MARKET_PILOT_TENANTS, club ids separated by commas,
// empty by default, read everywhere. On a deployment that is provably not
// production (availabilityWordCounts below) SOCIAL_AVAILABILITY /
// MARKET_AVAILABILITY ("available" or "beta") also opens it, for tests and
// previews.
// Nothing else switches these on: not a role, not the club's own settings.

export type PilotModule = "social" | "marketplace";
const PILOT_SETTINGS: Record<PilotModule, { list: string; availability: string }> = {
  social: { list: "SOCIAL_PILOT_TENANTS", availability: "SOCIAL_AVAILABILITY" },
  marketplace: { list: "MARKET_PILOT_TENANTS", availability: "MARKET_AVAILABILITY" },
};

/**
 * The club ids in a pilot list. An entry counts only when it is a plain
 * positive whole number ("12"); a slug, a wildcard, a range, "07" or anything
 * else is nobody, so a typing mistake can't open a module for a club.
 */
export function pilotClubs(raw: string | undefined): Set<number> {
  const ids = new Set<number>();
  for (const part of (raw ?? "").split(",")) {
    const entry = part.trim();
    if (!/^[1-9][0-9]{0,14}$/.test(entry)) continue;
    ids.add(Number(entry));
  }
  return ids;
}

/**
 * Whether SOCIAL_AVAILABILITY / MARKET_AVAILABILITY are listened to here.
 * Only on a deployment that is PROVABLY not production:
 * - Vercel says so: VERCEL_ENV is exactly "preview" or "development";
 * - or there is no VERCEL_ENV and this is not a production build (NODE_ENV
 *   is unset, "development" or "test": scripts, the dev server, unit tests;
 *   `next start` always sets it to "production");
 * - or there is no VERCEL_ENV and this is the end-to-end harness, which runs
 *   the built app with captured email (E2E_OUTBOX=1, scripts/e2e/env.mjs).
 * Everything else counts as production: Vercel's production, a self-hosted
 * production deployment (no VERCEL_ENV at all), and any value this doesn't
 * know ("Production", "staging"). There only the pilot list opens a module.
 */
export function availabilityWordCounts(env: Env = process.env): boolean {
  const vercel = env.VERCEL_ENV;
  if (vercel === "preview" || vercel === "development") return true;
  if (vercel !== undefined && vercel !== "") return false;
  const node = env.NODE_ENV;
  return node === undefined || node === "development" || node === "test" || env.E2E_OUTBOX === "1";
}

/**
 * The clubs this deployment lets have the module: "all", or the listed club
 * ids (lowest first; empty for nobody). The club's own switch (its
 * tenant_modules row) is asked separately.
 */
export function pilotScope(id: PilotModule, env: Env = process.env): "all" | number[] {
  const names = PILOT_SETTINGS[id];
  if (availabilityWordCounts(env)) {
    const word = env[names.availability]?.trim().toLowerCase();
    if (word === "available" || word === "beta") return "all";
  }
  return [...pilotClubs(env[names.list])].sort((a, b) => a - b);
}

/** Whether this deployment lets `clubId` have the module. */
export function pilotModuleOn(id: PilotModule, clubId: number | null | undefined, env: Env = process.env): boolean {
  const scope = pilotScope(id, env);
  return scope === "all" || (typeof clubId === "number" && Number.isInteger(clubId) && scope.includes(clubId));
}

/**
 * A module the platform keeps hidden counts as on for a club only when its
 * own guard says so; a row that merely says `enabled` isn't enough.
 * Juniors: the deployment offers it AND an owner's acknowledgement is stored.
 * Forms & waivers (hidden with it): the deployment offers Juniors.
 * Social, Marketplace: the club is in the pilot list (or, outside
 * production, the availability setting opens it). `clubId` is the club asked
 * about (tenants.id).
 * Moderation (the queue both share): when either of those two is.
 * Any other hidden module: never.
 */
export function hiddenModuleOn(id: string, settings: unknown, env: Env = process.env, clubId?: number | null): boolean {
  if (id === "social" || id === "marketplace") return pilotModuleOn(id, clubId, env);
  if (id === "moderation") return pilotModuleOn("social", clubId, env) || pilotModuleOn("marketplace", clubId, env);
  if (id !== "juniors" && id !== "forms-waivers") return false;
  if (juniorsAvailability(env) === "hidden") return false;
  return id === "forms-waivers" || readAcknowledgement(settings) !== null;
}
