// Host → club → region (build plan §6.4, §6.9; test plan §3.16 and R1).
//
// Pure: no I/O. The app supplies the lookup (Edge Config, then the
// database) and acts on the decision.
//
// The rule is "fail closed":
//   - a host nobody registered is not served (never "the default club");
//   - a club that lives in another region is refused by this deployment;
//   - a region this code doesn't know is refused;
//   - when the lookup itself can't answer, nothing is served.

/** The regions that exist. A club row naming any other region is refused. */
export const REGIONS = ["syd", "han"] as const;
export type Region = (typeof REGIONS)[number];
export const isRegion = (v: unknown): v is Region => typeof v === "string" && (REGIONS as readonly string[]).includes(v);

/** What a registered club host points at. */
export type HostEntry = { tenant: string; region: string };

/** The platform's own hosts (§6.4). They belong to no club. */
export type PlatformHostKind = "marketing" | "app" | "admin" | "api";

export type HostKind = PlatformHostKind | "club-subdomain" | "custom-domain" | "deployment";

export type HostDecision =
  /** Serve this club from this deployment. */
  | { action: "serve"; kind: "club-subdomain" | "custom-domain" | "deployment"; tenant: string; region: Region }
  /** One of the platform's own hosts. */
  | { action: "platform"; kind: PlatformHostKind }
  /** The club exists, in another region: this deployment refuses it. */
  | { action: "wrong-region"; tenant: string; region: Region }
  /** Not served, with the reason. */
  | { action: "refuse"; reason: "unknown-host" | "unknown-region" | "lookup-unavailable" | "bad-host" };

export type RoutingOptions = {
  /** The region this deployment is (REGION). */
  region: string;
  /** The platform's apex domains, e.g. ["luvallplay.com", "luvallplay.org"]. Club subdomains live under the first. */
  platformDomains: readonly string[];
  /**
   * Hosts that are this deployment itself (its hosting provider's own URLs,
   * localhost in development). They serve `deploymentTenant`. Only for a
   * deployment that holds one club; leave empty otherwise.
   */
  deploymentHosts?: readonly string[];
  deploymentTenant?: string;
};

/**
 * Lower case, no port, no trailing dot, no leading "www.". Returns null for
 * anything that isn't a plain host name (so a forged Host header can't be
 * used as a lookup key).
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  // IPv6 literals and anything with a path, a user or a space aren't club hosts.
  if (host.startsWith("[")) return null;
  host = host.replace(/:\d{1,5}$/, "").replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (host.length === 0 || host.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) return null;
  return host;
}

const PLATFORM_SUBDOMAINS: Record<string, PlatformHostKind> = { app: "app", admin: "admin", api: "api" };

/** Names a club can't take as a subdomain: the platform's own, and ones that would mislead. */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www", "app", "admin", "api", "mail", "email", "status", "help", "support", "docs", "blog", "cdn", "static", "assets", "auth", "login", "id",
]);

/**
 * What kind of host this is, before any lookup. `slug` is set for a club
 * subdomain ("three-wolves.luvallplay.com" → "three-wolves").
 */
export function classifyHost(host: string, options: Pick<RoutingOptions, "platformDomains" | "deploymentHosts">): { kind: HostKind; slug?: string } {
  if (options.deploymentHosts?.includes(host)) return { kind: "deployment" };
  for (const [i, domain] of options.platformDomains.entries()) {
    if (host === domain) return { kind: "marketing" };
    if (!host.endsWith(`.${domain}`)) continue;
    const label = host.slice(0, -domain.length - 1);
    // The platform's services and the clubs live under the first domain only;
    // anything under the others is the marketing site (it redirects).
    if (i > 0 || label.includes(".")) return { kind: "marketing" };
    if (PLATFORM_SUBDOMAINS[label]) return { kind: PLATFORM_SUBDOMAINS[label] };
    if (RESERVED_SUBDOMAINS.has(label)) return { kind: "marketing" };
    return { kind: "club-subdomain", slug: label };
  }
  return { kind: "custom-domain" };
}

/** The lookup's answer: an entry, null (no such host), or undefined (the lookup couldn't answer). */
export type LookupResult = HostEntry | null | undefined;

/**
 * The decision for a request's host. `lookup` is asked only for club hosts.
 * Never throws: a lookup that throws counts as unavailable.
 */
export async function decideHost(
  rawHost: string | null | undefined,
  lookup: (host: string) => Promise<LookupResult>,
  options: RoutingOptions,
): Promise<HostDecision> {
  const host = normalizeHost(rawHost);
  if (!host) return { action: "refuse", reason: "bad-host" };
  const here = options.region;
  if (!isRegion(here)) return { action: "refuse", reason: "unknown-region" };

  const { kind } = classifyHost(host, options);
  if (kind === "marketing" || kind === "app" || kind === "admin" || kind === "api") return { action: "platform", kind };
  if (kind === "deployment") {
    if (!options.deploymentTenant) return { action: "refuse", reason: "unknown-host" };
    return { action: "serve", kind, tenant: options.deploymentTenant, region: here };
  }

  let entry: LookupResult;
  try {
    entry = await lookup(host);
  } catch {
    entry = undefined;
  }
  if (entry === undefined) return { action: "refuse", reason: "lookup-unavailable" };
  if (entry === null) return { action: "refuse", reason: "unknown-host" };
  if (!entry.tenant || !isRegion(entry.region)) return { action: "refuse", reason: "unknown-region" };
  if (entry.region !== here) return { action: "wrong-region", tenant: entry.tenant, region: entry.region };
  return { action: "serve", kind, tenant: entry.tenant, region: entry.region };
}

/** The HTTP status for a decision that isn't served: 404 unknown, 421 another region's, 503 when the lookup is down. */
export function refusalStatus(decision: HostDecision): number | null {
  if (decision.action === "wrong-region") return 421;
  if (decision.action !== "refuse") return null;
  if (decision.reason === "lookup-unavailable") return 503;
  if (decision.reason === "bad-host") return 400;
  return 404;
}

/**
 * Every host a club answers on, for the lookup table: its subdomain under
 * the platform's first domain, and its custom domain when it has one.
 * ("www." needs no entry: normalizeHost drops it.)
 */
export function hostsForTenant(tenant: { slug: string; customDomain?: string | null }, platformDomain: string): string[] {
  const hosts = [`${tenant.slug}.${platformDomain}`];
  const custom = normalizeHost(tenant.customDomain);
  if (custom) hosts.push(custom);
  return hosts.filter((h, i, all) => normalizeHost(h) === h && all.indexOf(h) === i);
}

/** The key a host is stored under in a key-value store that allows only letters, digits, "_" and "-". */
export function hostKey(host: string): string {
  return `host_${host.replace(/[^a-z0-9-]/g, "_")}`;
}
