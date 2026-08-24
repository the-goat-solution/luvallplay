import { NextResponse } from "next/server";
import { z } from "zod";
import { getMembershipById, setMembershipCancelAtPeriodEnd } from "@/lib/db";
import { cancelSubscriptionAtPeriodEnd } from "@/lib/stripe";
import { checkRateLimit, getClientIp, isAdminRequest } from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  membershipId: z.number().int().positive(),
});

export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(`admin-cancel:${ip}`, 30)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }

  try {
    const body = bodySchema.parse(await request.json());
    const membership = await getMembershipById(body.membershipId);
    if (!membership) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }
    if (!membership.stripeSubscriptionId) {
      return NextResponse.json(
        { error: "No Stripe subscription on file for this member" },
        { status: 400 },
      );
    }

    await cancelSubscriptionAtPeriodEnd(membership.stripeSubscriptionId);
    await setMembershipCancelAtPeriodEnd(membership.id);

    return NextResponse.json({ ok: true, periodEnd: membership.periodEnd });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
