// club_members: a person's role and status in a club (build plan §6.1).
//
// Phase 3 step 1 (expand): club_roles stays the source for owner, admin and
// coach, and players.leaderboard_visible for the leaderboard flag. This file
// MIRRORS both into club_members, so the new table is ready when reads switch
// (step 11). Nothing reads club_members for access yet.
//
// - mirrorClubMember(db, playerId): after an account is created, a role is
//   granted or removed, or the leaderboard flag changes. Best effort: a
//   failure is logged and never breaks the sign-up or the role change.
// - reconcileClubMembers(db): the whole club in one idempotent statement
//   (the same one migration 0003 backfills with). It repairs anything the
//   mirror missed, e.g. writes made by the previous app version after a
//   rollback. Safe to run any number of times.
//
// Takes a small `Db` (anything with query(text, params)), like
// lib/admin-roles.ts, so the app, scripts and tests share it. No
// extensionless relative imports: scripts load this file directly with Node.

export type Db = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

/** The club this deployment serves until host routing arrives (step 6). */
export function defaultTenantSlug(): string {
  return process.env.TENANT_SLUG?.trim() || "three-wolves";
}

// One row per person IN THE CLUB. Accounts are global, so an account is not
// a member of a club just by existing (audit C1): a row is written for
// someone who is joining ($3), who already has a row, or who holds a role in
// this club. A club role (owner, admin, coach) comes from this club's
// club_roles; without one, the person is a member, and an existing
// member/guest row keeps its role. `status` (the club's own enable/disable
// decision) is never touched here.
const UPSERT = `
INSERT INTO club_members (tenant_id, user_id, role, status, joined_at, leaderboard_visible)
SELECT t.id, p.id, COALESCE(r.role, 'member'), 'active', p.created_at, p.leaderboard_visible
FROM players p
CROSS JOIN tenants t
LEFT JOIN club_roles r ON r.player_id = p.id AND r.tenant_id = t.id
WHERE t.slug = $1 AND ($2::int IS NULL OR p.id = $2)
  AND ($3::boolean OR r.player_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM club_members m WHERE m.tenant_id = t.id AND m.user_id = p.id))
ON CONFLICT (tenant_id, user_id) DO UPDATE SET
  role = CASE
    WHEN EXCLUDED.role <> 'member' THEN EXCLUDED.role
    WHEN club_members.role IN ('owner', 'admin', 'coach') THEN 'member'
    ELSE club_members.role END,
  leaderboard_visible = EXCLUDED.leaderboard_visible,
  updated_at = now()
WHERE club_members.leaderboard_visible IS DISTINCT FROM EXCLUDED.leaderboard_visible
   OR club_members.role IS DISTINCT FROM CASE
    WHEN EXCLUDED.role <> 'member' THEN EXCLUDED.role
    WHEN club_members.role IN ('owner', 'admin', 'coach') THEN 'member'
    ELSE club_members.role END
RETURNING user_id;`;

function isMissingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === "42P01";
}

/** Brings the rows of the club's own people in line. Returns how many rows it wrote. */
export async function reconcileClubMembers(db: Db, slug = defaultTenantSlug()): Promise<number> {
  const { rows } = await db.query(UPSERT, [slug, null, false]);
  return rows.length;
}

/**
 * Makes the person a member of the club (a new account made on the club's
 * site, an accepted invite). Someone already in the club keeps their row.
 * Never throws, like mirrorClubMember.
 */
export async function joinClub(db: Db, playerId: number, slug = defaultTenantSlug()): Promise<void> {
  try {
    await db.query(UPSERT, [slug, playerId, true]);
  } catch (err) {
    if (isMissingTable(err)) return;
    console.error(`[tenants] could not add ${playerId} to the club:`, err);
  }
}

/**
 * Mirrors the role and leaderboard flag of one person in the club (null:
 * everyone in it). It never adds someone who isn't in the club and holds no
 * role in it: that is joinClub.
 * Never throws: the source tables (club_roles, players) already hold the
 * change, and reconcileClubMembers repairs a missed mirror. Don't call it
 * inside an open transaction: a failed statement would abort the transaction.
 */
export async function mirrorClubMember(db: Db, playerId: number | null, slug = defaultTenantSlug()): Promise<void> {
  try {
    await db.query(UPSERT, [slug, playerId, false]);
  } catch (err) {
    // Migration 0003 not applied yet (expand: the app may deploy first).
    if (isMissingTable(err)) return;
    console.error(`[tenants] could not mirror club member ${playerId}:`, err);
  }
}

/** Rows that differ between the sources and club_members. Empty when in step. */
export async function clubMemberDrift(db: Db, slug = defaultTenantSlug()): Promise<{ userId: number; problem: string }[]> {
  const { rows } = await db.query(
    `SELECT p.id AS user_id,
            CASE
              WHEN m.user_id IS NULL THEN 'missing'
              WHEN r.role IS NOT NULL AND m.role <> r.role THEN 'role ' || m.role || ' should be ' || r.role
              WHEN r.role IS NULL AND m.role IN ('owner', 'admin', 'coach') THEN 'role ' || m.role || ' has no club_roles row'
              ELSE 'leaderboard flag differs'
            END AS problem
     FROM players p
     JOIN tenants t ON t.slug = $1
     LEFT JOIN club_roles r ON r.player_id = p.id AND r.tenant_id = t.id
     LEFT JOIN club_members m ON m.tenant_id = t.id AND m.user_id = p.id
     -- Someone with no row and no role here is simply not in this club.
     WHERE (m.user_id IS NULL AND r.role IS NOT NULL)
        OR (r.role IS NOT NULL AND m.role <> r.role)
        OR (r.role IS NULL AND m.role IN ('owner', 'admin', 'coach'))
        OR m.leaderboard_visible <> p.leaderboard_visible
     ORDER BY p.id;`,
    [slug],
  );
  return rows.map((r) => ({ userId: Number(r.user_id), problem: String(r.problem) }));
}
