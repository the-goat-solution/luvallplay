import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MODULES, type ModuleGroup } from "@luvallplay/modules";
import { canManageAdmins } from "@luvallplay/auth";
import { Badge, Notice, PageHeader, Section, kit } from "@/components/admin/kit";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { currentAdmin, db, requireAdminActor } from "@/lib/admin-access";
import { recordAdminAction, type AuditOutcome } from "@/lib/admin-audit";
import { listClubModules, setClubModule, setModuleLock, type ModuleRow } from "@/lib/club-modules";

// Admin → Settings → Modules (build plan §6.2.3; Phase 3 step 5).
//
// The minimal switch: every module, whether it is on, and a button. Club
// owners and platform admins change them; other admins can see the list.
// The rules live in the registry (lib/club-modules.ts → canTurnOn /
// canTurnOff): the core never switches, a needed module comes first, a
// module others depend on stays, and a platform lock holds for owners.
// Switching a module off hides it and keeps its data. Every change is in the
// audit log with its outcome ("module.switch", "module.lock").
// Luvallplay staff (platform admins) can also lock a module on or off for the
// club, with a reason the owners see, and unlock it.
// The setup wizard and presets are Phase 6.

export const dynamic = "force-dynamic";

const PATH = "/admin/settings/modules";

const GROUP_TITLE: Record<ModuleGroup, string> = {
  core: "Core (always on)",
  run: "Run your club",
  money: "Money",
  engage: "Engage players",
  global: "Global",
};
const GROUP_ORDER: ModuleGroup[] = ["core", "run", "money", "engage", "global"];

function back(kind: "toast" | "toastError", message: string): never {
  revalidatePath(PATH);
  // The site's sections, tabs and menus follow the switches: refresh every page.
  revalidatePath("/", "layout");
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

async function switchModule(formData: FormData) {
  "use server";
  const { ctx } = await requireAdminActor(PATH);
  if (!canManageAdmins(ctx.access)) back("toastError", "Only owners can switch modules.");
  const moduleId = String(formData.get("moduleId") ?? "");
  const on = formData.get("on") === "1";
  const name = MODULES.find((m) => m.id === moduleId)?.name.en ?? moduleId;
  // The switch's own audit row, with what happened (the proxy's row only says someone tried).
  const record = (outcome: AuditOutcome, extra: { reason?: string; changed?: boolean } = {}) =>
    recordAdminAction(ctx, { action: "module.switch", target: `module:${moduleId}`, outcome, reason: extra.reason, meta: { on, ...(extra.changed === undefined ? {} : { changed: extra.changed }) } });
  let message: string;
  try {
    const result = await setClubModule(db, {
      moduleId,
      on,
      actor: ctx.access.platformAdmin ? "platform-admin" : "owner",
      actorPlayerId: ctx.player.id,
    });
    if (!result.ok) {
      await record("refused", { reason: result.reason });
      back("toastError", result.reason);
    }
    await record("ok", { changed: result.changed });
    message = result.changed ? `${name} is now ${on ? "on" : "off"}.${on ? "" : " Its data is kept."}` : "No change.";
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect()
    console.error("[admin] module switch failed:", err);
    await record("failed");
    back("toastError", "Something went wrong. Nothing was changed.");
  }
  back("toast", message);
}

// Luvallplay staff only: lock a module on or off for the club, or unlock it.
async function lockModule(formData: FormData) {
  "use server";
  const { ctx } = await requireAdminActor(PATH);
  if (!ctx.access.platformAdmin) back("toastError", "Only Luvallplay staff can lock a module.");
  const moduleId = String(formData.get("moduleId") ?? "");
  const raw = String(formData.get("lock") ?? "");
  const lock = raw === "on" || raw === "off" ? raw : null;
  const name = MODULES.find((m) => m.id === moduleId)?.name.en ?? moduleId;
  const record = (outcome: AuditOutcome, extra: { reason?: string; changed?: boolean } = {}) =>
    recordAdminAction(ctx, { action: "module.lock", target: `module:${moduleId}`, outcome, reason: extra.reason, meta: { lock: lock ?? "unlocked", ...(extra.changed === undefined ? {} : { changed: extra.changed }) } });
  let message: string;
  try {
    const result = await setModuleLock(db, { moduleId, lock, reason: String(formData.get("reason") ?? ""), actor: "platform-admin", actorPlayerId: ctx.player.id });
    if (!result.ok) {
      await record("refused", { reason: result.reason });
      back("toastError", result.reason);
    }
    await record("ok", { changed: result.changed });
    message = !result.changed ? "No change." : lock ? `${name} is locked ${lock}.` : `${name} is unlocked.`;
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect()
    console.error("[admin] module lock failed:", err);
    await record("failed");
    back("toastError", "Something went wrong. Nothing was changed.");
  }
  back("toast", message);
}

export default async function ModulesPage() {
  const ctx = await currentAdmin();
  const canSwitch = ctx?.kind === "player" && canManageAdmins(ctx.access);
  const isStaff = ctx?.kind === "player" && ctx.access.platformAdmin;
  const rows = await listClubModules(db).catch(() => null);
  const state = new Map<string, ModuleRow>((rows ?? []).map((r) => [r.id, r]));

  return (
    <div className={adminStyles.page}>
      <PageHeader
        title="Modules"
        subtitle="What the club has switched on. Switching a module off hides its pages, stops its scheduled jobs and keeps its data; switching it back on brings everything back."
      />
      {!rows && <Notice>The club&apos;s modules can&apos;t be read right now, so every module counts as on.</Notice>}
      {rows && !canSwitch && <Notice>Only owners (and platform admins) can switch modules. You can see the list.</Notice>}

      {GROUP_ORDER.map((group) => {
        const modules = MODULES.filter((m) => m.group === group);
        if (modules.length === 0) return null;
        return (
          <Section key={group} title={GROUP_TITLE[group]}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
              {modules.map((m) => {
                const s = state.get(m.id);
                const on = m.core ? true : (s?.enabled ?? true);
                const lockedForMe = Boolean(s?.locked) && !isStaff;
                return (
                  <li key={m.id} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{m.name.en}</strong>
                      <Badge tone={on ? "good" : "default"}>{on ? "on" : "off"}</Badge>
                      {s?.locked && <Badge>locked by Luvallplay{s.lockReason ? `: ${s.lockReason}` : ""}</Badge>}
                      {m.requires?.length ? <small>needs {m.requires.map((d) => MODULES.find((x) => x.id === d)?.name.en ?? d).join(", ")}</small> : null}
                    </span>
                    {rows && isStaff && !m.core && (
                      <form action={lockModule} style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <input type="hidden" name="moduleId" value={m.id} />
                        {s?.locked ? (
                          <input type="hidden" name="lock" value="" />
                        ) : (
                          <>
                            <select name="lock" defaultValue="off" aria-label={`Lock ${m.name.en}`} className={kit.input}>
                              <option value="off">Lock off</option>
                              <option value="on">Lock on</option>
                            </select>
                            <input name="reason" placeholder="Why (owners see this)" maxLength={200} required className={kit.input} />
                          </>
                        )}
                        <SubmitButton loadingText="Saving…" className={kit.btn}>
                          {s?.locked ? "Unlock" : "Lock"}
                        </SubmitButton>
                      </form>
                    )}
                    {rows && canSwitch && !m.core && !lockedForMe && (
                      <form action={switchModule}>
                        <input type="hidden" name="moduleId" value={m.id} />
                        <input type="hidden" name="on" value={on ? "0" : "1"} />
                        <SubmitButton loadingText="Saving…" className={kit.btn}>
                          {on ? "Switch off" : "Switch on"}
                        </SubmitButton>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        );
      })}
    </div>
  );
}
