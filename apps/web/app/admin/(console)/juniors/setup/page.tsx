import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Badge, Notice, PageHeader, Section, kit } from "@/components/admin/kit";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { audit, currentAdmin, db, requireAdminActor } from "@/lib/admin-access";
import { juniorsAvailability, juniorsState, switchJuniorsOff, switchJuniorsOn } from "@/lib/juniors/module";
import { SAFEGUARDING_POLICY, SAFEGUARDING_POLICY_VERSION } from "@/lib/juniors/safeguarding-policy";
import { formatNz } from "@/components/admin/ui";

// Admin → Juniors → Set up (build plan §6.8; Phase 3b step 2).
//
// Where a club's owner switches Juniors on: they read the safeguarding
// policy, tick that the club acknowledges it, and need a sign-in code from
// the last few minutes. The rules are in lib/juniors/module.ts.
//
// The page is served while Juniors is off (packages/modules/src/routes.ts),
// and doesn't exist at all while Juniors is hidden platform-wide: that is
// every production deployment during Phase 3b.

export const dynamic = "force-dynamic";

const PATH = "/admin/juniors/setup";

function back(kind: "toast" | "toastError", message: string): never {
  revalidatePath(PATH);
  revalidatePath("/", "layout");
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

async function switchOn(formData: FormData) {
  "use server";
  if (juniorsAvailability() === "hidden") notFound();
  const { ctx } = await requireAdminActor(PATH);
  let message: string;
  try {
    const result = await switchJuniorsOn(db, {
      actor: { playerId: ctx.player.id, access: ctx.access, signedInAt: ctx.signedInAt },
      acknowledged: formData.get("acknowledged") === "1",
      policyVersion: String(formData.get("policyVersion") ?? ""),
    });
    if (!result.ok) {
      // A new code, then straight back here.
      if (result.code === "step_up") redirect(`/login?stepup=1&next=${encodeURIComponent(PATH)}`);
      await audit(ctx, { action: "juniors.switch_on.refused", target: "juniors", meta: { reason: result.code } });
      back("toastError", result.reason);
    }
    // Only what was agreed to and by whom: never anything about a child.
    if (result.changed) await audit(ctx, { action: "juniors.switch_on", target: "juniors", meta: { policyVersion: SAFEGUARDING_POLICY_VERSION } });
    message = result.changed ? "Juniors is now on." : "No change.";
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect()
    console.error("[admin] switching Juniors on failed:", err);
    back("toastError", "Something went wrong. Nothing was changed.");
  }
  back("toast", message);
}

async function switchOff() {
  "use server";
  if (juniorsAvailability() === "hidden") notFound();
  const { ctx } = await requireAdminActor(PATH);
  let message: string;
  try {
    const result = await switchJuniorsOff(db, { playerId: ctx.player.id, access: ctx.access });
    if (!result.ok) back("toastError", result.reason);
    if (result.changed) await audit(ctx, { action: "juniors.switch_off", target: "juniors" });
    message = result.changed ? "Juniors is now off. Its data is kept." : "No change.";
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect()
    console.error("[admin] switching Juniors off failed:", err);
    back("toastError", "Something went wrong. Nothing was changed.");
  }
  back("toast", message);
}

export default async function JuniorsSetupPage() {
  if (juniorsAvailability() === "hidden") notFound();
  const ctx = await currentAdmin();
  const isOwner = ctx?.kind === "player" && ctx.access.role === "owner";
  const canSwitchOff = isOwner || (ctx?.kind === "player" && ctx.access.platformAdmin);
  const state = await juniorsState(db).catch(() => null);
  const mustAcknowledge = state !== null && (!state.on || state.policyOutOfDate);

  return (
    <div className={adminStyles.page}>
      <PageHeader
        title="Juniors"
        subtitle="Children under 16 never sign in. A guardian with their own account adds each child, books and pays for them, and can export or delete the child's information."
      >
        {state && <Badge tone={state.on ? "good" : "default"}>{state.on ? "on" : "off"}</Badge>}
      </PageHeader>

      {!state && <Notice tone="error">The club&apos;s Juniors switch can&apos;t be read right now, so Juniors counts as off.</Notice>}
      {state && !isOwner && <Notice>Only an owner of the club can switch Juniors on.</Notice>}
      {state?.on && state.acknowledgement && (
        <Notice>
          The safeguarding policy (version {state.acknowledgement.version}) was acknowledged on {formatNz(state.acknowledgement.at)}.
          {state.policyOutOfDate ? " It has changed since: an owner needs to read and acknowledge the current one." : ""}
        </Notice>
      )}

      <Section title={`Safeguarding policy (version ${SAFEGUARDING_POLICY_VERSION})`} id="safeguarding">
        <p>By switching Juniors on, the club says each of these is true and will stay true:</p>
        <ol style={{ display: "grid", gap: 8, paddingLeft: 20 }}>
          {SAFEGUARDING_POLICY.map((p) => (
            <li key={p.id}>{p.en}</li>
          ))}
        </ol>
        <p>
          <small>This is not legal advice. Check your own duties for people who work with children (in New Zealand, the Children&apos;s Act 2014) and for children&apos;s personal information.</small>
        </p>

        {state && isOwner && mustAcknowledge && (
          <form action={switchOn} style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <input type="hidden" name="policyVersion" value={SAFEGUARDING_POLICY_VERSION} />
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" name="acknowledged" value="1" required />
              <span>Our club acknowledges this safeguarding policy, and I am an owner who can say so.</span>
            </label>
            <p>
              <small>You&apos;ll be asked for a new sign-in code if yours is more than a few minutes old.</small>
            </p>
            <div>
              <SubmitButton loadingText="Saving…" className={kit.btn}>
                {state.on ? "Acknowledge the current policy" : "Switch Juniors on"}
              </SubmitButton>
            </div>
          </form>
        )}
      </Section>

      {state?.enabled && canSwitchOff && (
        <Section title="Switch off" id="switch-off">
          <p>Switching Juniors off hides it from guardians and admins and keeps every child&apos;s information. Switching it back on asks for the policy again.</p>
          <form action={switchOff}>
            <SubmitButton loadingText="Saving…" className={kit.btn} confirmMessage="Switch Juniors off for the whole club?">
              Switch Juniors off
            </SubmitButton>
          </form>
        </Section>
      )}
    </div>
  );
}
