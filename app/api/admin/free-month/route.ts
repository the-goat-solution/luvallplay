import { NextResponse } from "next/server";
import { z } from "zod";
import { getMembershipById } from "@/lib/db";
import { giveFreeNextPeriod } from "@/lib/stripe";
import { checkRateLimit, getClientIp, isAdminRequest } from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  membershipId: z.number().int().positive(),
});

// Gives a recurring monthly member their next month free (competition
// prizes, goodwill) without cancelling or pausing their subscription: the
// next renewal invoice comes out at $0 and is marked paid, and billing
// resumes as normal the month after. See giveFreeNextPeriod.
export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(`admin-free-month:${ip}`, 20)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json(
      { error: "Database is not configured" },
      { status: 503 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const membership = await getMembershipById(body.membershipId);
  if (!membership) {
    return NextResponse.json(
      { error: "Membership not found" },
      { status: 404 },
    );
  }
  if (!membership.stripeSubscriptionId || !membership.recurring) {
    return NextResponse.json(
      {
        error:
          "Only auto-renewing card members can be given a free month — cash and one-time memberships aren't billed by Stripe.",
      },
      { status: 400 },
    );
  }
  // A 100%-off "once" coupon covers one whole billing cycle, which for a
  // quarterly member would be three months free, not one.
  if (membership.plan !== "monthly") {
    return NextResponse.json(
      { error: "Free months can only be given to monthly members." },
      { status: 400 },
    );
  }
  if (membership.cancelAtPeriodEnd) {
    return NextResponse.json(
      {
        error:
          "This membership is set to cancel at period end, so there's no next renewal to make free.",
      },
      { status: 409 },
    );
  }

  try {
    const { alreadyQueued } = await giveFreeNextPeriod(
      membership.stripeSubscriptionId,
    );
    if (alreadyQueued) {
      return NextResponse.json(
        {
          error: `${membership.name} already has a free month waiting on their next renewal.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not reach Stripe";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
