import { NextResponse } from "next/server";
import { z } from "zod";
import { listActiveMembershipsByEmail } from "@/lib/db";
import { sendCancellationLinkEmail } from "@/lib/email";
import { checkRateLimit, getClientIp, signCancelToken } from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email().max(200),
});

const PLAN_LABEL: Record<string, string> = {
  monthly: "monthly",
  quarterly: "quarterly",
};

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`cancel-req:${ip}`, 8)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Always respond the same way regardless of whether the email matches an
  // active membership, so this endpoint can't be used to check who's a member.
  const genericOk = NextResponse.json({ ok: true });

  try {
    const body = bodySchema.parse(await request.json());
    if (!process.env.POSTGRES_URL) return genericOk;

    const memberships = await listActiveMembershipsByEmail(body.email);
    const origin = new URL(request.url).origin;

    for (const membership of memberships) {
      const token = signCancelToken(membership.id);
      const confirmUrl = `${origin}/cancel-membership/confirm?token=${token}`;
      await sendCancellationLinkEmail(
        membership.email,
        PLAN_LABEL[membership.plan] ?? membership.plan,
        confirmUrl,
      );
    }
  } catch {
    // Fall through to the generic response either way.
  }

  return genericOk;
}
