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
// empty by default, read in production too. Outside production
// SOCIAL_AVAILABILITY / MARKET_AVAILABILITY ("available" or "beta") also
// opens it, for tests and previews, as JUNIORS_AVAILABILITY does for Juniors.
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

/** Whether this deployment lets `clubId` have the module. The club's own switch (its tenant_modules row) is asked separately. */
export function pilotModuleOn(id: PilotModule, clubId: number | null | undefined, env: Env = process.env): boolean {
  const names = PILOT_SETTINGS[id];
  if (typeof clubId === "number" && Number.isInteger(clubId) && pilotClubs(env[names.list]).has(clubId)) return true;
  if (env.VERCEL_ENV === "production") return false;
  const word = env[names.availability]?.trim().toLowerCase();
  return word === "available" || word === "beta";
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
