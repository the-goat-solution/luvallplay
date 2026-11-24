import { appRoute, fail } from "@/lib/app-api";
import { isSmsNumberAllowed } from "@/lib/phone";
import { toE164 } from "@/lib/player-db";
import { sendSmsCode } from "@/lib/sms";

// The web's /api/auth/sms/start: same limits, same daily cap, same countries.
const route = appRoute(
  "auth.smsStart",
  async ({ body, ip, session }) => {
    const purpose = body.purpose ?? "login";
    if (purpose === "phone_confirm" && !session) return fail(401, "signed_out");
    const phoneE164 = toE164(body.phone);
    if (!phoneE164) return fail(400, "invalid_number");
    if (!isSmsNumberAllowed(phoneE164)) {
      return fail(400, phoneE164.startsWith("+64") ? "invalid_number" : "region_not_allowed", { smsAvailable: true });
    }
    try {
      const result = await sendSmsCode({ phoneE164, recaptchaToken: body.recaptchaToken, purpose, ip });
      if (!result.ok) {
        return fail(409, result.reason, { smsAvailable: !(result.reason === "cap_reached" || result.reason === "unavailable") });
      }
      return { ok: true as const, sessionInfo: result.sessionInfo, phone: phoneE164 };
    } catch (err) {
      console.error("[app-api] sms start failed:", err);
      return fail(500, "send_failed", { smsAvailable: true });
    }
  },
  { rateKey: (ip) => `auth-sms:${ip}`, badRequestCode: "invalid_number" },
);

export const POST = route.handle;
export const OPTIONS = route.preflight;
