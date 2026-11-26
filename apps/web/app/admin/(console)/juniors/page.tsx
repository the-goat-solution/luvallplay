import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Badge, DataTable, Notice, PageHeader, Section, kit } from "@/components/admin/kit";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import Link from "next/link";
import { audit, currentAdmin, db, requireAdminActor } from "@/lib/admin-access";
import { requireFreshAdminActor } from "@/lib/admin-step-up";
import { clubClock } from "@/lib/club";
import { getClubToday } from "@/lib/dates";
import { juniorsClubId } from "@/lib/juniors/module";
import { juniorRoster, markJuniorAttendance, rosterDays, type RosterChild } from "@/lib/juniors/roster";
import { SAFETY_CHECK_KINDS, SAFETY_CHECK_MAX_YEARS, listStaffSafety, recordSafetyCheck, revokeSafetyCheck, type SafetyStatus } from "@/lib/juniors/safety";

// Admin → Juniors (build plan §6.8; Phase 3b step 6).
//
// The club's side of Juniors. This first part is the safety checks: who has
// one, when it expires, and (for owners) recording or withdrawing one. No
// valid check, no junior roster (lib/juniors/safety.ts).
//
// The page stops while Juniors is off (packages/modules/src/routes.ts) and
// asks again itself, because Juniors fails closed.

export const dynamic = "force-dynamic";

const PATH = "/admin/juniors";
const KIND_LABEL: Record<(typeof SAFETY_CHECK_KINDS)[number], string> = { "police-vet": "Police vet", "working-with-children": "Working with children check", other: "Other" };
const STATUS: Record<SafetyStatus, { label: string; tone: "good" | "warn" | "bad" | "default" }> = {
  valid: { label: "valid", tone: "good" },
  expires_soon: { label: "expires soon", tone: "warn" },
  expired: { label: "expired", tone: "bad" },
  revoked: { label: "withdrawn", tone: "bad" },
  none: { label: "none recorded", tone: "default" },
};
const REFUSED: Record<string, string> = {
  forbidden: "Only an owner of the club can record or withdraw a safety check.",
  not_staff: "That person has no role in this club.",
  kind_invalid: "Choose the kind of check.",
  dates_invalid: `Check the dates: done on or before today, not yet expired, and no more than ${SAFETY_CHECK_MAX_YEARS} years apart.`,
  reference_too_long: "That reference is too long.",
  not_found: "That record isn't there any more.",
};

function back(kind: "toast" | "toastError", message: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

async function clubToday(): Promise<string> {
  return getClubToday(new Date(), await clubClock()).dateKey;
}

async function record(formData: FormData) {
  "use server";
  const tenantId = await juniorsClubId(db);
  if (tenantId === null) notFound();
  // Recording a check decides who may see children's information: a code from the last few minutes.
  const { ctx } = await requireFreshAdminActor(PATH, "juniors.safety_check.record");
  const userId = Number(formData.get("playerId"));
  const input = { userId, kind: String(formData.get("kind") ?? ""), checkedOn: String(formData.get("startDate") ?? ""), expiresOn: String(formData.get("date") ?? ""), reference: String(formData.get("reference") ?? "") };
  const result = await recordSafetyCheck(db, tenantId, { playerId: ctx.player.id, access: ctx.access }, input, await clubToday());
  if (!result.ok) {
    await audit(ctx, { action: "juniors.safety_check.record.refused", target: String(userId || ""), meta: { reason: result.code } });
    back("toastError", REFUSED[result.code] ?? "Nothing was changed.");
  }
  // Who, which kind and until when: never the club's reference text.
  await audit(ctx, { action: "juniors.safety_check.record", target: String(userId), meta: { playerId: userId, kind: result.value.kind, date: result.value.expiresOn } });
  back("toast", "Safety check recorded.");
}

async function withdraw(formData: FormData) {
  "use server";
  const tenantId = await juniorsClubId(db);
  if (tenantId === null) notFound();
  const { ctx } = await requireFreshAdminActor(PATH, "juniors.safety_check.withdraw");
  const id = Number(formData.get("id"));
  const result = await revokeSafetyCheck(db, tenantId, { playerId: ctx.player.id, access: ctx.access }, id);
  if (!result.ok) {
    await audit(ctx, { action: "juniors.safety_check.withdraw.refused", target: String(id || ""), meta: { reason: result.code } });
    back("toastError", REFUSED[result.code] ?? "Nothing was changed.");
  }
  await audit(ctx, { action: "juniors.safety_check.withdraw", target: String(result.value.userId), meta: { id, playerId: result.value.userId } });
  back("toast", "Safety check withdrawn.");
}

async function mark(formData: FormData) {
  "use server";
  const tenantId = await juniorsClubId(db);
  if (tenantId === null) notFound();
  const { ctx } = await requireAdminActor(PATH);
  const date = String(formData.get("date") ?? "");
  const childId = Number(formData.get("id"));
  const attended = formData.get("on") === "1";
  const result = await markJuniorAttendance(db, tenantId, { playerId: ctx.player.id, access: ctx.access }, { date, childId, attended }, await clubToday());
  const to = `${PATH}?date=${encodeURIComponent(date)}`;
  if (!result.ok) {
    await audit(ctx, { action: "juniors.attendance.refused", target: String(childId || ""), meta: { reason: result.code } });
    revalidatePath(PATH);
    redirect(`${to}&toastError=${encodeURIComponent(result.code === "forbidden" ? "You need a current safety check to do that." : "That child isn't booked on that day.")}`);
  }
  // Which child (by id), which day, came or not: never a name.
  await audit(ctx, { action: "juniors.attendance", target: String(childId), meta: { id: childId, date, on: attended } });
  revalidatePath(PATH);
  redirect(`${to}&toast=${encodeURIComponent(attended ? "Marked as here." : "Mark removed.")}`);
}

type Row = { userId: number; name: string; role: string; status: SafetyStatus; kind: string; expiresOn: string | null; checkId: number | null; live: boolean };

export default async function JuniorsAdminPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const tenantId = await juniorsClubId(db);
  if (tenantId === null) notFound();
  const ctx = await currentAdmin();
  const isOwner = ctx?.kind === "player" && ctx.access.role === "owner";
  const today = await clubToday();
  const staff = await listStaffSafety(db, tenantId, today);
  const names = new Map(
    (await db.query(`SELECT id, first_name, last_name FROM players WHERE id = ANY($1::int[])`, [staff.map((s) => s.userId)])).rows.map((r) => [Number(r.id), `${String(r.first_name ?? "")} ${String(r.last_name ?? "")}`.trim() || `#${r.id}`]),
  );
  const rows: Row[] = staff.map((s) => ({
    userId: s.userId,
    name: names.get(s.userId) ?? `#${s.userId}`,
    role: s.role,
    status: s.status,
    kind: s.check ? KIND_LABEL[s.check.kind] : "",
    expiresOn: s.check?.expiresOn ?? null,
    checkId: s.check?.id ?? null,
    live: s.status === "valid" || s.status === "expires_soon",
  }));
  const missing = rows.filter((r) => !r.live).length;

  // The roster: only with a role and a safety check that is valid today.
  const actor = ctx?.kind === "player" ? { playerId: ctx.player.id, access: ctx.access } : null;
  const days = actor ? await rosterDays(db, tenantId, actor, today) : null;
  const wanted = (await searchParams).date;
  const date = days?.ok ? (days.value.some((d) => d.date === wanted) ? wanted! : days.value[0]?.date) : undefined;
  const roster = actor && date ? await juniorRoster(db, tenantId, actor, date, today) : null;

  return (
    <div className={adminStyles.page}>
      <PageHeader title="Juniors" subtitle="Children under 16 never sign in. A guardian manages each child; the club sees a child only through people with a current safety check." />

      <Section title="Roster" id="roster">
        {!days?.ok ? (
          <Notice>You need a current safety check, recorded below by an owner, to see the junior roster.</Notice>
        ) : days.value.length === 0 ? (
          <p>No child is booked on a coming play day.</p>
        ) : (
          <>
            <p>
              {days.value.map((d) => (
                <Link key={d.date} href={`${PATH}?date=${d.date}`} className={kit.btn} aria-current={d.date === date ? "page" : undefined} style={{ marginRight: 8 }}>
                  {d.date} ({d.children})
                </Link>
              ))}
            </p>
            {roster?.ok && (
              <DataTable<RosterChild>
                caption={`Children booked on ${roster.value.date}`}
                rows={roster.value.children}
                rowKey={(r) => r.childId}
                columns={[
                  { key: "child", label: "Child", render: (r) => `${r.name}${r.birthYear ? ` (born ${r.birthYear})` : ""}` },
                  { key: "guardians", label: "Guardians", render: (r) => r.guardians.map((g) => `${g.name}, ${g.email}${g.phone ? `, ${g.phone}` : ""}`).join("; ") || "—" },
                  { key: "contacts", label: "Emergency contacts", render: (r) => r.emergencyContacts.map((c) => `${c.name}${c.relationship ? ` (${c.relationship})` : ""}: ${c.phone}`).join("; ") || "none recorded" },
                  {
                    key: "note",
                    label: "Medical note",
                    render: (r) =>
                      !r.hasMedicalNote ? "none" : roster.value.canReadMedicalNotes ? <Link href={`${PATH}/child/${r.childId}/medical`}>Read (recorded in the audit log)</Link> : "yes: ask an owner or the coach",
                  },
                  {
                    key: "here",
                    label: "Here",
                    render: (r) => (
                      <form action={mark}>
                        <input type="hidden" name="date" value={roster.value.date} />
                        <input type="hidden" name="id" value={r.childId} />
                        <input type="hidden" name="on" value={r.attended ? "0" : "1"} />
                        <SubmitButton loadingText="Saving…" className={kit.btn}>{r.attended ? "Here ✓ (undo)" : "Mark as here"}</SubmitButton>
                      </form>
                    ),
                  },
                ]}
              />
            )}
          </>
        )}
      </Section>

      <p>
        <Link href="/admin/juniors/forms">Forms and waivers guardians sign</Link>
      </p>

      <Section title="Safety checks" id="safety-checks">
        <p>
          Everyone with a role in the club who works with juniors needs a current safety check recorded here. Without one they can&apos;t open the junior roster. Luvallplay records that a check exists and
          when it expires; it does not carry out or verify the check, and never holds its document or result.
        </p>
        {missing > 0 && <Notice>{missing === 1 ? "1 person has" : `${missing} people have`} no current safety check.</Notice>}
        <DataTable<Row>
          caption="Safety checks"
          rows={rows}
          rowKey={(r) => r.userId}
          columns={[
            { key: "name", label: "Name", render: (r) => r.name },
            { key: "role", label: "Role", render: (r) => r.role },
            { key: "check", label: "Check", render: (r) => r.kind || "—" },
            { key: "expires", label: "Expires", render: (r) => r.expiresOn ?? "—" },
            { key: "status", label: "Status", render: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
            {
              key: "action",
              label: "Action",
              render: (r) =>
                isOwner && r.live && r.checkId ? (
                  <form action={withdraw}>
                    <input type="hidden" name="id" value={r.checkId} />
                    <SubmitButton loadingText="Saving…" className={kit.btn} confirmMessage={`Withdraw the safety check recorded for ${r.name}? They lose access to the junior roster at once.`}>
                      Withdraw
                    </SubmitButton>
                  </form>
                ) : null,
            },
          ]}
        />
      </Section>

      {isOwner ? (
        <Section title="Record a safety check" id="record">
          <form action={record} style={{ display: "grid", gap: 12, maxWidth: 420 }}>
            <label>
              Person
              <select name="playerId" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {rows.map((r) => (
                  <option key={r.userId} value={r.userId}>{r.name} ({r.role})</option>
                ))}
              </select>
            </label>
            <label>
              Kind of check
              <select name="kind" required defaultValue="police-vet">
                {SAFETY_CHECK_KINDS.map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </label>
            <label>
              Done on
              <input type="date" name="startDate" max={today} required />
            </label>
            <label>
              Expires on
              <input type="date" name="date" min={today} required />
            </label>
            <label>
              Your reference (optional): where the club keeps the record
              <input name="reference" maxLength={80} autoComplete="off" />
            </label>
            <p>
              <small>You&apos;ll be asked for a new sign-in code if yours is more than a few minutes old. A check is recorded for at most {SAFETY_CHECK_MAX_YEARS} years.</small>
            </p>
            <div>
              <SubmitButton loadingText="Saving…" className={kit.btn}>Record the check</SubmitButton>
            </div>
          </form>
        </Section>
      ) : (
        <Notice>Only an owner of the club can record or withdraw a safety check.</Notice>
      )}
    </div>
  );
}
