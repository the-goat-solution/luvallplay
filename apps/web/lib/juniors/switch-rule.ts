// The two pure rules behind the Juniors switch, on their own so that both
// lib/club-modules.ts (which modules count as on) and lib/juniors/module.ts
// (the switch itself) can use them without importing each other.
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

/**
 * A module the platform keeps hidden counts as on for a club only when its
 * own guard says so; a row that merely says `enabled` isn't enough.
 * Juniors: the deployment offers it AND an owner's acknowledgement is stored.
 * Forms & waivers (hidden with it): the deployment offers Juniors.
 * Any other hidden module: never.
 */
export function hiddenModuleOn(id: string, settings: unknown, env: Env = process.env): boolean {
  if (id !== "juniors" && id !== "forms-waivers") return false;
  if (juniorsAvailability(env) === "hidden") return false;
  return id === "forms-waivers" || readAcknowledgement(settings) !== null;
}
