import { NextResponse } from "next/server";
import { z } from "zod";
import { getMembershipById, setMembershipCancelAtPeriodEnd } from "@/lib/db";
import { cancelSubscriptionAtPeriodEnd } from "@/lib/stripe";
import { checkRateLimit, getClientIp, verifyCancelToken } from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  token: z.string().min(1),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`cancel-confirm:${ip}`, 15)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }

  try {
    const body = bodySchema.parse(await request.json());
    const membershipId = verifyCancelToken(body.token);
    if (!membershipId) {
      return NextResponse.json(
        { error: "This link is invalid or has expired" },
        { status: 400 },
      );
    }

    const membership = await getMembershipById(membershipId);
    if (!membership) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    if (membership.cancelAtPeriodEnd || membership.status === "canceled") {
      return NextResponse.json({ ok: true, periodEnd: membership.periodEnd, alreadyCanceled: true });
    }

    if (!membership.stripeSubscriptionId) {
      return NextResponse.json(
        { error: "No Stripe subscription on file for this membership" },
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
