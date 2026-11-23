import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/security";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { toE164 } from "@/lib/player-db";
import { sendSmsCode } from "@/lib/sms";
import { isSmsNumberAllowed } from "@/lib/phone";

const bodySchema = z.object({
  phone: z.string().trim().min(6).max(30),
  recaptchaToken: z.string().min(10).max(4000),
  purpose: z.enum(["login", "phone_confirm"]).default("login"),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`auth-sms:${ip}`, 5, 60 * 60_000)) {
    return NextResponse.json({ error: "too_many_for_number" }, { status: 429 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_number" }, { status: 400 });
  }
  if (body.purpose === "phone_confirm" && !(await getPlayerFromRequest(request))) {
    return NextResponse.json({ error: "signed_out" }, { status: 401 });
  }
  const phoneE164 = toE164(body.phone);
  if (!phoneE164) return NextResponse.json({ error: "invalid_number" }, { status: 400 });
  // NZ mobiles only for now (lib/phone.ts SMS_COUNTRIES).
  if (!isSmsNumberAllowed(phoneE164)) {
    return NextResponse.json({ error: phoneE164.startsWith("+64") ? "invalid_number" : "region_not_allowed", smsAvailable: true }, { status: 400 });
  }

  try {
    const result = await sendSmsCode({ phoneE164, recaptchaToken: body.recaptchaToken, purpose: body.purpose, ip });
    if (!result.ok) {
      const smsAvailable = !(result.reason === "cap_reached" || result.reason === "unavailable");
      return NextResponse.json({ error: result.reason, smsAvailable }, { status: 409 });
    }
    return NextResponse.json({ ok: true, sessionInfo: result.sessionInfo, phone: phoneE164 });
  } catch (err) {
    console.error("[auth] sms start failed:", err);
    return NextResponse.json({ error: "send_failed", smsAvailable: true }, { status: 500 });
  }
}
