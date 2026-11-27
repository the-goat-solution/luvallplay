// The three settings that say which club a deployment serves and how
// (audit H1 and C7). On production each must be set explicitly: a missing or
// mistyped value used to fall back quietly to Three Wolves (TENANT_SLUG), to
// no row-level security (TENANT_SCOPE) or to Three Wolves' built-in name,
// time zone and currency (CLUB_SETTINGS_SOURCE). Now it stops the server
// instead of serving the wrong club, or every club.
//
//   TENANT_SLUG            the club's slug. Off production: three-wolves.
//   TENANT_SCOPE           off | shadow | enforce (lib/database.ts).
//   CLUB_SETTINGS_SOURCE   constants | shadow | database (lib/club-config.ts).
//                          The built-in constants are Three Wolves' own, so
//                          any other club must use "database".
//
// instrumentation.ts runs assertDeploymentSettings() when a server starts;
// the readers below also refuse at first use. No extensionless relative
// imports: scripts load this file directly with Node.

type Env = Record<string, string | undefined>;

/** The club whose values are built into lib/constants.ts. */
export const BUILT_IN_CLUB = "three-wolves";

export const TENANT_SCOPES = ["off", "shadow", "enforce"] as const;
export const SETTINGS_SOURCES = ["constants", "shadow", "database"] as const;

export class DeploymentSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentSettingsError";
  }
}

const isProduction = (env: Env) => env.VERCEL_ENV === "production";
const value = (env: Env, key: string) => env[key]?.trim() || undefined;

// A job running for one club at a time (lib/tenant-context.ts, the
// scheduled jobs' loop over the region's clubs) names that club here. Kept
// as a hook so this file stays free of node:async_hooks: client components
// load it through lib/club-terms.ts.
let clubInContext: (() => string | undefined) | null = null;
/** For lib/tenant-context.ts only. */
export function setClubContextReader(read: () => string | undefined): void {
  clubInContext = read;
}

/** The club this deployment serves (or the one a job is running for). Production must name it. */
export function tenantSlugSetting(env: Env = process.env): string {
  const running = clubInContext?.();
  if (running) return running;
  const v = value(env, "TENANT_SLUG");
  if (v) return v;
  if (isProduction(env)) throw new DeploymentSettingsError("TENANT_SLUG is not set: production must name its club.");
  return BUILT_IN_CLUB;
}

/**
 * TENANT_SCOPE as written, lower-cased, or undefined when unset off
 * production. Production must set it. (lib/database.ts decides what an
 * unknown value means: enforce, so a typo can't open the door.)
 */
export function tenantScopeSetting(env: Env = process.env): string | undefined {
  const v = value(env, "TENANT_SCOPE")?.toLowerCase();
  if (!v && isProduction(env)) throw new DeploymentSettingsError("TENANT_SCOPE is not set: production must choose off, shadow or enforce.");
  return v;
}

/** CLUB_SETTINGS_SOURCE. Unset off production: constants. A value it doesn't know is refused everywhere. */
export function settingsSourceSetting(env: Env = process.env): (typeof SETTINGS_SOURCES)[number] {
  const v = value(env, "CLUB_SETTINGS_SOURCE")?.toLowerCase();
  if (!v) {
    if (isProduction(env)) throw new DeploymentSettingsError("CLUB_SETTINGS_SOURCE is not set: production must choose constants, shadow or database.");
    return "constants";
  }
  if (!(SETTINGS_SOURCES as readonly string[]).includes(v)) {
    throw new DeploymentSettingsError(`CLUB_SETTINGS_SOURCE is "${v}": expected constants, shadow or database.`);
  }
  return v as (typeof SETTINGS_SOURCES)[number];
}

/** Everything wrong with this deployment's settings (empty when it may start). */
export function deploymentSettingsProblems(env: Env = process.env): string[] {
  const problems: string[] = [];
  const attempt = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (err) {
      if (!(err instanceof DeploymentSettingsError)) throw err;
      problems.push(err.message);
      return undefined;
    }
  };
  const slug = attempt(() => tenantSlugSetting(env));
  const scope = attempt(() => tenantScopeSetting(env));
  const source = attempt(() => settingsSourceSetting(env));
  if (scope && !(TENANT_SCOPES as readonly string[]).includes(scope)) {
    problems.push(`TENANT_SCOPE is "${scope}": expected off, shadow or enforce (an unknown value is treated as enforce).`);
  }
  if (slug && source && slug !== BUILT_IN_CLUB && source !== "database") {
    problems.push(`CLUB_SETTINGS_SOURCE is "${source}" for "${slug}": the built-in settings are ${BUILT_IN_CLUB}'s, so another club must use "database".`);
  }
  return problems;
}

/** Refuses to start a server whose settings would serve the wrong club. */
export function assertDeploymentSettings(env: Env = process.env): void {
  const problems = deploymentSettingsProblems(env);
  if (problems.length) throw new DeploymentSettingsError(`Deployment settings refused:\n- ${problems.join("\n- ")}`);
}
