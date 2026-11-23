import { NextResponse } from "next/server";
import { z } from "zod";
import { addToWaitlist } from "@/lib/repos/waitlist";
import { isSessionDatePaused } from "@/lib/day-requests";
import { sendWaitlistAdminAlertEmail, sendWaitlistConfirmationEmail } from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/security";

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200),
  sessionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`wl:${ip}`, 15)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = bodySchema.parse(await request.json());

    if (body.sessionDate && (await isSessionDatePaused(body.sessionDate))) {
      return NextResponse.json(
        { error: "Sign-ups for this day are temporarily paused." },
        { status: 409 },
      );
    }

    if (process.env.POSTGRES_URL) {
      await addToWaitlist({ sessionDate: body.sessionDate ?? null, name: body.name, email: body.email });
    }

    // Best-effort notifications — a Resend outage shouldn't fail the signup
    // itself, since the waitlist row is already saved above.
    try {
      await Promise.all([
        sendWaitlistConfirmationEmail(body.email, body.name, body.sessionDate),
        sendWaitlistAdminAlertEmail(body.name, body.email, body.sessionDate),
      ]);
    } catch {
      /* email delivery failure shouldn't block the waitlist signup */
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    // Never hand the raw error back: a ZodError stringifies to a multi-line
    // JSON dump and a database error leaks schema details, and the modal puts
    // whatever comes back in front of the person signing up.
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Please enter a valid name and email address." },
        { status: 400 },
      );
    }
    console.error("Waitlist signup failed", e);
    return NextResponse.json(
      { error: "Sorry, we couldn't save your waitlist signup. Please try again." },
      { status: 500 },
    );
  }
}
