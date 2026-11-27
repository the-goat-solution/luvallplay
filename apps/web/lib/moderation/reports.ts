// Reports: a person tells the moderators about a profile, a post or a
// comment (later a listing or a question). Shared by Social and the
// Marketplace. Table content_reports, migration 0023.
//
// Rules of this file:
// - A target is loaded through the same gate the reporter would view it
//   with (lib/social/visible.ts for a profile). One they can't see, one that
//   doesn't exist, their own, and a kind of target nothing is registered
//   for all answer the same `not_found`: reporting can't be used to find out
//   whether something hidden exists.
// - Each kind of target has a loader (registerReportTarget). Profiles are
//   registered here; posts and comments register theirs (Social, Task 4), as
//   do listings and questions (the Marketplace).
// - The row names the target by type and id and holds no content. For a
//   profile the id stored is the account's (what a moderator's action is
//   about, and what stays when the profile is deleted); people send and see
//   the public id only.
// - The reporter's own words are cleaned (as all text is), limited to 1,000
//   characters, and stored only sealed, bound to the report's id
//   (lib/moderation/seal.ts). With no key they are not stored at all, and
//   the report is still taken.
// - Routing. A serious reason (@luvallplay/core/social) is due in 12 hours
//   and goes to the platform's queue; the others are due in 24 and go to the
//   queue of the club the target is in. A report also goes to the platform
//   when the target is in no one club, when it is about an owner or admin of
//   that club, and when that club's roles can't be read from here (the app's
//   role sees one club's roles; a report is never left to a club that the
//   person reported may be moderating).
// - One open report per reporter per target. A repeat is `duplicate` (the
//   app shows it as success) and changes nothing, also when two arrive at
//   once.
// - A `child_safety` report also keeps evidence: a sealed copy of the
//   content as it was, and the author's account id (moderation_evidence),
//   written by the same statement as the report. It stands when the content
//   and the account are deleted. With no key no copy can be kept (it is
//   never stored plain): the report is taken without one, and the system
//   check shows MODERATION_KEKS red.
// - Nothing is hidden, and nobody is suspended, by a report or by a number
//   of reports. A moderator decides.
// - Nothing here logs a report's words, the content, or a person.
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share
// it. The report and its evidence are one statement, so it is all or nothing
// on a pool too.
import { SOCIAL_LIMITS, TARGET_TYPES, cleanText, dueBy, isReportReason, severityOf, type ReportReason, type TargetType } from "@luvallplay/core/social";
import { loadVisibleProfile } from "../social/visible.ts";
import { err, ok, type Result } from "./result.ts";
import type { ModerationSeal } from "./seal.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** What a loader says about a target the reporter may see. */
export type ReportTarget = {
  /** The id stored on the report: a post's or comment's own; for a profile, the account's. */
  targetId: number;
  /** The account that wrote it (for a profile, whose it is). Null when there is none. */
  authorId: number | null;
  /** The club whose space it is in. Null: no one club's. */
  clubId: number | null;
  /** Its words as they are now, by field. Kept (sealed) only for a child-safety report. */
  content: Record<string, string | null>;
};

/**
 * Loads one kind of target for a reporter, through the gate they would view
 * it with. `id` is whatever the person sent (not yet checked). Null when it
 * doesn't exist or they can't see it, without saying which.
 */
export type TargetLoader = (db: Db, reporterId: number, id: unknown) => Promise<ReportTarget | null>;

const loaders = new Map<TargetType, TargetLoader>();

/** Sets (or, with null, removes) the loader for one kind of target. */
export function registerReportTarget(type: TargetType, loader: TargetLoader | null): void {
  if (!(TARGET_TYPES as readonly unknown[]).includes(type)) throw new Error(`registerReportTarget: "${String(type)}" is not a kind of target.`);
  if (loader) loaders.set(type, loader);
  else loaders.delete(type);
}

/**
 * A profile, by its public id. Its club is one the two people share with
 * Social on: this deployment's own when it is one of them, else the first.
 * A profile seen only because it is open to everyone is in no club.
 */
const loadProfileTarget: TargetLoader = async (db, reporterId, publicId) => {
  const profile = await loadVisibleProfile(db, reporterId, publicId);
  if (!profile) return null;
  const { rows } = await db.query(
    `SELECT a.club_id::int AS club_id
     FROM social_clubs_of($1) a(club_id) JOIN social_clubs_of($2) b(club_id) USING (club_id)
     ORDER BY (a.club_id = app_tenant_id()) DESC NULLS LAST, a.club_id LIMIT 1`,
    [reporterId, profile.playerId],
  );
  return {
    targetId: profile.playerId,
    authorId: profile.playerId,
    clubId: rows[0] ? Number(rows[0].club_id) : null,
    content: { displayName: profile.displayName, bio: profile.bio },
  };
};
registerReportTarget("profile", loadProfileTarget);

export type ReportInput = {
  reporterId: number;
  targetType: TargetType;
  /** As the person sent it: a profile's public id, a post's or comment's number. */
  targetId: unknown;
  reason: ReportReason;
  details?: string | null;
};

const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/**
 * Files a report. `duplicate` when this person already has an open report on
 * the same target. A malformed key list throws (the system is broken); a
 * missing one doesn't.
 */
export async function fileReport(db: Db, seal: ModerationSeal, input: ReportInput): Promise<Result<{ id: number }, "not_found" | "duplicate" | "invalid_reason" | "details_too_long">> {
  // What the person typed is checked first, and says nothing about the target.
  if (!isReportReason(input.reason)) return err("invalid_reason");
  const cleaned = cleanText(input.details, SOCIAL_LIMITS.reportDetails);
  if (!cleaned.ok && cleaned.code === "too_long") return err("details_too_long");
  const details = cleaned.ok ? cleaned.text : null;

  if (!isId(input.reporterId)) return err("not_found");
  const load = loaders.get(input.targetType);
  const target = load ? await load(db, input.reporterId, input.targetId) : null;
  if (!target || !isId(target.targetId) || target.authorId === input.reporterId) return err("not_found");

  const open = await db.query(`SELECT 1 FROM content_reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3 AND status = 'open' LIMIT 1`, [
    input.reporterId,
    input.targetType,
    target.targetId,
  ]);
  if (open.rows.length) return err("duplicate");

  // The id first: what is sealed is bound to it.
  const canSeal = seal.available();
  const id = Number((await db.query(`SELECT nextval('content_reports_id_seq') AS id`)).rows[0].id);
  const severity = severityOf(input.reason);
  const createdAt = new Date();
  const detailsSealed = details !== null && canSeal ? seal.seal(id, details) : null;
  const evidence =
    input.reason === "child_safety" && canSeal
      ? seal.sealEvidence(id, JSON.stringify({ targetType: input.targetType, targetId: target.targetId, content: target.content }))
      : null;

  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await db.query(
      `WITH about AS (
         SELECT $5::int AS club_id,
                $5::int IS NOT NULL AND $12::int IS NOT NULL AND (
                     (row_security_active('club_roles') AND app_tenant_id() IS DISTINCT FROM $5::int)
                  OR EXISTS (SELECT 1 FROM club_roles r WHERE r.tenant_id = $5::int AND r.player_id = $12::int AND r.role IN ('owner', 'admin'))
                  OR EXISTS (SELECT 1 FROM club_members m WHERE m.tenant_id = $5::int AND m.user_id = $12::int AND m.role IN ('owner', 'admin'))
                ) AS not_for_the_club
       ), report AS (
         INSERT INTO content_reports (id, reporter_id, target_type, target_id, club_id, reason, severity, queue, details_sealed, due_at, created_at)
         SELECT $1::bigint, $2::int, $3::text, $4::bigint, about.club_id, $6::text, $7::text,
                CASE WHEN $7::text = 'serious' OR about.club_id IS NULL OR about.not_for_the_club THEN 'platform' ELSE 'club' END,
                $8::text, $9::timestamptz, $10::timestamptz
         FROM about
         ON CONFLICT (reporter_id, target_type, target_id) WHERE status = 'open' DO NOTHING
         RETURNING id
       ), kept AS (
         INSERT INTO moderation_evidence (report_id, sealed, author_player_id)
         SELECT report.id, $11::text, $12::int FROM report WHERE $11::text IS NOT NULL
         RETURNING report_id
       )
       SELECT report.id, (SELECT count(*) FROM kept) AS kept FROM report`,
      [id, input.reporterId, input.targetType, target.targetId, target.clubId, input.reason, severity, detailsSealed, dueBy(createdAt, severity), createdAt, evidence, target.authorId],
    ));
  } catch (e) {
    // The reporter is no account (their foreign key): the same answer as anything else that isn't there.
    if ((e as { code?: string }).code === "23503" && (e as { constraint?: string }).constraint === "content_reports_reporter_id_fkey") return err("not_found");
    throw e;
  }
  // Nothing written: another request of theirs got there first.
  if (!rows.length) return err("duplicate");
  return ok({ id });
}
