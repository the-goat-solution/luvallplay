// Host → club → region for this deployment (build plan §6.4 and §6.9;
// Phase 3 step 6). The rules are in @luvallplay/core/host-routing; this file
// supplies the lookup and the settings, and the proxy acts on the answer.
//
// TENANT_ROUTING chooses what happens:
//
//   off      (default) hosts aren't checked: the deployment serves its one
//            club on whatever host reaches it, as before.
//   shadow   every request's host is resolved and a host that would be
//            refused is put on the shadow record (lib/shadow-log.ts), but the
//            request is served.
//   enforce  a host that doesn't resolve to this deployment's club in this
//            region is refused: 404 unknown, 421 another region's club, 503
//            when the lookup can't answer.
//
// Any other value counts as "enforce": a typo must not open the door.
//
// The lookup: Edge Config when EDGE_CONFIG is set (one small read per host,
// cached for a minute), then the tenants table. A host neither knows is
// unknown. If neither can answer, nothing is served.
//
// Until reads are tenant-aware (step 11) a deployment holds one club's
// data, so a host that resolves to a different club in the same region is
// refused too.
import { canonicalClubUrl, clubFromPath, classifyHost, decideHost, hostKey, normalizeHost, refusalStatus, type HostDecision, type LookupResult, type RoutingOptions } from "@luvallplay/core/host-routing";
import { defaultTenantSlug } from "./tenant-members.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export type RoutingMode = "off" | "shadow" | "enforce";

export function routingMode(): RoutingMode {
  const v = process.env.TENANT_ROUTING?.trim().toLowerCase();
  if (!v || v === "off") return "off";
  if (v === "shadow") return "shadow";
  return "enforce";
}

/** The region this deployment is. Sydney unless REGION says otherwise (the first region, §6.9). */
export function deploymentRegion(): string {
  return process.env.REGION?.trim().toLowerCase() || "syd";
}

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => normalizeHost(s)).filter((s): s is string => Boolean(s));

export function routingOptions(): RoutingOptions {
  const platformDomains = list(process.env.PLATFORM_DOMAINS);
  // The hosting provider's own names for this deployment (Vercel sets these),
  // plus any named in DEPLOYMENT_HOSTS, plus localhost outside production.
  const deploymentHosts = [
    ...list(process.env.VERCEL_URL),
    ...list(process.env.VERCEL_BRANCH_URL),
    ...list(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    ...list(process.env.DEPLOYMENT_HOSTS),
    ...(process.env.NODE_ENV === "production" ? [] : ["localhost", "127.0.0.1"]),
  ];
  return {
    region: deploymentRegion(),
    platformDomains: platformDomains.length ? platformDomains : ["luvallplay.com", "luvallplay.org", "luvallplay.nz", "luvallplay.vn"],
    deploymentHosts,
    deploymentTenant: defaultTenantSlug(),
  };
}

// ── The lookup ──────────────────────────────────────────────────────────────

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** Reads one host from Edge Config. null = no such key; undefined = couldn't answer. */
export async function edgeConfigLookup(connection: string, host: string, fetchImpl: Fetch = fetch): Promise<LookupResult> {
  try {
    const url = new URL(connection);
    const token = url.searchParams.get("token");
    const id = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!token || !id) return undefined;
    const res = await fetchImpl(`${url.origin}/${id}/item/${hostKey(host)}?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(1500) });
    if (res.status === 404) return null;
    if (res.status !== 200) return undefined;
    const v = (await res.json()) as { tenant?: unknown; region?: unknown } | null;
    if (!v || typeof v.tenant !== "string" || typeof v.region !== "string") return undefined;
    return { tenant: v.tenant, region: v.region };
  } catch {
    return undefined;
  }
}

/** Reads one host from the tenants table (the source of truth the Edge Config copy is made from). */
export async function databaseLookup(db: Db, host: string, options: Pick<RoutingOptions, "platformDomains" | "deploymentHosts">): Promise<LookupResult> {
  try {
    const { kind, slug } = classifyHost(host, options);
    const { rows } =
      kind === "club-subdomain"
        ? await db.query(`SELECT slug, region FROM tenants WHERE slug = $1 LIMIT 1`, [slug])
        : await db.query(`SELECT slug, region FROM tenants WHERE custom_domain = $1 LIMIT 1`, [host]);
    if (rows.length === 0) return null;
    return { tenant: rows[0].slug as string, region: rows[0].region as string };
  } catch {
    return undefined;
  }
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; entry: LookupResult }>();

/** For tests, and after a club's hosts change. */
export function resetRoutingCache(): void {
  cache.clear();
  shadowSeen.clear();
}

/** The lookup this deployment uses: Edge Config, then the database; answers are kept for a minute. */
export function hostLookup(db: Db, options: RoutingOptions, now: () => number = Date.now, fetchImpl: Fetch = fetch): (host: string) => Promise<LookupResult> {
  return async (host) => {
    const hit = cache.get(host);
    if (hit && now() - hit.at < TTL_MS) return hit.entry;
    const connection = process.env.EDGE_CONFIG?.trim();
    let entry: LookupResult = connection ? await edgeConfigLookup(connection, host, fetchImpl) : undefined;
    // Not in the copy, or the copy can't answer: ask the source.
    if (!entry) {
      const fromDb = await databaseLookup(db, host, options);
      entry = fromDb === undefined ? (entry === null ? null : undefined) : fromDb;
    }
    // "Couldn't answer" is never remembered: the next request asks again.
    if (entry !== undefined) {
      if (cache.size > 500) cache.clear();
      cache.set(host, { at: now(), entry });
    }
    return entry;
  };
}

// ── The decision for a request ──────────────────────────────────────────────

export type RouteVerdict =
  | { serve: true; decision: HostDecision }
  | { serve: false; decision: HostDecision; status: number; reason: string };

/** Whether this deployment serves the host, and if not, with which status. */
export async function routeHost(db: Db, rawHost: string | null | undefined, options: RoutingOptions = routingOptions(), lookup = hostLookup(db, options)): Promise<RouteVerdict> {
  const decision = await decideHost(rawHost, lookup, options);
  if (decision.action === "serve") {
    // One club per deployment until reads are tenant-aware (step 11).
    if (decision.tenant !== options.deploymentTenant) return { serve: false, decision, status: 404, reason: "another-club" };
    return { serve: true, decision };
  }
  if (decision.action === "platform") {
    // The platform's own sites (marketing, app, admin, api: §6.4) aren't part of this deployment yet.
    return { serve: false, decision, status: 404, reason: `platform-${decision.kind}` };
  }
  const status = refusalStatus(decision) ?? 404;
  return { serve: false, decision, status, reason: decision.action === "wrong-region" ? "wrong-region" : decision.reason };
}

// A refused host goes on the shadow record once per server instance (and at
// most 50 distinct hosts, so a scanner can't fill the log).
const shadowSeen = new Set<string>();
export function firstRefusalOf(host: string): boolean {
  if (shadowSeen.has(host) || shadowSeen.size >= 50) return false;
  shadowSeen.add(host);
  return true;
}

/**
 * The hosts the club should answer on, checked through the same lookup the
 * requests use: the daily shadow heartbeat's routing check. Empty = clean.
 */
export async function routingSelfCheck(db: Db, options: RoutingOptions = routingOptions()): Promise<{ checked: string[]; differences: string[] }> {
  const { rows } = await db.query(`SELECT slug, custom_domain FROM tenants WHERE slug = $1`, [options.deploymentTenant]);
  const differences: string[] = [];
  const checked: string[] = [];
  if (rows.length === 0) return { checked, differences: [`no club "${options.deploymentTenant}" in tenants`] };
  const custom = normalizeHost(rows[0].custom_domain as string | null);
  const hosts = [`${options.deploymentTenant}.${options.platformDomains[0]}`, ...(custom ? [custom, `www.${custom}`] : [])];
  const lookup = hostLookup(db, options);
  for (const host of hosts) {
    checked.push(host);
    const verdict = await routeHost(db, host, options, lookup);
    if (!verdict.serve) differences.push(`${host}: ${verdict.reason} (${verdict.status})`);
  }
  return { checked, differences };
}

// ── Clubs without a domain: app.luvallplay.com/{club} (build plan §6.4) ─────
//
// CLUB_PATHS chooses what happens (default off; anything but "on" is off):
//   on   on the platform's app host, "/{club}/…" is that club's page. A club
//        with its own domain is sent there (308); this deployment's club is
//        served at the rest of the path; any other club or unknown slug is a
//        404. Every other host and path is left to the host check above.
//
// Until reads are tenant-aware (step 11) this deployment can only serve its
// own club, so a different club is refused rather than answered with the
// wrong data. Links inside pages are still written from the root, so this is
// only the front door; club-relative links come with step 11.

export function clubPathsOn(): boolean {
  return process.env.CLUB_PATHS?.trim().toLowerCase() === "on";
}

export type ClubPathVerdict =
  | { action: "none" }
  | { action: "redirect"; url: string }
  | { action: "rewrite"; path: string }
  | { action: "refuse"; status: number };

export async function routeClubPath(db: Db, rawHost: string | null | undefined, pathname: string, search = "", options: RoutingOptions = routingOptions()): Promise<ClubPathVerdict> {
  const host = normalizeHost(rawHost);
  if (!host || classifyHost(host, options).kind !== "app") return { action: "none" };
  const club = clubFromPath(pathname);
  if (!club) return { action: "none" };
  let row: Record<string, unknown> | undefined;
  try {
    row = (await db.query(`SELECT slug, region, custom_domain FROM tenants WHERE slug = $1 LIMIT 1`, [club.slug])).rows[0];
  } catch {
    return { action: "refuse", status: 503 };
  }
  if (!row) return { action: "refuse", status: 404 };
  if (row.region !== options.region) return { action: "refuse", status: 421 };
  const canonical = canonicalClubUrl({ customDomain: row.custom_domain as string | null }, club.rest, search);
  if (canonical) return { action: "redirect", url: canonical };
  if (row.slug !== options.deploymentTenant) return { action: "refuse", status: 404 };
  return { action: "rewrite", path: club.rest };
}
