import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageHeader, Section } from "@/components/admin/kit";
import adminStyles from "@/components/admin/admin.module.css";
import { audit, currentAdmin, db } from "@/lib/admin-access";
import { clubClock } from "@/lib/club";
import { getClubToday } from "@/lib/dates";
import { juniorsVault, readMedicalNotesForClub } from "@/lib/juniors/care";
import { juniorsClubId } from "@/lib/juniors/module";

// Admin → Juniors → a child's medical note (Phase 3b steps 4 and 6).
//
// Read by an owner, or a coach with a safety check that is valid today; an
// admin never (lib/juniors/safety.ts). Anyone else gets the same "not found"
// as for a child that doesn't exist. EVERY view is written to the audit log:
// who, which child id. The note's words are never logged, cached or put in
// the address.

export const dynamic = "force-dynamic";

export default async function ChildMedicalNotePage({ params }: { params: Promise<{ id: string }> }) {
  const tenantId = await juniorsClubId(db);
  if (tenantId === null) notFound();
  const ctx = await currentAdmin();
  const childId = Number((await params).id);
  if (ctx?.kind !== "player" || !Number.isInteger(childId) || childId <= 0) notFound();
  const today = getClubToday(new Date(), await clubClock()).dateKey;
  const result = await readMedicalNotesForClub(db, juniorsVault(), tenantId, { playerId: ctx.player.id, access: ctx.access }, childId, today);
  if (!result.ok && result.code !== "notes_unavailable") {
    // Refusals are recorded too (never why in detail to the person asking).
    await audit(ctx, { action: "juniors.medical_note.read.refused", target: String(childId), meta: { id: childId, reason: result.code } });
    notFound();
  }
  const child = (await db.query(`SELECT name FROM junior_profiles WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, childId])).rows[0];
  if (!child) notFound();
  if (result.ok) await audit(ctx, { action: "juniors.medical_note.read", target: String(childId), meta: { id: childId } });

  return (
    <div className={adminStyles.page}>
      <PageHeader title={`Medical note: ${String(child.name)}`} subtitle="Written by the child's guardian. Use it only to keep the child safe. This view was recorded in the audit log." />
      <Section title="Note" id="note">
        {!result.ok ? (
          <Notice tone="error">Medical notes can&apos;t be opened on this deployment right now.</Notice>
        ) : result.value.notes ? (
          <p style={{ whiteSpace: "pre-wrap" }} data-medical-note>{result.value.notes}</p>
        ) : (
          <p>No medical note is recorded for this child.</p>
        )}
        <p>
          <Link href="/admin/juniors">Back to the roster</Link>
        </p>
      </Section>
    </div>
  );
}
