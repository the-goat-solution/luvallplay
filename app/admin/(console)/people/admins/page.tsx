import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Badge, ConfirmButton, DataTable, EmptyState, Notice, PageHeader, Section, Toolbar, kit } from "@/components/admin/kit";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { currentAdmin, db, requireAdminActor } from "@/lib/admin-access";
import {
  CLUB_ROLES,
  RoleError,
  canManageAdmins,
  isClubRole,
  listAdmins,
  listAudit,
  ownerEmails,
  removeRole,
  revokeInvite,
  setRoleByEmail,
  setRoleForPlayer,
  type AdminRow,
  type AuditRow,
  type ClubRole,
} from "@/lib/admin-roles";
import { notifyRoleChange } from "@/lib/admin-notify";
import { formatNz } from "@/components/admin/ui";

// Admin → People → Admins (build plan §2.4). Owners and platform admins add
// admins by email, change roles and remove them. Guardrails live in
// lib/admin-roles.ts (last owner, audit); the middleware already required a
// sign-in within 12 hours, and every action re-checks that here.

export const dynamic = "force-dynamic";

const PATH = "/admin/people/admins";

const ROLE_HELP: Record<ClubRole, string> = {
  owner: "Everything, including adding and removing admins.",
  admin: "Everything except managing admins.",
  coach: "Play days, challenges and day requests.",
};

function back(kind: "toast" | "toastError", message: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

function roleErrorMessage(err: unknown): string {
  if (err instanceof RoleError) {
    if (err.code === "last_owner") return "The club needs at least one owner. Make someone else an owner first.";
    if (err.code === "forbidden") return "Only owners can change admins.";
    if (err.code === "invalid_email") return "That doesn't look like an email address.";
    if (err.code === "invalid_role") return "Pick owner, admin or coach.";
    if (err.code === "not_found") return "That account no longer exists.";
  }
  console.error("[admin] role change failed:", err);
  return "Something went wrong. Nothing was changed.";
}

function actorName(ctx: Awaited<ReturnType<typeof requireAdminActor>>["ctx"]): string {
  return ctx.kind === "player" ? `${ctx.player.firstName} ${ctx.player.lastName}`.trim() || ctx.player.email : "The club (break-glass login)";
}

async function addAdmin(formData: FormData) {
  "use server";
  const { ctx, actor } = await requireAdminActor(PATH);
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "");
  let message: string;
  try {
    const r = await setRoleByEmail(db, actor, { email, role });
    if (r.kind === "unchanged") back("toast", `${email.trim()} is already ${r.role}.`);
    const { admins } = await listAdmins(db);
    const person = r.kind === "invited" ? null : admins.find((a) => a.playerId === r.playerId);
    await notifyRoleChange({
      email: person?.email ?? email.trim().toLowerCase(),
      name: person?.name ?? null,
      role: r.role,
      invited: r.kind === "invited",
      by: actorName(ctx),
      ownerEmails: await ownerEmails(db),
    });
    message =
      r.kind === "invited"
        ? `Invite sent: ${r.email} becomes ${r.role} the first time they sign in.`
        : `${person?.name || email.trim()} is now ${r.role}.`;
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect()
    back("toastError", roleErrorMessage(err));
  }
  back("toast", message);
}

async function changeRole(formData: FormData) {
  "use server";
  const { ctx, actor } = await requireAdminActor(PATH);
  const playerId = Number(formData.get("playerId"));
  const role = String(formData.get("role") ?? "");
  let message: string;
  try {
    if (!Number.isInteger(playerId) || !isClubRole(role)) throw new RoleError("invalid_role");
    const r = await setRoleForPlayer(db, actor, playerId, role);
    const person = (await listAdmins(db)).admins.find((a) => a.playerId === playerId);
    if (r.kind === "granted" && person) {
      await notifyRoleChange({ email: person.email, name: person.name, role, invited: false, by: actorName(ctx), ownerEmails: await ownerEmails(db) });
    }
    message = r.kind === "unchanged" ? "No change." : `${person?.name || "Admin"} is now ${role}.`;
  } catch (err) {
    back("toastError", roleErrorMessage(err));
  }
  back("toast", message);
}

async function removeAdmin(formData: FormData) {
  "use server";
  const { ctx, actor } = await requireAdminActor(PATH);
  const playerId = Number(formData.get("playerId"));
  let message: string;
  try {
    const before = (await listAdmins(db)).admins.find((a) => a.playerId === playerId);
    const { removed } = await removeRole(db, actor, playerId);
    if (removed && before) {
      await notifyRoleChange({ email: before.email, name: before.name, role: null, invited: false, by: actorName(ctx), ownerEmails: await ownerEmails(db) });
    }
    message = removed ? `${before?.name || "Admin"} no longer has admin access.` : "They didn't have a club role.";
  } catch (err) {
    back("toastError", roleErrorMessage(err));
  }
  back("toast", message);
}

async function cancelInvite(formData: FormData) {
  "use server";
  const { actor } = await requireAdminActor(PATH);
  const id = Number(formData.get("inviteId"));
  let ok = false;
  try {
    ok = await revokeInvite(db, actor, id);
  } catch (err) {
    back("toastError", roleErrorMessage(err));
  }
  back(ok ? "toast" : "toastError", ok ? "Invite cancelled." : "That invite was already used or cancelled.");
}

function roleBadge(a: AdminRow) {
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {a.role && <Badge tone={a.role === "owner" ? "owner" : "default"}>{a.role}</Badge>}
      {a.platformAdmin && <Badge tone="good">platform</Badge>}
    </span>
  );
}

function describe(row: AuditRow): string {
  const meta = row.meta ?? {};
  if (row.action === "admin.role_changed") return `role ${String(meta.from)} → ${String(meta.to)}`;
  if (row.action === "admin.granted" || row.action === "admin.invited") return `${row.action.replace("admin.", "")} as ${String(meta.to ?? meta.role)}`;
  if (meta.fields && typeof meta.fields === "object") {
    return Object.entries(meta.fields as Record<string, string>)
      .slice(0, 4)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
  }
  return "";
}

export default async function AdminsPage() {
  const ctx = await currentAdmin();
  const canManage = ctx?.kind === "player" && canManageAdmins(ctx.access);
  const [{ admins, invites }, log] = await Promise.all([listAdmins(db).catch(() => ({ admins: [], invites: [] })), listAudit(db, 60).catch(() => [])]);
  const owners = admins.filter((a) => a.role === "owner").length;

  return (
    <div className={adminStyles.page}>
      <PageHeader title="Admins" subtitle="Who can open club admin, and what they can do. Every change asks for a recent sign-in, is emailed to the person and all owners, and is written to the audit log." />

      {!canManage && <Notice>Only owners (and platform admins) can change admins. You can see the list.</Notice>}

      {canManage && (
        <Section title="Add an admin" id="add">
          <form action={addAdmin}>
            <Toolbar>
              <label className={kit.field}>
                Email
                <input className={kit.input} type="email" name="email" required autoComplete="off" placeholder="name@example.com" style={{ minWidth: 240 }} />
              </label>
              <label className={kit.field}>
                Role
                <select className={kit.select} name="role" defaultValue="admin">
                  {CLUB_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton loadingText="Adding…" className={kit.btn}>
                Add
              </SubmitButton>
            </Toolbar>
            <p className={kit.muted} style={{ margin: 0 }}>
              {CLUB_ROLES.map((r) => `${r}: ${ROLE_HELP[r]}`).join(" · ")} Someone without an account gets an invite that applies when they first sign in.
            </p>
          </form>
        </Section>
      )}

      <Section title={`Club admins (${admins.length})`} id="list">
        <DataTable
          rows={admins}
          rowKey={(a) => a.playerId}
          empty="No one has a club role yet. The grant script (scripts/grant-role.mjs) sets the first owners."
          columns={[
            { key: "name", label: "Name", render: (a) => <strong>{a.name || "—"}</strong> },
            { key: "email", label: "Email", render: (a) => a.email },
            { key: "role", label: "Role", render: roleBadge },
            { key: "since", label: "Since", render: (a) => (a.grantedAt ? formatNz(a.grantedAt) : "—") },
            {
              key: "actions",
              label: "Change",
              render: (a) =>
                canManage && a.role ? (
                  <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                    <form action={changeRole} style={{ display: "inline-flex", gap: 6 }}>
                      <input type="hidden" name="playerId" value={a.playerId} />
                      <select className={kit.select} name="role" defaultValue={a.role} aria-label={`Role for ${a.name || a.email}`}>
                        {CLUB_ROLES.map((r) => (
                          <option key={r} value={r} disabled={a.role === "owner" && r !== "owner" && owners <= 1}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <SubmitButton loadingText="Saving…" className={kit.btnSecondary}>
                        Save
                      </SubmitButton>
                    </form>
                    {!(a.role === "owner" && owners <= 1) && (
                      <form action={removeAdmin}>
                        <input type="hidden" name="playerId" value={a.playerId} />
                        <ConfirmButton confirm={`Remove ${a.name || a.email} from admin?`}>Remove</ConfirmButton>
                      </form>
                    )}
                    {a.role === "owner" && owners <= 1 && <span className={kit.muted}>Last owner</span>}
                  </span>
                ) : null,
            },
          ]}
        />
      </Section>

      {invites.length > 0 && (
        <Section title="Pending invites" id="invites">
          <DataTable
            rows={invites}
            rowKey={(i) => i.id}
            columns={[
              { key: "email", label: "Email", render: (i) => i.email },
              { key: "role", label: "Role", render: (i) => <Badge>{i.role}</Badge> },
              { key: "sent", label: "Sent", render: (i) => formatNz(i.createdAt) },
              {
                key: "x",
                label: "",
                render: (i) =>
                  canManage ? (
                    <form action={cancelInvite}>
                      <input type="hidden" name="inviteId" value={i.id} />
                      <ConfirmButton confirm={`Cancel the invite for ${i.email}?`} tone="secondary">
                        Cancel invite
                      </ConfirmButton>
                    </form>
                  ) : null,
              },
            ]}
          />
        </Section>
      )}

      <Section title="Audit log (latest 60)" id="audit">
        {log.length === 0 ? (
          <EmptyState>Nothing recorded yet.</EmptyState>
        ) : (
          <DataTable
            rows={log}
            rowKey={(r) => r.id}
            columns={[
              { key: "at", label: "When", render: (r) => formatNz(r.at, true) },
              { key: "who", label: "Who", render: (r) => r.actorName ?? (r.actorKind === "player" ? `player ${r.actorPlayerId}` : r.actorKind) },
              { key: "what", label: "What", render: (r) => <code style={{ fontSize: 12 }}>{r.action}</code> },
              { key: "target", label: "Target", render: (r) => r.target ?? "" },
              { key: "detail", label: "Detail", render: (r) => <span className={kit.muted}>{describe(r)}</span> },
            ]}
          />
        )}
      </Section>
    </div>
  );
}
