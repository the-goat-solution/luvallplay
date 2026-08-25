import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@vercel/postgres";
import { ensureTables } from "@/lib/db";
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

    if (process.env.POSTGRES_URL) {
      await ensureTables();
      await sql`
        INSERT INTO waitlist (session_date, name, email)
        VALUES (${body.sessionDate ?? null}, ${body.name}, ${body.email});
      `;
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
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
