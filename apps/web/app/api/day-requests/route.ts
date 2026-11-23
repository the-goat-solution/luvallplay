import { NextResponse } from "next/server";
import { z } from "zod";
import { WEEKDAYS, WEEKDAY_LABEL } from "@/lib/constants";
import { addDayRequest, isDayPaused } from "@/lib/day-requests";
import {
  sendDayRequestAdminAlertEmail,
  sendDayRequestConfirmationEmail,
} from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/security";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  day: z.enum(WEEKDAYS as [string, ...string[]]),
});

// "Notify me when this day opens" — for a paused day coming back, or a day
// the club doesn't run yet. Listed for admins at /admin/day-requests.
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`dr:${ip}`, 15)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = bodySchema.parse(await request.json());
    const day = body.day as (typeof WEEKDAYS)[number];
    const dayLabel = WEEKDAY_LABEL[day];

    let isNew = true;
    if (process.env.POSTGRES_URL) {
      isNew = await addDayRequest(day, body.name, body.email);
    }

    // Already on the list for this day — say yes again without re-emailing.
    if (isNew) {
      try {
        const paused = await isDayPaused(day);
        await Promise.all([
          sendDayRequestConfirmationEmail(body.email, body.name, dayLabel, paused),
          sendDayRequestAdminAlertEmail(body.name, body.email, dayLabel),
        ]);
      } catch {
        /* email delivery failure shouldn't block the request itself */
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Please enter a valid name and email address." },
        { status: 400 },
      );
    }
    console.error("Day request signup failed", e);
    return NextResponse.json(
      { error: "Sorry, we couldn't save your request. Please try again." },
      { status: 500 },
    );
  }
}
