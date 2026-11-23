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
// - A daily heartbeat (the send-roster cron) writes the day's result, clean
//   or not, so seven clean days are seven "clean" rows and no "differ" row.
//
// scripts/shadow-report.mjs prints the record. Writing never throws: a
// shadow read must not break the request it rides on.
import { compareClubConfig, type Db } from "./club-config.ts";
import { deploymentRegion, routingMode, routingSelfCheck } from "./tenant-routing.ts";

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

/** The daily check of every shadow read that can be run on demand. Returns what it recorded. */
export async function shadowHeartbeat(db: Db): Promise<{ what: string; result: ShadowResult; differences: string[] }[]> {
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
