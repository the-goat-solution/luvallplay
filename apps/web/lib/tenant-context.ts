// Scheduled jobs run once for each club of the region (audit H2), each run
// inside that club's context: everything that asks which club this is
// (defaultTenantSlug(), and through it the scoped connection, the club's
// settings, module switches and entitlements) answers with that club.
//
// Server only (node:async_hooks).
//
// Under TENANT_SCOPE=enforce each club's statements run as the app's role for
// that club, so a job can only touch that club's rows. Under off or shadow a
// statement that doesn't name its club itself still reads every club; that
// is why no second club's rows may be in the shared database before enforce
// is live and quiet (build plan §9.2).
import { AsyncLocalStorage } from "node:async_hooks";
import { routeOwner } from "@luvallplay/modules";
import { enabledModules } from "./club-modules.ts";
import { deploymentRegion } from "./tenant-routing.ts";
import { setClubContextReader, tenantSlugSetting } from "./tenant-settings.ts";

const running = new AsyncLocalStorage<string>();
setClubContextReader(() => running.getStore());

type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Runs `fn` as `slug`'s: defaultTenantSlug() answers `slug` inside it. */
export function runAsClub<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  return running.run(slug, fn);
}

/**
 * The clubs a scheduled job runs for: the active clubs of this deployment's
 * region. A deployment's own club is always among them, even before its
 * region or status is filled in (today: Three Wolves, the one club).
 */
export async function regionClubs(db: Db, region = deploymentRegion()): Promise<string[]> {
  const own = tenantSlugSetting();
  const { rows } = await db.query(`SELECT slug FROM tenants WHERE region = $1 AND status = 'active' ORDER BY id;`, [region]);
  const slugs = rows.map((r) => String(r.slug));
  return slugs.includes(own) ? slugs : [own, ...slugs];
}

export type ClubRun<T> = { club: string } & ({ ran: true; result: T } | { ran: false; skipped: string } | { ran: false; error: string });

/**
 * The job's HTTP status over every club: 500 when a club's run threw, 503
 * when a club's run reported `failed: true` (a half of it failed, as
 * sync-finance does), 200 otherwise. So the scheduler still sees a failure.
 */
export function cronStatus(runs: ClubRun<unknown>[]): number {
  if (runs.some((r) => "error" in r)) return 500;
  if (runs.some((r) => r.ran && (r.result as { failed?: unknown } | null)?.failed === true)) return 503;
  return 200;
}

/**
 * Runs a scheduled job once per club of the region, each in its own club's
 * context, and only for clubs that have the job's module on (the core's jobs
 * always run). One club's failure doesn't stop the others; it is logged and
 * reported. `path` is the job's route, which says which module owns it.
 */
export async function forEachClub<T>(db: Db, path: string, job: (club: string) => Promise<T>): Promise<ClubRun<T>[]> {
  const owner = routeOwner(path);
  const runs: ClubRun<T>[] = [];
  for (const club of await regionClubs(db)) {
    runs.push(
      await runAsClub(club, async (): Promise<ClubRun<T>> => {
        try {
          if (owner && owner !== "core" && !(await enabledModules(db)).has(owner)) return { club, ran: false, skipped: `${owner} is off` };
          return { club, ran: true, result: await job(club) };
        } catch (err) {
          console.error(`[cron] ${path} failed for ${club}:`, err);
          return { club, ran: false, error: String((err as Error)?.message ?? err).slice(0, 200) };
        }
      }),
    );
  }
  return runs;
}
