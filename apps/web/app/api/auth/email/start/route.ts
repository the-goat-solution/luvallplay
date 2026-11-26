import { NextResponse } from "next/server";
import type { z } from "zod";
import { emailStartSchema } from "@/lib/auth-schemas";
import { rateLimit, getClientIp, verifyTurnstile } from "@/lib/security";
import { issueEmailCode, safeNextPath } from "@/lib/player-auth";
import { sendLoginCodeEmail } from "@/lib/player-email";
import { getSiteUrl } from "@/lib/email-layout";

const bodySchema = emailStartSchema;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await rateLimit(`auth-email:${ip}`, 10, 15 * 60_000))) {
    return NextResponse.json({ error: "too_many" }, { status: 429 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (!(await verifyTurnstile(body.turnstileToken ?? undefined, ip))) {
    return NextResponse.json({ error: "captcha" }, { status: 403 });
  }

  try {
    const result = await issueEmailCode(body.email, ip);
    if (!result.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
    const next = safeNextPath(body.next);
    const linkUrl = `${getSiteUrl()}/api/auth/email/link?token=${encodeURIComponent(result.issued.linkToken)}&next=${encodeURIComponent(next)}`;
    if (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) {
      // Local development without email: print the code instead of sending.
      console.log(`[auth] sign-in code for ${body.email}: ${result.issued.code}  (${linkUrl})`);
    } else {
      await sendLoginCodeEmail({ to: body.email, code: result.issued.code, linkUrl, lang: body.lang });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth] email start failed:", err);
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }
}
