// A durable record of shadow reads (test plan §4.5: "shadow reads clean for
// 7 days"; Phase 3 gate).
//
// A shadow read runs the new way of answering beside the old one and reports
// any difference. Server logs can't be the evidence: the hosting plan keeps
// them for an hour. So each result is a row in admin_audit_log:
//
//   action  shadow.<what>          e.g. shadow.settings
//   target  clean | differ | unavailable
//   meta    { differences: [...], ... }
//
// - A difference is written when it is seen (once per server instance per
//   distinct difference, by the caller).
// - A daily heartbeat (the send-roster cron) writes the day's result for
//   every check, clean or not.
//
// A day is clean only when every check (SHADOW_CHECKS) has a "clean" row
// that day and none has a "differ" or an "unavailable" row: a check that
// couldn't run proves nothing, so it counts against the day (audit C0).
// shadowVerdict() applies that rule; scripts/shadow-report.mjs prints it.
// Writing never throws: a shadow read must not break the request it rides on.
import { compareClubConfig, type Db } from "./club-config.ts";
import { deploymentRegion, routingMode, routingSelfCheck } from "./tenant-routing.ts";
import { CLUB_OWNED_TABLES } from "@luvallplay/db/tenancy";
import { defaultTenantSlug } from "./tenant-members.ts";
import { existingTables, probeTenantIsolation, type PoolLike } from "./tenant-scope.ts";

export type ShadowResult = "clean" | "differ" | "unavailable";

export async function recordShadow(db: Db, what: string, result: ShadowResult, meta: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO admin_audit_log (actor_player_id, actor_kind, action, target, meta) VALUES (NULL, 'system', $1, $2, $3::jsonb);`,
      [`shadow.${what}`.slice(0, 200), result, JSON.stringify(meta)],
    );
  } catch (err) {
    console.error(`[shadow] could not record ${what}:`, err);
  }
}

/** The checks the heartbeat runs each day. A clean day needs every one of them clean. */
export const SHADOW_CHECKS = ["settings", "routing", "tenant-reads"] as const;

/**
 * The daily check of every shadow read that can be run on demand. Returns
 * what it recorded.
 *
 * `db` is the app's usual client (scoped to the club under `enforce`).
 * `pool` is for the row-level-security probe and must be the UNSCOPED pool
 * (lib/database.ts unscopedPool()): the probe names the club itself, and has
 * to be able to name none. `ownerReads: false` when that pool is the app's
 * own login, which can't count rows as the owner.
 */
export async function shadowHeartbeat(
  db: Db,
  pool?: PoolLike,
  { ownerReads = true }: { ownerReads?: boolean } = {},
): Promise<{ what: string; result: ShadowResult; differences: string[] }[]> {
  const out: { what: string; result: ShadowResult; differences: string[] }[] = [];
  try {
    const r = await compareClubConfig(db);
    const differences = [...r.problems, ...r.differences];
    const result: ShadowResult = !r.stored ? "unavailable" : differences.length ? "differ" : "clean";
    await recordShadow(db, "settings", result, { source: r.source, differences, heartbeat: true });
    out.push({ what: "settings", result, differences });
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 200);
    await recordShadow(db, "settings", "unavailable", { error: message, heartbeat: true });
    out.push({ what: "settings", result: "unavailable", differences: [message] });
  }
  // Host routing: the club's own hosts, through the lookup requests use.
  try {
    const r = await routingSelfCheck(db);
    const result: ShadowResult = r.differences.length ? "differ" : "clean";
    await recordShadow(db, "routing", result, { mode: routingMode(), region: deploymentRegion(), checked: r.checked, differences: r.differences, heartbeat: true });
    out.push({ what: "routing", result, differences: r.differences });
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 200);
    await recordShadow(db, "routing", "unavailable", { error: message, heartbeat: true });
    out.push({ what: "routing", result: "unavailable", differences: [message] });
  }
  // Row-level security (steps 10 and 11): the app's role must see exactly the
  // club's rows in every club-owned table, and none with no club named.
  // Needs a connection of its own (a transaction), so only when a pool is passed.
  if (pool) {
    try {
      const { rows } = await db.query(`SELECT id FROM tenants WHERE slug = $1`, [defaultTenantSlug()]);
      if (!rows[0]) throw new Error("the club isn't in tenants");
      // A club-owned table whose migration hasn't run yet is skipped, and
      // named on the record: the deployment may be ahead of its database
      // (migrate first, then merge), and that isn't a leak. verify.mjs,
      // run after every migration, does not skip.
      const { present, missing } = await existingTables(pool, CLUB_OWNED_TABLES);
      if (!present.length) throw new Error("no club-owned table exists");
      const differences = await probeTenantIsolation(pool, rows[0].id as number, present, { ownerReads });
      const result: ShadowResult = differences.length ? "differ" : "clean";
      await recordShadow(db, "tenant-reads", result, {
        tables: present.length,
        ...(missing.length ? { skipped: missing } : {}),
        ...(ownerReads ? {} : { as: "app-login" }),
        differences: differences.slice(0, 20),
        heartbeat: true,
      });
      out.push({ what: "tenant-reads", result, differences });
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 200);
      await recordShadow(db, "tenant-reads", "unavailable", { error: message, heartbeat: true });
      out.push({ what: "tenant-reads", result: "unavailable", differences: [message] });
    }
  }
  return out;
}

export type ShadowDay = { day: string; what: string; clean: number; differ: number; unavailable: number };

/** The record, one line per day and shadow read, newest first. */
export async function shadowReport(db: Db, days = 14): Promise<ShadowDay[]> {
  const { rows } = await db.query(
    `SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, substr(action, 8) AS what,
            count(*) FILTER (WHERE target = 'clean')::int AS clean,
            count(*) FILTER (WHERE target = 'differ')::int AS differ,
            count(*) FILTER (WHERE target = 'unavailable')::int AS unavailable
     FROM admin_audit_log
     WHERE action LIKE 'shadow.%' AND at > now() - ($1::int * INTERVAL '1 day')
     GROUP BY 1, 2 ORDER BY 1 DESC, 2`,
    [days],
  );
  return rows as unknown as ShadowDay[];
}

export type ShadowDayVerdict = { day: string; clean: boolean; reasons: string[] };
export type ShadowVerdict = {
  days: ShadowDayVerdict[];
  /** Clean days in a row, ending at the latest day on the record (today only if its heartbeat has run). */
  streak: number;
  /** The first day of that run, or null. */
  streakFrom: string | null;
  /** Days that aren't clean, from `since` on. */
  failed: string[];
  /** Whether the gate is met: `need` clean days in a row and no failed day since `since`. */
  passed: boolean;
};

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The step 11 gate, from the report's rows (pure). Every day from `since`
 * (default: the first day on the record) to `today` is judged:
 *
 * - clean: every check in SHADOW_CHECKS has a clean row, and no check has a
 *   "differ" or an "unavailable" row;
 * - a day with no rows at all is not clean (the heartbeat didn't run);
 * - today is left out while it has no rows (the heartbeat runs once a day),
 *   and judged like any other day once it has.
 */
export function shadowVerdict(rows: ShadowDay[], { today, since, need = 7 }: { today: string; since?: string; need?: number }): ShadowVerdict {
  const byDay = new Map<string, ShadowDay[]>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  const first = since ?? [...byDay.keys()].sort()[0];
  const days: ShadowDayVerdict[] = [];
  for (let day = first; day && day <= today; day = nextDay(day)) {
    const seen = byDay.get(day) ?? [];
    if (day === today && seen.length === 0) break;
    const reasons: string[] = [];
    if (seen.length === 0) reasons.push("no result recorded (the heartbeat didn't run)");
    else {
      for (const what of SHADOW_CHECKS) {
        const r = seen.find((x) => x.what === what);
        if (!r || r.clean === 0) reasons.push(`${what}: no clean result`);
      }
      for (const r of seen) {
        if (r.differ > 0) reasons.push(`${r.what}: ${r.differ} difference(s)`);
        if (r.unavailable > 0) reasons.push(`${r.what}: unavailable ${r.unavailable} time(s)`);
      }
    }
    days.push({ day, clean: reasons.length === 0, reasons });
  }
  let streak = 0;
  for (let i = days.length - 1; i >= 0 && days[i].clean; i--) streak++;
  const failed = days.filter((d) => !d.clean).map((d) => d.day);
  return { days, streak, streakFrom: streak ? days[days.length - streak].day : null, failed, passed: streak >= need && (since ? failed.length === 0 : true) };
}
