import { appRoute, fail } from "@/lib/app-api";
import { newAppSession } from "@/lib/app-api-session";
import { verifyPhoneProof } from "@/lib/phone-proof";
import { verifyEmailCode } from "@/lib/player-auth";
import { ensurePlayerForEmail, markPhoneVerified } from "@/lib/player-db";

// The web's /api/auth/email/verify, answering with a session token instead of
// a cookie. It never ends another session: nobody is signed out by signing in.
const route = appRoute(
  "auth.emailVerify",
  async ({ body, request }) => {
    const result = await verifyEmailCode(body.email, body.code);
    if (!result.ok) return fail(400, result.reason);
    const { player } = await ensurePlayerForEmail(result.email, { via: "signup" });
    const phone = verifyPhoneProof(body.phoneProof);
    const phoneTaken = phone ? (await markPhoneVerified(player.id, phone)) === "taken" : false;
    const session = await newAppSession(player.id, request.headers.get("user-agent"));
    return { ok: true as const, ...session, needsDetails: !player.firstName.trim(), phoneTaken };
  },
  { rateKey: (ip) => `auth-verify:${ip}` },
);

export const POST = route.handle;
export const OPTIONS = route.preflight;
