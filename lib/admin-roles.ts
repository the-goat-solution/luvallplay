// Admin access by player account (build plan §2.4).
//
// Roles live on the player's own account: club_roles (owner | admin | coach)
// for Three Wolves, and platform_admins for Luvallplay staff (the same rights
// for every club, plus Platform → Admins). The tables are created by the
// reviewed migration scripts/migrations/2026-11-phase1-admin-roles.sql, never
// at request time.
//
// Everything here takes a small `Db` (anything with `query(text, params)`),
// so the app (@vercel/postgres), the grant script and the tests (node-postgres)
// share one implementation. No extensionless imports: the grant script loads
// this file directly with Node.
//
// Guardrails, all enforced here rather than in the UI:
// - only owners and platform admins manage admins;
// - the last owner can't be removed or demoted (one statement, owner rows
//   locked, so two owners demoting each other at once can't both win);
// - every change writes an audit row.

import crypto from "node:crypto";

export type Db = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

export const CLUB_ROLES = ["owner", "admin", "coach"] as const;
export type ClubRole = (typeof CLUB_ROLES)[number];

export function isClubRole(value: unknown): value is ClubRole {
  return typeof value === "string" && (CLUB_ROLES as readonly string[]).includes(value);
}

/** Admin pages need a sign-in (a code) within this long. Player sessions last 90 days. */
export const STEP_UP_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** The native app's "Club admin" handoff link. */
export const HANDOFF_TTL_SECONDS = 60;

export type Access = {
  role: ClubRole | null;
  platformAdmin: boolean;
};

export const NO_ACCESS: Access = { role: null, platformAdmin: false };

export type Actor =
  | { kind: "player"; playerId: number; access: Access }
  | { kind: "break-glass" }
  | { kind: "script" };

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isMissingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === "42P01";
}

// ---------------------------------------------------------------------------
// Who may do what (pure; the permission matrix test drives these)
// ---------------------------------------------------------------------------

/** Any admin area at all. */
export function hasAdminAccess(a: Access): boolean {
  return a.platformAdmin || a.role !== null;
}

/** Full club admin (everything except managing admins). */
export function isClubAdmin(a: Access): boolean {
  return a.platformAdmin || a.role === "owner" || a.role === "admin";
}

/** Add, remove or change admins. */
export function canManageAdmins(a: Access): boolean {
  return a.platformAdmin || a.role === "owner";
}

/** Coaches see the play-day side of admin only ("partial" in the matrix). */
const COACH_PAGES = ["/admin/play-days", "/admin/challenges", "/admin/day-requests"];
const OWNER_PAGES = ["/admin/people/admins"];
const PLATFORM_PAGES = ["/admin/platform"];

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** May this person open this admin page (or post its server actions)? */
export function adminPathAllowed(a: Access, path: string): boolean {
  if (!hasAdminAccess(a)) return false;
  if (PLATFORM_PAGES.some((p) => under(path, p))) return a.platformAdmin;
  if (OWNER_PAGES.some((p) => under(path, p))) return canManageAdmins(a);
  if (isClubAdmin(a)) return true;
  // Coach: the admin home (redirects to Play days) and the play-day pages.
  return path === "/admin" || COACH_PAGES.some((p) => under(path, p));
}

/** /api/admin/* (refunds, free months, exports): full club admins only. */
export function adminApiAllowed(a: Access): boolean {
  return isClubAdmin(a);
}

export function isStepUpFresh(signedInAt: Date | string | null | undefined, now: number = Date.now()): boolean {
  if (!signedInAt) return false;
  const t = new Date(signedInAt).getTime();
  return Number.isFinite(t) && now - t <= STEP_UP_MAX_AGE_MS && t <= now + 60_000;
}

// ---------------------------------------------------------------------------
// Reading access
// ---------------------------------------------------------------------------

/**
 * The player's admin access. A pending invite for their email is applied
 * here, so it takes effect the first time they sign in, whichever way they
 * sign in. Missing tables (migration not run yet) mean no access, never an
 * error: the break-glass password still works.
 */
export async function getAccess(db: Db, playerId: number, email?: string | null): Promise<Access> {
  try {
    if (email) await acceptPendingInvite(db, playerId, email);
    const { rows } = await db.query(
      `SELECT
         (SELECT r.role FROM club_roles r WHERE r.player_id = p.id) AS role,
         EXISTS (SELECT 1 FROM platform_admins a WHERE a.player_id = p.id) AS platform
       FROM players p WHERE p.id = $1 AND p.deleted_at IS NULL;`,
      [playerId],
    );
    const row = rows[0];
    if (!row) return NO_ACCESS;
    return { role: isClubRole(row.role) ? row.role : null, platformAdmin: row.platform === true };
  } catch (err) {
    if (isMissingTable(err)) return NO_ACCESS;
    throw err;
  }
}

async function acceptPendingInvite(db: Db, playerId: number, rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const { rows } = await db.query(
    `WITH inv AS (
       UPDATE admin_invites SET accepted_at = NOW(), accepted_player_id = $1
       WHERE email = $2 AND accepted_at IS NULL AND revoked_at IS NULL
       RETURNING id, role, invited_by
     ), granted AS (
       INSERT INTO club_roles (player_id, role, granted_by)
       SELECT $1, role, invited_by FROM inv
       ON CONFLICT (player_id) DO NOTHING
       RETURNING role
     )
     SELECT inv.id, inv.role, inv.invited_by, (SELECT count(*) FROM granted)::int AS granted FROM inv;`,
    [playerId, email],
  );
  const inv = rows[0];
  if (!inv) return;
  await writeAudit(db, {
    actorPlayerId: playerId,
    actorKind: "system",
    action: "admin.invite_accepted",
    target: `player:${playerId}`,
    meta: { inviteId: inv.id, role: inv.role, invitedBy: inv.invited_by, applied: inv.granted === 1 },
  });
}

export type AdminRow = {
  playerId: number;
  name: string;
  email: string;
  role: ClubRole | null;
  platformAdmin: boolean;
  grantedAt: string | null;
};

export type InviteRow = { id: number; email: string; role: ClubRole; createdAt: string };

export async function listAdmins(db: Db): Promise<{ admins: AdminRow[]; invites: InviteRow[] }> {
  const { rows } = await db.query(
    `SELECT p.id, p.first_name, p.last_name, p.email, r.role, (a.player_id IS NOT NULL) AS platform,
            coalesce(r.granted_at, a.granted_at) AS granted_at
     FROM players p
     LEFT JOIN club_roles r ON r.player_id = p.id
     LEFT JOIN platform_admins a ON a.player_id = p.id
     WHERE p.deleted_at IS NULL AND (r.player_id IS NOT NULL OR a.player_id IS NOT NULL)
     ORDER BY CASE r.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'coach' THEN 2 ELSE 3 END, lower(p.first_name), p.id;`,
  );
  const invites = await db.query(
    `SELECT id, email, role, created_at FROM admin_invites
     WHERE accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at;`,
  );
  return {
    admins: rows.map((r) => ({
      playerId: Number(r.id),
      name: `${String(r.first_name ?? "")} ${String(r.last_name ?? "")}`.trim(),
      email: String(r.email),
      role: isClubRole(r.role) ? r.role : null,
      platformAdmin: r.platform === true,
      grantedAt: r.granted_at ? new Date(r.granted_at as string).toISOString() : null,
    })),
    invites: invites.rows.map((r) => ({
      id: Number(r.id),
      email: String(r.email),
      role: r.role as ClubRole,
      createdAt: new Date(r.created_at as string).toISOString(),
    })),
  };
}

/** Live owners' emails, for "an admin was added" notices. */
export async function ownerEmails(db: Db): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT p.email FROM club_roles r JOIN players p ON p.id = r.player_id
     WHERE r.role = 'owner' AND p.deleted_at IS NULL ORDER BY p.id;`,
  );
  return rows.map((r) => String(r.email));
}

/** True when this player is the only live owner (account deletion checks it). */
export async function isLastOwner(db: Db, playerId: number): Promise<boolean> {
  try {
    const { rows } = await db.query(
      `SELECT
         EXISTS (SELECT 1 FROM club_roles WHERE player_id = $1 AND role = 'owner') AS is_owner,
         (SELECT count(*) FROM club_roles r JOIN players p ON p.id = r.player_id
          WHERE r.role = 'owner' AND p.deleted_at IS NULL AND r.player_id <> $1)::int AS others;`,
      [playerId],
    );
    return rows[0]?.is_owner === true && Number(rows[0]?.others) === 0;
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Changing roles
// ---------------------------------------------------------------------------

export type RoleErrorCode = "forbidden" | "last_owner" | "invalid_role" | "invalid_email" | "not_found" | "self";

export class RoleError extends Error {
  code: RoleErrorCode;
  constructor(code: RoleErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

function actorFields(actor: Actor): { actorPlayerId: number | null; actorKind: AuditActorKind } {
  if (actor.kind === "player") return { actorPlayerId: actor.playerId, actorKind: "player" };
  return { actorPlayerId: null, actorKind: actor.kind };
}

function assertCanManage(actor: Actor): void {
  if (actor.kind === "player" && !canManageAdmins(actor.access)) throw new RoleError("forbidden");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SetRoleResult =
  | { kind: "granted"; playerId: number; previousRole: ClubRole | null; role: ClubRole }
  | { kind: "unchanged"; playerId: number; role: ClubRole }
  | { kind: "invited"; inviteId: number; email: string; role: ClubRole };

/**
 * Give someone a club role by email. An existing account gets it straight
 * away; anyone else gets an invite applied on their first sign-in. Changing
 * the last owner to a lesser role is refused.
 */
export async function setRoleByEmail(db: Db, actor: Actor, input: { email: string; role: string }): Promise<SetRoleResult> {
  assertCanManage(actor);
  if (!isClubRole(input.role)) throw new RoleError("invalid_role");
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email) || email.length > 254) throw new RoleError("invalid_email");
  const role = input.role;
  const { actorPlayerId, actorKind } = actorFields(actor);

  const found = await db.query(`SELECT id FROM players WHERE email = $1 AND deleted_at IS NULL;`, [email]);
  const playerId = found.rows[0] ? Number(found.rows[0].id) : null;

  if (playerId === null) {
    // Replace any pending invite for this email with the new role.
    await db.query(
      `UPDATE admin_invites SET revoked_at = NOW() WHERE email = $1 AND accepted_at IS NULL AND revoked_at IS NULL;`,
      [email],
    );
    const { rows } = await db.query(
      `INSERT INTO admin_invites (email, role, invited_by) VALUES ($1, $2, $3) RETURNING id;`,
      [email, role, actorPlayerId],
    );
    const inviteId = Number(rows[0].id);
    await writeAudit(db, { actorPlayerId, actorKind, action: "admin.invited", target: `email:${email}`, meta: { role, inviteId } });
    return { kind: "invited", inviteId, email, role };
  }

  return setRoleForPlayer(db, actor, playerId, role);
}

export async function setRoleForPlayer(db: Db, actor: Actor, playerId: number, role: ClubRole): Promise<SetRoleResult> {
  assertCanManage(actor);
  if (!isClubRole(role)) throw new RoleError("invalid_role");
  const { actorPlayerId, actorKind } = actorFields(actor);

  const before = await db.query(`SELECT role FROM club_roles WHERE player_id = $1;`, [playerId]);
  const previousRole = isClubRole(before.rows[0]?.role) ? (before.rows[0].role as ClubRole) : null;
  if (previousRole === role) return { kind: "unchanged", playerId, role };

  if (previousRole === null) {
    const ins = await db.query(
      `INSERT INTO club_roles (player_id, role, granted_by)
       SELECT id, $2, $3 FROM players WHERE id = $1 AND deleted_at IS NULL
       ON CONFLICT (player_id) DO NOTHING RETURNING role;`,
      [playerId, role, actorPlayerId],
    );
    if (!ins.rows[0]) throw new RoleError("not_found");
  } else {
    // One statement: the owner rows are locked, and an owner is only changed
    // while another live owner remains.
    const upd = await db.query(
      `WITH owners AS (SELECT player_id FROM club_roles WHERE role = 'owner' FOR UPDATE)
       UPDATE club_roles SET role = $2, granted_by = $3, updated_at = NOW()
       WHERE player_id = $1
         AND (role <> 'owner' OR $2 = 'owner' OR (
           SELECT count(*) FROM owners o JOIN players p ON p.id = o.player_id
           WHERE p.deleted_at IS NULL AND o.player_id <> $1) > 0)
       RETURNING role;`,
      [playerId, role, actorPlayerId],
    );
    if (!upd.rows[0]) throw new RoleError("last_owner", "The last owner can't be demoted.");
  }
  await writeAudit(db, {
    actorPlayerId,
    actorKind,
    action: previousRole ? "admin.role_changed" : "admin.granted",
    target: `player:${playerId}`,
    meta: { from: previousRole, to: role },
  });
  return { kind: "granted", playerId, previousRole, role };
}

/** Take away someone's club role. The last owner can't be removed. */
export async function removeRole(db: Db, actor: Actor, playerId: number): Promise<{ removed: ClubRole | null }> {
  assertCanManage(actor);
  const { actorPlayerId, actorKind } = actorFields(actor);
  const { rows } = await db.query(
    `WITH owners AS (SELECT player_id FROM club_roles WHERE role = 'owner' FOR UPDATE)
     DELETE FROM club_roles
     WHERE player_id = $1
       AND (role <> 'owner' OR (
         SELECT count(*) FROM owners o JOIN players p ON p.id = o.player_id
         WHERE p.deleted_at IS NULL AND o.player_id <> $1) > 0)
     RETURNING role;`,
    [playerId],
  );
  if (!rows[0]) {
    const exists = await db.query(`SELECT role FROM club_roles WHERE player_id = $1;`, [playerId]);
    if (exists.rows[0]) throw new RoleError("last_owner", "The last owner can't be removed.");
    return { removed: null };
  }
  const removed = rows[0].role as ClubRole;
  await writeAudit(db, { actorPlayerId, actorKind, action: "admin.removed", target: `player:${playerId}`, meta: { role: removed } });
  return { removed };
}

export async function revokeInvite(db: Db, actor: Actor, inviteId: number): Promise<boolean> {
  assertCanManage(actor);
  const { actorPlayerId, actorKind } = actorFields(actor);
  const { rows } = await db.query(
    `UPDATE admin_invites SET revoked_at = NOW() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email, role;`,
    [inviteId],
  );
  if (!rows[0]) return false;
  await writeAudit(db, { actorPlayerId, actorKind, action: "admin.invite_revoked", target: `email:${rows[0].email}`, meta: { inviteId, role: rows[0].role } });
  return true;
}

/** Platform admins: only platform admins (or the grant script) change this list. */
export async function setPlatformAdmin(db: Db, actor: Actor, playerId: number, on: boolean): Promise<boolean> {
  if (actor.kind === "player" && !actor.access.platformAdmin) throw new RoleError("forbidden");
  if (actor.kind === "player" && !on && actor.playerId === playerId) throw new RoleError("self", "You can't remove your own platform access.");
  const { actorPlayerId, actorKind } = actorFields(actor);
  if (on) {
    const { rows } = await db.query(
      `INSERT INTO platform_admins (player_id, granted_by)
       SELECT id, $2 FROM players WHERE id = $1 AND deleted_at IS NULL
       ON CONFLICT (player_id) DO NOTHING RETURNING player_id;`,
      [playerId, actorPlayerId],
    );
    if (!rows[0]) return false;
  } else {
    const remaining = await db.query(`SELECT count(*)::int AS n FROM platform_admins WHERE player_id <> $1;`, [playerId]);
    if (Number(remaining.rows[0]?.n) === 0) throw new RoleError("last_owner", "The last platform admin can't be removed.");
    const { rowCount } = await db.query(`DELETE FROM platform_admins WHERE player_id = $1;`, [playerId]);
    if (!rowCount) return false;
  }
  await writeAudit(db, { actorPlayerId, actorKind, action: on ? "platform.granted" : "platform.removed", target: `player:${playerId}` });
  return true;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export type AuditActorKind = "player" | "break-glass" | "script" | "system";

export type AuditEntry = {
  actorPlayerId: number | null;
  actorKind: AuditActorKind;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
};

export async function writeAudit(db: Db, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log (actor_player_id, actor_kind, action, target, meta) VALUES ($1, $2, $3, $4, $5::jsonb);`,
    [e.actorPlayerId, e.actorKind, e.action.slice(0, 200), e.target?.slice(0, 300) ?? null, JSON.stringify(e.meta ?? {})],
  );
}

export type AuditRow = AuditEntry & { id: number; at: string; actorName: string | null };

export async function listAudit(db: Db, limit = 100): Promise<AuditRow[]> {
  const { rows } = await db.query(
    `SELECT l.id, l.at, l.actor_player_id, l.actor_kind, l.action, l.target, l.meta,
            nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') AS actor_name
     FROM admin_audit_log l LEFT JOIN players p ON p.id = l.actor_player_id
     ORDER BY l.at DESC, l.id DESC LIMIT $1;`,
    [Math.min(Math.max(limit, 1), 500)],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    at: new Date(r.at as string).toISOString(),
    actorPlayerId: r.actor_player_id === null ? null : Number(r.actor_player_id),
    actorKind: r.actor_kind as AuditActorKind,
    action: String(r.action),
    target: (r.target as string | null) ?? null,
    meta: (r.meta as Record<string, unknown>) ?? {},
    actorName: (r.actor_name as string | null) ?? null,
  }));
}

/**
 * The audit summary of an admin request: method, path, server action id and
 * the posted form fields (values trimmed; anything that looks secret is
 * dropped). Written by the middleware for every admin POST, so refunds, free
 * months, merges, cancellations and stock changes are all on record without
 * each action having to remember.
 */
export function summarizeAdminRequest(input: {
  method: string;
  path: string;
  actionId?: string | null;
  fields?: [string, string][];
}): { action: string; target: string; meta: Record<string, unknown> } {
  const fields: Record<string, string> = {};
  for (const [k, v] of input.fields ?? []) {
    if (/^\$ACTION|^\d+_\$ACTION/.test(k)) continue; // Next.js internals
    if (/pass|secret|token|code|card/i.test(k)) continue;
    if (Object.keys(fields).length >= 20) break;
    fields[k.slice(0, 60)] = v.slice(0, 120);
  }
  const target = fields.id ?? fields.memberId ?? fields.playerId ?? fields.email ?? fields.orderId ?? "";
  return {
    action: `${input.method} ${input.path}`.slice(0, 200),
    target: target ? String(target) : input.path,
    meta: { ...(input.actionId ? { serverAction: input.actionId } : {}), ...(Object.keys(fields).length ? { fields } : {}) },
  };
}

// ---------------------------------------------------------------------------
// Handoff links (native app → admin in the in-app browser, already signed in)
// ---------------------------------------------------------------------------

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function createHandoff(db: Db, playerId: number): Promise<{ token: string; expiresInSeconds: number }> {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO admin_handoffs (token_hash, player_id, expires_at) VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'));`,
    [sha256(token), playerId, HANDOFF_TTL_SECONDS],
  );
  // Old links are useless after a minute; keep the table small.
  await db.query(`DELETE FROM admin_handoffs WHERE expires_at < NOW() - INTERVAL '1 day';`);
  return { token, expiresInSeconds: HANDOFF_TTL_SECONDS };
}

/** Single use: only the request that marks it used gets the player id. */
export async function consumeHandoff(db: Db, token: string): Promise<number | null> {
  if (!token || token.length > 100) return null;
  const { rows } = await db.query(
    `UPDATE admin_handoffs SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
     RETURNING player_id;`,
    [sha256(token)],
  );
  return rows[0] ? Number(rows[0].player_id) : null;
}
