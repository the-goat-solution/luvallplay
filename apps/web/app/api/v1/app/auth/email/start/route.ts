import { appRoute, fail } from "@/lib/app-api";
import { getSiteUrl } from "@/lib/email-layout";
import { issueEmailCode } from "@/lib/player-auth";
import { sendLoginCodeEmail } from "@/lib/player-email";
import { verifyTurnstile } from "@/lib/security";

// Same codes, same limits and the same email as the web's /api/auth/email/start.
const route = appRoute(
  "auth.emailStart",
  async ({ body, ip }) => {
    if (!(await verifyTurnstile(body.turnstileToken ?? undefined, ip))) return fail(403, "captcha");
    const result = await issueEmailCode(body.email, ip);
    if (!result.ok) return fail(429, "too_many");
    // The link in the email signs in on the web; the app uses the code.
    const linkUrl = `${getSiteUrl()}/api/auth/email/link?token=${encodeURIComponent(result.issued.linkToken)}&next=${encodeURIComponent("/profile")}`;
    if (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) {
      console.log(`[auth] sign-in code for ${body.email}: ${result.issued.code}  (${linkUrl})`);
    } else {
      try {
        await sendLoginCodeEmail({ to: body.email, code: result.issued.code, linkUrl, lang: body.lang ?? "en" });
      } catch (err) {
        console.error("[app-api] email start failed:", err);
        return fail(500, "send_failed");
      }
    }
    return { ok: true as const };
  },
  { rateKey: (ip) => `auth-email:${ip}`, badRequestCode: "invalid_email" },
);

export const POST = route.handle;
export const OPTIONS = route.preflight;
