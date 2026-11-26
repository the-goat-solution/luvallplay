// Per-action step-up (audit H8, 25 Nov 2026). Opening admin needs a sign-in
// within 12 hours; a sensitive action also needs a code entered within the
// last five minutes (ACTION_STEP_UP_MAX_AGE_MS in @luvallplay/auth):
//
//   switching or locking a module · adding, changing or removing an admin ·
//   platform staff · refunds and membership cancellations · exports
//
// When the code is older, nothing is done: the person is sent to the code
// screen and comes back to the page they were on, and the audit log gets a
// "not done" row saying a fresh code was asked for.
import { redirect } from "next/navigation";
import { isActionStepUpFresh } from "@luvallplay/auth";
import { requireAdminActor, type AdminContext } from "./admin-access";
import { STEP_UP_REASON, actionStepUpUrl, recordAdminAction } from "./admin-audit";
import type { Actor } from "./admin-roles";


/**
 * For sensitive server actions: the admin for `path`, with a code entered in
 * the last five minutes. Otherwise it records the refusal and redirects to
 * the code screen (and back to `path`); the action must be pressed again.
 */
export async function requireFreshAdminActor(path: string, action: string, target?: string): Promise<{ ctx: AdminContext; actor: Actor }> {
  const who = await requireAdminActor(path);
  if (!isActionStepUpFresh(who.ctx.signedInAt)) {
    await recordAdminAction(who.ctx, { action, target, outcome: "refused", reason: STEP_UP_REASON });
    redirect(actionStepUpUrl(path));
  }
  return who;
}
