import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DataTable, Notice, PageHeader, Section, kit } from "@/components/admin/kit";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { audit, currentAdmin, db, requireAdminActor } from "@/lib/admin-access";
import { FORM_BODY_MAX, FORM_KINDS, FORM_TITLE_MAX, listCurrentForms, mayManageForms, publishForm, retireForm, type ClubForm } from "@/lib/juniors/forms";
import { juniorsClubId } from "@/lib/juniors/module";

// Admin → Juniors → Forms and waivers (build plan §6.8; Phase 3b step 4).
//
// Where a club's owners and admins publish the forms a guardian signs for a
// child. A form's words are never edited: publishing under the same short
// name makes a new version, and every guardian is asked again. Retiring a
// form stops asking for it; the signatures already given are kept.
//
// The page stops while Juniors is off and asks again itself (fail closed).

export const dynamic = "force-dynamic";

const PATH = "/admin/juniors/forms";
const KIND_LABEL: Record<(typeof FORM_KINDS)[number], string> = { waiver: "Waiver", consent: "Consent form" };
const REFUSED: Record<string, string> = {
  forbidden: "Only an owner or admin of the club can publish or retire a form.",
  slug_invalid: "The short name can only have lower-case letters, digits and hyphens, like junior-waiver.",
  kind_invalid: "Choose what kind of form this is.",
  title_required: "Give the form a title.",
  title_too_long: "That title is too long.",
  body_required: "Write the form's words.",
  body_too_long: "The form is too long.",
  unchanged: "Those are the words already published. Nothing was changed.",
  not_found: "There is no form with that short name.",
};

function back(kind: "toast" | "toastError", message: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

async function publish(formData: FormData) {
  "use server";
  const tenantId = await juniorsClubId(db);
  if (tenantId === null) notFound();
  const { ctx } = await requireAdminActor(PATH);
  const slug = String(formData.get("slug") ?? "").trim();
  const result = await publishForm(db, tenantId, { playerId: ctx.player.id, access: ctx.access }, { slug, kind: String(formData.get("kind") ?? ""), title: String(formData.get("title") ?? ""), body: String(formData.get("body") ?? "") });
  if (!result.ok) {
    await audit(ctx, { action: "juniors.form.publish.refused", target: slug.slice(0, 60), meta: { reason: result.code } });
    back("toastError", REFUSED[result.code] ?? "Nothing was changed.");
  }
  // Which form, which kind: the words themselves are in the form's own row, not the log.
  await audit(ctx, { action: "juniors.form.publish", target: result.value.slug, meta: { id: result.value.id, kind: result.value.kind } });
  back("toast", result.value.version === 1 ? "Form published." : `Version ${result.value.version} published. Guardians will be asked to sign again.`);
}

async function retire(formData: FormData) {
  "use server";
  const tenantId = await juniorsClubId(db);
  if (tenantId === null) notFound();
  const { ctx } = await requireAdminActor(PATH);
  const slug = String(formData.get("slug") ?? "");
  const result = await retireForm(db, tenantId, { access: ctx.access }, slug);
  if (!result.ok) {
    await audit(ctx, { action: "juniors.form.retire.refused", target: slug.slice(0, 60), meta: { reason: result.code } });
    back("toastError", REFUSED[result.code] ?? "Nothing was changed.");
  }
  if (result.value.retired) await audit(ctx, { action: "juniors.form.retire", target: slug });
  back("toast", result.value.retired ? "Form retired. Its signatures are kept." : "No change.");
}

type Row = ClubForm & { signatures: number };

export default async function JuniorsFormsPage() {
  const tenantId = await juniorsClubId(db);
  if (tenantId === null) notFound();
  const ctx = await currentAdmin();
  const canManage = ctx?.kind === "player" && mayManageForms(ctx.access);
  const forms = await listCurrentForms(db, tenantId);
  const counts = new Map(
    forms.length
      ? (await db.query(`SELECT form_id, count(*)::int AS n FROM form_signatures WHERE tenant_id = $1 AND form_id = ANY($2::int[]) GROUP BY 1`, [tenantId, forms.map((f) => f.id)])).rows.map((r) => [Number(r.form_id), Number(r.n)])
      : [],
  );
  const rows: Row[] = forms.map((f) => ({ ...f, signatures: counts.get(f.id) ?? 0 }));

  return (
    <div className={adminStyles.page}>
      <PageHeader title="Forms and waivers" subtitle="What a guardian reads and signs for each child. New wording is a new version, and every guardian is asked again." />
      <p>
        <Link href="/admin/juniors">Back to Juniors</Link>
      </p>

      <Section title="Forms the club asks for" id="current">
        <DataTable<Row>
          caption="Forms the club asks for"
          rows={rows}
          rowKey={(r) => r.id}
          empty="The club isn't asking guardians to sign anything yet."
          columns={[
            { key: "title", label: "Form", render: (r) => `${r.title} (${r.slug})` },
            { key: "kind", label: "Kind", render: (r) => KIND_LABEL[r.kind] },
            { key: "version", label: "Version", render: (r) => r.version },
            { key: "signatures", label: "Signed", render: (r) => (r.signatures === 1 ? "1 signature" : `${r.signatures} signatures`) },
            {
              key: "action",
              label: "Action",
              render: (r) =>
                canManage ? (
                  <form action={retire}>
                    <input type="hidden" name="slug" value={r.slug} />
                    <SubmitButton loadingText="Saving…" className={kit.btn} confirmMessage={`Stop asking guardians to sign "${r.title}"? The signatures already given are kept.`}>
                      Retire
                    </SubmitButton>
                  </form>
                ) : null,
            },
          ]}
        />
      </Section>

      {canManage ? (
        <Section title="Publish a form, or new wording for one" id="publish">
          <form action={publish} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
            <label>
              Short name (lower-case letters, digits and hyphens). Use the same one to publish new wording for an existing form.
              <input name="slug" required maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="junior-waiver" autoComplete="off" />
            </label>
            <label>
              Kind
              <select name="kind" required defaultValue="waiver">
                {FORM_KINDS.map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input name="title" required maxLength={FORM_TITLE_MAX} autoComplete="off" />
            </label>
            <label>
              The form&apos;s words
              <textarea name="body" required rows={10} maxLength={FORM_BODY_MAX} />
            </label>
            <p>
              <small>This is not legal advice. Have the club&apos;s own waiver and consent wording checked before asking guardians to sign it.</small>
            </p>
            <div>
              <SubmitButton loadingText="Publishing…" className={kit.btn}>Publish</SubmitButton>
            </div>
          </form>
        </Section>
      ) : (
        <Notice>Only an owner or admin of the club can publish or retire a form.</Notice>
      )}
    </div>
  );
}
