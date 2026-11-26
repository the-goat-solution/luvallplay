// Emails about a deletion request (Phase 3b step 7). They carry no child's
// name, year of birth or any other detail: only that there is something to
// do, or that it was done. Sending never blocks or undoes the action itself.
import { ownerEmails } from "../admin-roles";
import { clubShortName } from "../club-brand";
import { sql } from "../database";
import { getResend } from "../email";
import { getSiteUrl, withDisplayName } from "../email-layout";

function from(): string {
  const f = process.env.EMAIL_FROM;
  if (!f) throw new Error("EMAIL_FROM is not configured");
  return withDisplayName(f);
}

/** To the club's owners: a guardian has asked for a child's information to be deleted. */
export async function notifyClubOfDeletionRequest(): Promise<void> {
  const to = await ownerEmails(sql);
  if (to.length === 0) return;
  await getResend().emails.send({
    from: from(),
    to,
    subject: `${clubShortName()}: a guardian has asked to delete a child's information`,
    text: `A guardian has asked ${clubShortName()} to delete their child's information.\n\nNothing has been deleted yet. An owner or admin needs to confirm it in the admin, under Juniors:\n${getSiteUrl()}/admin/juniors#deletion-requests\n\nOnce confirmed, everything the club holds about the child is deleted for good.`,
  });
}

/** To the guardian who asked: the club has confirmed, and the information is gone. */
export async function notifyGuardianOfDeletion(guardianUserId: number): Promise<void> {
  const row = (await sql.query(`SELECT email FROM players WHERE id = $1 AND deleted_at IS NULL`, [guardianUserId])).rows[0];
  if (!row?.email) return;
  await getResend().emails.send({
    from: from(),
    to: [String(row.email)],
    subject: `${clubShortName()}: your child's information has been deleted`,
    text: `${clubShortName()} has confirmed your request. Everything the club held about your child has been deleted for good: their profile, medical note, emergency contacts, signed forms, bookings and attendance.\n\nIf you didn't ask for this, reply to this email.`,
  });
}
