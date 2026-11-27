// The record of what moderators did (table moderation_actions, migration
// 0023), shared by Social and the Marketplace.
//
// Rules of this file:
// - One row for every action. Rows are only ever added: the app's database
//   role can't change or delete one.
// - A row names ids, the action and a short reason from the moderator (a
//   code, or a sentence). It never holds the content acted on, a report's
//   details, a name, an email or a phone number.
// - A person is the target type "profile" with the account's id, as in
//   content_reports.
// - A wrong action, target or reason here is the caller's mistake, not a
//   person's: it throws, before anything is written.
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { TARGET_TYPES, cleanText, type TargetType } from "@luvallplay/core/social";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Everything a moderator can do. The database's check lists the same. */
export const MODERATION_ACTIONS = ["hide", "restore", "remove", "suspend", "unsuspend", "club_ban", "club_unban", "dismiss"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** The longest reason, in characters. */
export const ACTION_REASON_MAX = 200;

export type ActionInput = {
  /** The moderator's account id. Null: the system (a deadline passed). */
  actorId: number | null;
  targetType: TargetType;
  /** A post's or a comment's id; for a person, the account's id. */
  targetId: number;
  action: ModerationAction;
  /** A short code or sentence. Never the content. */
  reason?: string | null;
  reportId?: number | null;
};

const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** Adds one row to the record. */
export async function recordAction(db: Db, input: ActionInput): Promise<void> {
  const refuse = (what: string) => new Error(`recordAction: ${what}.`);
  if (!(MODERATION_ACTIONS as readonly unknown[]).includes(input.action)) throw refuse("that is not an action");
  if (!(TARGET_TYPES as readonly unknown[]).includes(input.targetType)) throw refuse("that is not a kind of target");
  if (!id(input.targetId)) throw refuse("the target needs its id");
  if (input.actorId !== null && !id(input.actorId)) throw refuse("the actor is an account id, or null for the system");
  if (input.reportId != null && !id(input.reportId)) throw refuse("the report is named by its id");
  let reason: string | null = null;
  if (input.reason != null && input.reason !== "") {
    const cleaned = cleanText(input.reason, ACTION_REASON_MAX);
    if (!cleaned.ok && cleaned.code === "too_long") throw refuse(`the reason is longer than ${ACTION_REASON_MAX} characters`);
    if (!cleaned.ok && typeof input.reason !== "string") throw refuse("the reason is text");
    reason = cleaned.ok ? cleaned.text : null;
  }
  await db.query(`INSERT INTO moderation_actions (actor_id, target_type, target_id, action, reason, report_id) VALUES ($1, $2, $3, $4, $5, $6)`, [
    input.actorId,
    input.targetType,
    input.targetId,
    input.action,
    reason,
    input.reportId ?? null,
  ]);
}
