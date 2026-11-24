import { appRoute, fail } from "@/lib/app-api";
import { newAppSession } from "@/lib/app-api-session";
import { signPhoneProof } from "@/lib/phone-proof";
import { getPlayerByVerifiedPhone, markPhoneVerified } from "@/lib/player-db";
import { verifySmsCode } from "@/lib/sms";

// The web's /api/auth/sms/verify, answering with a session token.
const route = appRoute(
  "auth.smsVerify",
  async ({ body, request, session }) => {
    const result = await verifySmsCode(body.sessionInfo, body.code);
    if (!result.ok) return fail(400, result.reason);

    if ((body.purpose ?? "login") === "phone_confirm") {
      if (!session) return fail(401, "signed_out");
      if ((await markPhoneVerified(session.player.id, result.phoneE164)) === "taken") return fail(409, "phone_taken");
      return { ok: true as const };
    }

    const player = await getPlayerByVerifiedPhone(result.phoneE164);
    // A number with no confirmed account: they confirm an email next, and
    // this proof attaches the number to that account.
    if (!player) return { ok: true as const, needsEmail: true, phoneProof: signPhoneProof(result.phoneE164) };
    const created = await newAppSession(player.id, request.headers.get("user-agent"));
    return { ok: true as const, ...created, needsDetails: !player.firstName.trim() };
  },
  { rateKey: (ip) => `auth-sms-verify:${ip}` },
);

export const POST = route.handle;
export const OPTIONS = route.preflight;
