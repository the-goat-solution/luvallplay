// @luvallplay/auth: who may do what in admin (build plan §2.4). Pure: no
// database, no Next.js, so the app, scripts and tests share one copy and the
// permission matrix test drives these directly. Reading a player's roles from
// the database stays in the app (apps/web/lib/admin-roles.ts).

export const CLUB_ROLES = ["owner", "admin", "coach"] as const;
export type ClubRole = (typeof CLUB_ROLES)[number];

export function isClubRole(value: unknown): value is ClubRole {
  return typeof value === "string" && (CLUB_ROLES as readonly string[]).includes(value);
}

/** Admin pages need a sign-in (a code) within this long. Player sessions last 90 days. */
export const STEP_UP_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Sensitive actions (switching modules, changing or removing admins, refunds
 * and cancellations, exports, platform grants) need a code entered within
 * this long, however recent the admin sign-in is (audit H8, 25 Nov 2026).
 */
export const ACTION_STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;

export type Access = {
  role: ClubRole | null;
  platformAdmin: boolean;
};

export const NO_ACCESS: Access = { role: null, platformAdmin: false };

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
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
// "/admin/juniors": the junior roster. It is served only while the club has Juniors on, and the roster itself opens only with a valid safety check.
const COACH_PAGES = ["/admin/play-days", "/admin/challenges", "/admin/day-requests", "/admin/juniors"];
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

function signedInWithin(maxAgeMs: number, signedInAt: Date | string | null | undefined, now: number): boolean {
  if (!signedInAt) return false;
  const t = new Date(signedInAt).getTime();
  return Number.isFinite(t) && now - t <= maxAgeMs && t <= now + 60_000;
}

export function isStepUpFresh(signedInAt: Date | string | null | undefined, now: number = Date.now()): boolean {
  return signedInWithin(STEP_UP_MAX_AGE_MS, signedInAt, now);
}

/** Was a code entered recently enough for a sensitive action (ACTION_STEP_UP_MAX_AGE_MS)? */
export function isActionStepUpFresh(signedInAt: Date | string | null | undefined, now: number = Date.now()): boolean {
  return signedInWithin(ACTION_STEP_UP_MAX_AGE_MS, signedInAt, now);
}
