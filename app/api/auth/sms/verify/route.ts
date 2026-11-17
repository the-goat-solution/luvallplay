import { NextResponse } from "next/server";
import type { z } from "zod";
import { smsVerifySchema } from "@/lib/auth-schemas";
import { checkRateLimit, getClientIp } from "@/lib/security";
import { createPlayerSession, getPlayerFromRequest, safeNextPath } from "@/lib/player-auth";
import { getPlayerByVerifiedPhone, markPhoneVerified } from "@/lib/player-db";
import { verifySmsCode } from "@/lib/sms";
import { signPhoneProof } from "@/lib/phone-proof";
import { setPlayerCookies } from "@/lib/player-cookies";

const bodySchema = smsVerifySchema;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`auth-sms-verify:${ip}`, 20, 15 * 60_000)) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const result = await verifySmsCode(body.sessionInfo, body.code);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

  if (body.purpose === "phone_confirm") {
    const player = await getPlayerFromRequest(request);
    if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
    const outcome = await markPhoneVerified(player.id, result.phoneE164);
    if (outcome === "taken") return NextResponse.json({ error: "phone_taken" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  const player = await getPlayerByVerifiedPhone(result.phoneE164);
  if (!player) {
    // A number with no confirmed account: they confirm an email next, and
    // this proof attaches the number to that account.
    return NextResponse.json({ ok: true, needsEmail: true, phoneProof: signPhoneProof(result.phoneE164) });
  }
  const token = await createPlayerSession(player.id, request.headers.get("user-agent"));
  const response = NextResponse.json({
    ok: true,
    needsDetails: !player.firstName.trim(),
    next: safeNextPath(body.next),
  });
  setPlayerCookies(response, token);
  return response;
}
