import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ConfirmButton, DataTable, PageHeader, Section, Toolbar, kit } from "@/components/admin/kit";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { currentAdmin, db, requireAdminActor } from "@/lib/admin-access";
import { RoleError, listAdmins, normalizeEmail, setPlatformAdmin } from "@/lib/admin-roles";
import { formatNz } from "@/components/admin/ui";

// Platform → Admins: Luvallplay staff, who have admin rights for every club.
// Only platform admins see this page (lib/admin-roles.ts adminPathAllowed).
// Accounts only (no invites): the person signs in once first.

export const dynamic = "force-dynamic";

const PATH = "/admin/platform/admins";

function back(kind: "toast" | "toastError", message: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

async function addPlatformAdmin(formData: FormData) {
  "use server";
  const { actor } = await requireAdminActor(PATH);
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const { rows } = await db.query(`SELECT id FROM players WHERE email = $1 AND deleted_at IS NULL;`, [email]);
  if (!rows[0]) back("toastError", "No account with that email. Ask them to sign in once, then add them.");
  let added = false;
  try {
    added = await setPlatformAdmin(db, actor, Number(rows[0].id), true);
  } catch (err) {
    back("toastError", err instanceof RoleError && err.code === "forbidden" ? "Only platform admins can do this." : "Something went wrong.");
  }
  back("toast", added ? `${email} is now a platform admin.` : `${email} already was.`);
}

async function removePlatformAdmin(formData: FormData) {
  "use server";
  const { actor } = await requireAdminActor(PATH);
  const playerId = Number(formData.get("playerId"));
  try {
    await setPlatformAdmin(db, actor, playerId, false);
  } catch (err) {
    const msg =
      err instanceof RoleError
        ? err.code === "self"
          ? "You can't remove your own platform access."
          : err.code === "last_owner"
            ? "The last platform admin can't be removed."
            : "Only platform admins can do this."
        : "Something went wrong.";
    back("toastError", msg);
  }
  back("toast", "Platform access removed.");
}

export default async function PlatformAdminsPage() {
  const ctx = await currentAdmin();
  const me = ctx?.kind === "player" ? ctx.player.id : null;
  const platform = (await listAdmins(db)).admins.filter((a) => a.platformAdmin);
  return (
    <div className={adminStyles.page}>
      <PageHeader title="Platform staff" subtitle="Luvallplay staff: admin rights for every club, and this list. Changes are written to the audit log." />
      <Section title="Add a platform admin" id="add">
        <form action={addPlatformAdmin}>
          <Toolbar>
            <label className={kit.field}>
              Email of an existing account
              <input className={kit.input} type="email" name="email" required autoComplete="off" style={{ minWidth: 240 }} />
            </label>
            <SubmitButton loadingText="Adding…" className={kit.btn}>
              Add
            </SubmitButton>
          </Toolbar>
        </form>
      </Section>
      <Section title={`Platform admins (${platform.length})`} id="list">
        <DataTable
          rows={platform}
          rowKey={(a) => a.playerId}
          empty="No platform admins."
          columns={[
            { key: "name", label: "Name", render: (a) => <strong>{a.name || "—"}</strong> },
            { key: "email", label: "Email", render: (a) => a.email },
            { key: "since", label: "Since", render: (a) => (a.grantedAt ? formatNz(a.grantedAt) : "—") },
            {
              key: "x",
              label: "",
              render: (a) =>
                a.playerId === me || platform.length <= 1 ? (
                  <span className={kit.muted}>{a.playerId === me ? "You" : "Last one"}</span>
                ) : (
                  <form action={removePlatformAdmin}>
                    <input type="hidden" name="playerId" value={a.playerId} />
                    <ConfirmButton confirm={`Remove platform access for ${a.name || a.email}?`}>Remove</ConfirmButton>
                  </form>
                ),
            },
          ]}
        />
      </Section>
    </div>
  );
}
