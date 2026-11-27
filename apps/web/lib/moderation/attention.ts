// How many reports wait in a club's own queue: the count beside "Moderation"
// in the admin menu and on Today (lib/admin-attention.ts, key
// `moderationOpen`). Serious reports, and reports about a club's own owners
// and admins, are the platform's queue and are not counted here.
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { defaultTenantSlug } from "../tenant-members.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Open reports in the club's queue. One indexed count; 0 for a club that doesn't exist. */
export async function countOpenClubReports(db: Db, slug = defaultTenantSlug()): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM content_reports r
     WHERE r.queue = 'club' AND r.status = 'open' AND r.club_id = (SELECT id FROM tenants WHERE slug = $1)`,
    [slug],
  );
  return Number(rows[0]?.n ?? 0);
}
