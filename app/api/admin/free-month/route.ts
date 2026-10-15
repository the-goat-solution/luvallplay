import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getMembershipById,
  hasLaterMembership,
  recordFreeDays,
} from "@/lib/db";
import { getClubToday } from "@/lib/dates";
import { addFreeDaysBeforeNextCharge, giveFreeNextPeriod } from "@/lib/stripe";
import { checkRateLimit, getClientIp, isAdminRequest } from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  membershipId: z.number().int().positive(),
});

// 4 weeks — the club's "month" (see MEMBERSHIP_CYCLE_DAYS).
const FREE_MONTH_DAYS = 28;

// Gives any active member a free month (competition prizes, goodwill):
// - one-time (card or cash): 4 more weeks added to the end date;
// - recurring monthly: the next renewal invoice comes out at $0;
// - recurring quarterly: 4 free weeks after the current quarter, then
//   quarterly billing carries on.
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
  if (membership.status !== "active") {
    return NextResponse.json(
      { error: "Only active memberships can be given a free month." },
      { status: 400 },
    );
  }

  try {
    // One-time (including cash) memberships: 4 more weeks on the end date.
    if (!membership.recurring) {
      const today = getClubToday().dateKey;
      if (!membership.periodEnd || membership.periodEnd < today) {
        return NextResponse.json(
          { error: `${membership.name}'s membership has already ended.` },
          { status: 409 },
        );
      }
      if (await hasLaterMembership(membership)) {
        return NextResponse.json(
          {
            error: `${membership.name} has already renewed — give the free month on their newer membership instead.`,
          },
          { status: 409 },
        );
      }
      const periodEnd = await recordFreeDays(membership.id, FREE_MONTH_DAYS, true);
      return NextResponse.json({ ok: true, kind: "extended", periodEnd });
    }

    if (!membership.stripeSubscriptionId) {
      return NextResponse.json(
        { error: "This membership has no Stripe subscription to adjust." },
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

    // Recurring quarterly: a free month after the current quarter, then
    // quarterly billing carries on (a 100%-off coupon would free a whole
    // quarter, so the next charge is pushed back 4 weeks instead).
    if (membership.plan === "quarterly") {
      const resumesAt = await addFreeDaysBeforeNextCharge(
        membership.stripeSubscriptionId,
        FREE_MONTH_DAYS,
      );
      const periodEnd = await recordFreeDays(membership.id, FREE_MONTH_DAYS, true);
      return NextResponse.json({
        ok: true,
        kind: "deferred",
        periodEnd,
        billingResumes: new Date(resumesAt * 1000).toISOString().slice(0, 10),
      });
    }

    // Recurring monthly: the next renewal invoice comes out at $0.
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
    await recordFreeDays(membership.id, FREE_MONTH_DAYS, false);
    return NextResponse.json({ ok: true, kind: "free-renewal" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not reach Stripe";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
