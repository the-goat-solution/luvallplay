import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import {
  SelfServiceError,
  cancelAtPeriodEnd,
  cancelPendingChange,
  confirmAutoRenewFromOneTime,
  createAutoRenewSetup,
  getCurrentMembership,
  recordFeedback,
  resumeMembership,
  scheduleChangeAtRenewal,
  startOneTimeRenewal,
} from "@/lib/membership-self-service";

const tier = z.enum(["monthly", "quarterly"]);
const day = z.enum(["friday", "wednesday"]);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change"), plan: tier, day, reason: z.string().max(60).optional(), comment: z.string().max(1000).optional() }),
  z.object({ action: z.literal("cancel_change") }),
  z.object({ action: z.literal("cancel"), reason: z.string().min(1).max(60), comment: z.string().max(1000).optional() }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("renew"), plan: tier }),
  z.object({ action: z.literal("autorenew_setup") }),
  z.object({ action: z.literal("autorenew_confirm"), plan: tier, setupIntentId: z.string().min(5).max(100) }),
]);

export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!checkRateLimit(`membership-action:${player.id}`, 20, 60 * 60_000)) {
    return NextResponse.json({ error: "too_many" }, { status: 429 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  try {
    if (body.action === "autorenew_setup") {
      return NextResponse.json(await createAutoRenewSetup(player));
    }
    const m = await getCurrentMembership(player.email);
    if (!m) return NextResponse.json({ error: "no_membership" }, { status: 404 });

    let result: unknown = { ok: true };
    switch (body.action) {
      case "change": {
        // A downgrade goes through the extra steps, with a reason.
        if (m.plan === "quarterly" && body.plan === "monthly") {
          if (!body.reason) return NextResponse.json({ error: "reason_required" }, { status: 400 });
          await recordFeedback(player.id, m.id, "downgrade", body.reason, body.comment ?? null);
        }
        result = await scheduleChangeAtRenewal(m, body.plan, body.day);
        break;
      }
      case "cancel_change":
        await cancelPendingChange(m);
        break;
      case "cancel":
        result = { endsOn: await cancelAtPeriodEnd(player, m, body.reason, body.comment ?? null) };
        break;
      case "resume":
        await resumeMembership(m);
        break;
      case "renew":
        result = await startOneTimeRenewal(player, m, body.plan);
        break;
      case "autorenew_confirm":
        result = await confirmAutoRenewFromOneTime(player, m, body.plan, body.setupIntentId);
        break;
    }
    revalidatePath("/profile");
    return NextResponse.json({ ok: true, ...(result as object) });
  } catch (err) {
    if (err instanceof SelfServiceError) return NextResponse.json({ error: err.code }, { status: 409 });
    console.error("[membership] action failed:", body.action, err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
