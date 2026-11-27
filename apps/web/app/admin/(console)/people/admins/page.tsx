import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auditDetailsIn, auditLabelIn, auditOutcomeNoteIn, roleName } from "@/lib/admin-audit-text";
import { adminText } from "@/lib/admin-lang";
import type { AdminKey } from "@luvallplay/i18n/admin";
import type { Lang } from "@luvallplay/i18n";
import { Badge, ConfirmButton, DataTable, EmptyState, Notice, PageHeader, Section, Toolbar, kit } from "@/components/admin/kit";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { currentAdmin, db, requireAdminActor } from "@/lib/admin-access";
import { requireFreshAdminActor } from "@/lib/admin-step-up";
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
import { mirrorClubMember } from "@/lib/tenant-members";
import { formatNz } from "@/components/admin/ui";

// Admin → People → Admins (build plan §2.4). Owners and platform admins add
// admins by email, change roles and remove them. Guardrails live in
// lib/admin-roles.ts (last owner, audit); the middleware already required a
// sign-in within 12 hours, and every action re-checks that here. Adding,
// changing or removing an admin also needs a code entered in the last five
// minutes (lib/admin-step-up.ts).

export const dynamic = "force-dynamic";

const PATH = "/admin/people/admins";

type T = Awaited<ReturnType<typeof adminText>>["t"];
const roleHelp = (t: T, r: ClubRole) => t(`role_${r}_help` as AdminKey);

function back(kind: "toast" | "toastError", message: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

function roleErrorMessage(t: T, err: unknown): string {
  if (err instanceof RoleError) {
    if (err.code === "last_owner") return t("adm_err_last_owner");
    if (err.code === "forbidden") return t("adm_err_forbidden");
    if (err.code === "invalid_email") return t("adm_err_email");
    if (err.code === "invalid_role") return t("adm_err_role");
    if (err.code === "not_found") return t("adm_err_not_found");
  }
  console.error("[admin] role change failed:", err);
  return t("adm_err_generic");
}

function actorName(ctx: Awaited<ReturnType<typeof requireAdminActor>>["ctx"]): string {
  return `${ctx.player.firstName} ${ctx.player.lastName}`.trim() || ctx.player.email;
}

async function addAdmin(formData: FormData) {
  "use server";
  // Changing who is an admin needs a code entered in the last five minutes (H8).
  const { ctx, actor } = await requireFreshAdminActor(PATH, "admin.granted");
  const { t, lang } = await adminText();
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "");
  let message: string;
  try {
    const r = await setRoleByEmail(db, actor, { email, role });
    if (r.kind === "granted") await mirrorClubMember(db, r.playerId);
    if (r.kind === "unchanged") back("toast", t("adm_msg_already", { email: email.trim(), role: roleName(lang, r.role) }));
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
        ? t("adm_msg_invited", { email: r.email, role: roleName(lang, r.role) })
        : t("adm_msg_now", { name: person?.name || email.trim(), role: roleName(lang, r.role) });
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect()
    back("toastError", roleErrorMessage(t, err));
  }
  back("toast", message);
}

async function changeRole(formData: FormData) {
  "use server";
  const playerId = Number(formData.get("playerId"));
  const { ctx, actor } = await requireFreshAdminActor(PATH, "admin.role_changed", `player:${playerId}`);
  const { t, lang } = await adminText();
  const role = String(formData.get("role") ?? "");
  let message: string;
  try {
    if (!Number.isInteger(playerId) || !isClubRole(role)) throw new RoleError("invalid_role");
    const r = await setRoleForPlayer(db, actor, playerId, role);
    if (r.kind === "granted") await mirrorClubMember(db, playerId);
    const person = (await listAdmins(db)).admins.find((a) => a.playerId === playerId);
    if (r.kind === "granted" && person) {
      await notifyRoleChange({ email: person.email, name: person.name, role, invited: false, by: actorName(ctx), ownerEmails: await ownerEmails(db) });
    }
    message = r.kind === "unchanged" ? t("adm_msg_no_change") : t("adm_msg_now", { name: person?.name || t("adm_fallback_name"), role: roleName(lang, role) });
  } catch (err) {
    back("toastError", roleErrorMessage(t, err));
  }
  back("toast", message);
}

async function removeAdmin(formData: FormData) {
  "use server";
  const playerId = Number(formData.get("playerId"));
  const { ctx, actor } = await requireFreshAdminActor(PATH, "admin.removed", `player:${playerId}`);
  const { t } = await adminText();
  let message: string;
  try {
    const before = (await listAdmins(db)).admins.find((a) => a.playerId === playerId);
    const { removed } = await removeRole(db, actor, playerId);
    if (removed) await mirrorClubMember(db, playerId);
    if (removed && before) {
      await notifyRoleChange({ email: before.email, name: before.name, role: null, invited: false, by: actorName(ctx), ownerEmails: await ownerEmails(db) });
    }
    message = removed ? t("adm_msg_removed", { name: before?.name || t("adm_fallback_name") }) : t("adm_msg_no_role");
  } catch (err) {
    back("toastError", roleErrorMessage(t, err));
  }
  back("toast", message);
}

async function cancelInvite(formData: FormData) {
  "use server";
  const { actor } = await requireAdminActor(PATH);
  const { t } = await adminText();
  const id = Number(formData.get("inviteId"));
  let ok = false;
  try {
    ok = await revokeInvite(db, actor, id);
  } catch (err) {
    back("toastError", roleErrorMessage(t, err));
  }
  back(ok ? "toast" : "toastError", ok ? t("adm_msg_invite_cancelled") : t("adm_err_invite_used"));
}

function roleBadge(a: AdminRow, lang: Lang, t: T) {
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {a.role && <Badge tone={a.role === "owner" ? "owner" : "default"}>{roleName(lang, a.role)}</Badge>}
      {a.platformAdmin && <Badge tone="good">{t("adm_badge_platform")}</Badge>}
    </span>
  );
}

function describe(lang: Lang, row: AuditRow): string {
  return [auditOutcomeNoteIn(lang, row.meta), auditDetailsIn(lang, row)].filter(Boolean).join(" · ");
}

export default async function AdminsPage() {
  const { t, lang } = await adminText();
  const ctx = await currentAdmin();
  const canManage = ctx?.kind === "player" && canManageAdmins(ctx.access);
  const [{ admins, invites }, log] = await Promise.all([listAdmins(db).catch(() => ({ admins: [], invites: [] })), listAudit(db, 60).catch(() => [])]);
  const owners = admins.filter((a) => a.role === "owner").length;

  return (
    <div className={adminStyles.page}>
      <PageHeader title={t("adm_title")} subtitle={t("adm_subtitle")} />

      {!canManage && <Notice>{t("adm_notice_readonly")}</Notice>}

      {canManage && (
        <Section title={t("adm_add_title")} id="add">
          <form action={addAdmin}>
            <Toolbar>
              <label className={kit.field}>
                {t("adm_col_email")}
                <input className={kit.input} type="email" name="email" required autoComplete="off" placeholder="name@example.com" style={{ minWidth: 240 }} />
              </label>
              <label className={kit.field}>
                {t("adm_role_label")}
                <select className={kit.select} name="role" defaultValue="admin">
                  {CLUB_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`role_${r}_cap` as AdminKey)}: {roleHelp(t, r).replace(/\.$/, "").toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton loadingText={t("adm_adding")} className={kit.btn}>
                {t("adm_add")}
              </SubmitButton>
            </Toolbar>
            <p className={kit.muted} style={{ margin: 0 }}>
              {t("adm_add_note")}
            </p>
          </form>
        </Section>
      )}

      <Section title={t("adm_list_title", { n: admins.length })} id="list">
        <DataTable
          rows={admins}
          rowKey={(a) => a.playerId}
          empty={t("adm_list_empty")}
          columns={[
            { key: "name", label: t("adm_col_name"), render: (a) => <strong>{a.name || "—"}</strong> },
            { key: "email", label: t("adm_col_email"), render: (a) => a.email },
            { key: "role", label: t("adm_col_role"), render: (a) => roleBadge(a, lang, t) },
            { key: "since", label: t("adm_col_since"), render: (a) => (a.grantedAt ? formatNz(a.grantedAt) : "—") },
            {
              key: "actions",
              label: t("adm_col_change"),
              render: (a) =>
                canManage && a.role ? (
                  <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                    <form action={changeRole} style={{ display: "inline-flex", gap: 6 }}>
                      <input type="hidden" name="playerId" value={a.playerId} />
                      <select className={kit.select} name="role" defaultValue={a.role} aria-label={t("adm_role_for", { name: a.name || a.email })}>
                        {CLUB_ROLES.map((r) => (
                          <option key={r} value={r} disabled={a.role === "owner" && r !== "owner" && owners <= 1}>
                            {roleName(lang, r)}
                          </option>
                        ))}
                      </select>
                      <SubmitButton loadingText={t("play_saving")} className={kit.btnSecondary}>
                        {t("common_save")}
                      </SubmitButton>
                    </form>
                    {!(a.role === "owner" && owners <= 1) && (
                      <form action={removeAdmin}>
                        <input type="hidden" name="playerId" value={a.playerId} />
                        <ConfirmButton confirm={t("adm_remove_confirm", { name: a.name || a.email })}>{t("play_remove")}</ConfirmButton>
                      </form>
                    )}
                    {a.role === "owner" && owners <= 1 && <span className={kit.muted}>{t("adm_last_owner")}</span>}
                  </span>
                ) : null,
            },
          ]}
        />
      </Section>

      {invites.length > 0 && (
        <Section title={t("adm_invites_title")} id="invites">
          <DataTable
            rows={invites}
            rowKey={(i) => i.id}
            columns={[
              { key: "email", label: t("adm_col_email"), render: (i) => i.email },
              { key: "role", label: t("adm_col_role"), render: (i) => <Badge>{roleName(lang, i.role)}</Badge> },
              { key: "sent", label: t("adm_col_sent"), render: (i) => formatNz(i.createdAt) },
              {
                key: "x",
                label: "",
                render: (i) =>
                  canManage ? (
                    <form action={cancelInvite}>
                      <input type="hidden" name="inviteId" value={i.id} />
                      <ConfirmButton confirm={t("adm_cancel_invite_confirm", { email: i.email })} tone="secondary">
                        {t("adm_cancel_invite")}
                      </ConfirmButton>
                    </form>
                  ) : null,
              },
            ]}
          />
        </Section>
      )}

      <Section title={t("adm_audit_title")} id="audit">
        {log.length === 0 ? (
          <EmptyState>{t("adm_audit_empty")}</EmptyState>
        ) : (
          <DataTable
            rows={log}
            rowKey={(r) => r.id}
            columns={[
              { key: "at", label: t("adm_col_when"), render: (r) => formatNz(r.at, true) },
              { key: "who", label: t("adm_col_who"), render: (r) => r.actorName ?? (r.actorKind === "player" ? t("adm_who_player", { id: String(r.actorPlayerId) }) : r.actorKind) },
              { key: "what", label: t("adm_col_what"), render: (r) => <span title={r.action}>{auditLabelIn(lang, r.action)}</span> },
              { key: "target", label: t("adm_col_target"), render: (r) => r.target ?? "" },
              { key: "detail", label: t("adm_col_detail"), render: (r) => <span className={kit.muted}>{describe(lang, r)}</span> },
            ]}
          />
        )}
      </Section>
    </div>
  );
}
