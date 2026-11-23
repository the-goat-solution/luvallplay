import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MODULES, type ModuleGroup } from "@luvallplay/modules";
import { canManageAdmins } from "@luvallplay/auth";
import { Badge, Notice, PageHeader, Section, kit } from "@/components/admin/kit";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { currentAdmin, db, requireAdminActor } from "@/lib/admin-access";
import { listClubModules, setClubModule, type ModuleRow } from "@/lib/club-modules";

// Admin → Settings → Modules (build plan §6.2.3; Phase 3 step 5).
//
// The minimal switch: every module, whether it is on, and a button. Club
// owners and platform admins change them; other admins can see the list.
// The rules live in the registry (lib/club-modules.ts → canTurnOn /
// canTurnOff): the core never switches, a needed module comes first, a
// module others depend on stays, and a platform lock holds for owners.
// Switching a module off hides it and keeps its data. Every change is in the
// audit log (the proxy records each admin action).
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
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

async function switchModule(formData: FormData) {
  "use server";
  const { ctx } = await requireAdminActor(PATH);
  if (!canManageAdmins(ctx.access)) back("toastError", "Only owners can switch modules.");
  const moduleId = String(formData.get("moduleId") ?? "");
  const on = formData.get("on") === "1";
  const name = MODULES.find((m) => m.id === moduleId)?.name.en ?? moduleId;
  let message: string;
  try {
    const result = await setClubModule(db, {
      moduleId,
      on,
      actor: ctx.access.platformAdmin ? "platform-admin" : "owner",
      actorPlayerId: ctx.player.id,
    });
    if (!result.ok) back("toastError", result.reason);
    message = result.changed ? `${name} is now ${on ? "on" : "off"}.${on ? "" : " Its data is kept."}` : "No change.";
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect()
    console.error("[admin] module switch failed:", err);
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
