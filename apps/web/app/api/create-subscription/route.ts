import { NextResponse } from "next/server";
import { z } from "zod";
import { joinMembership } from "@/lib/payments/membership";
import { checkRateLimit, getClientIp, verifyTurnstile } from "@/lib/security";
import { getPlayerFromRequest } from "@/lib/player-auth";

const bodySchema = z.object({
  plan: z.enum(["monthly", "quarterly"]),
  day: z.enum(["friday", "wednesday"]),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200),
  phone: z.string().max(30).default(""),
  recurring: z.boolean().optional().default(true),
  turnstileToken: z.string().optional(),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`sub:${ip}`, 10)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = bodySchema.parse(await request.json());
    // Joining as a member needs a Three Wolves account: the membership is
    // then managed from the profile. The account's email is the one used,
    // whatever the form sent. A signed-in player has already proven they're
    // a person, so the bot check is skipped.
    const player = process.env.POSTGRES_URL ? await getPlayerFromRequest(request) : null;
    if (process.env.POSTGRES_URL && !player) {
      return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
    }
    if (player) {
      body.email = player.email;
      body.firstName = body.firstName.trim() || player.firstName;
      body.lastName = body.lastName.trim() || player.lastName;
      body.phone = body.phone.trim() || player.phone || "";
    }
    const turnstileOk = player ? true : await verifyTurnstile(body.turnstileToken, ip);
    if (!turnstileOk) {
      return NextResponse.json(
        { error: "Captcha verification failed" },
        { status: 403 },
      );
    }

    // One membership path for the website and the players' app
    // (lib/payments/membership.ts): the paused-day check, capacity reserved
    // before the provider is touched, then the payment.
    const result = await joinMembership(
      { firstName: body.firstName, lastName: body.lastName, email: body.email, phone: body.phone },
      { plan: body.plan, day: body.day, recurring: body.recurring },
    );
    if (!result.ok) {
      if (result.kind === "no_payment") {
        return NextResponse.json(
          { error: result.recurring ? "Failed to initialize subscription payment" : "Failed to initialize membership payment" },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: result.reason, day: body.day }, { status: 409 });
    }

    return NextResponse.json({
      clientSecret: result.clientSecret,
      ...(result.subscriptionId ? { subscriptionId: result.subscriptionId } : {}),
      periodStart: result.periodStart,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
