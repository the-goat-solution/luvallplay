import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/security";
import { createPlayerSession, safeNextPath, verifyEmailCode } from "@/lib/player-auth";
import { ensurePlayerForEmail, markPhoneVerified } from "@/lib/player-db";
import { verifyPhoneProof } from "@/lib/phone-proof";
import { setPlayerCookies } from "@/lib/player-cookies";

const bodySchema = z.object({
  email: z.string().trim().email().max(200),
  code: z.string().trim().min(6).max(12),
  next: z.string().max(300).optional(),
  phoneProof: z.string().max(400).optional(),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`auth-verify:${ip}`, 30, 15 * 60_000)) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  try {
    const result = await verifyEmailCode(body.email, body.code);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

    const { player } = await ensurePlayerForEmail(result.email, { via: "signup" });
    // Signed in by text first, then confirmed this email: attach the number.
    const phone = verifyPhoneProof(body.phoneProof);
    let phoneTaken = false;
    if (phone) phoneTaken = (await markPhoneVerified(player.id, phone)) === "taken";

    const token = await createPlayerSession(player.id, request.headers.get("user-agent"));
    const needsDetails = !player.firstName.trim();
    const response = NextResponse.json({
      ok: true,
      needsDetails,
      phoneTaken,
      next: safeNextPath(body.next),
    });
    setPlayerCookies(response, token);
    return response;
  } catch (err) {
    console.error("[auth] email verify failed:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
