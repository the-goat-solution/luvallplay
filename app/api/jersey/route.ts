import { NextResponse } from "next/server";
import { z } from "zod";
import { sendJerseyAdminAlertEmail, sendJerseyRegistrationEmail } from "@/lib/email";
import {
  JERSEY_SIZES,
  PRINT_COUNTRY_MAX,
  PRINT_NAME_MAX,
  isDisposableEmail,
  isJerseyClosed,
  isJerseyOpen,
  jerseyClosesAt,
  jerseyOpensAt,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from "@/lib/jersey";
import { hashIp } from "@/lib/jersey-server";
import { earlyBirdsLeft, ensureJerseyTables, registerJersey } from "@/lib/jersey-db";
import { checkRateLimit, getClientIp, verifyTurnstile } from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(6).max(30),
  size: z.enum(JERSEY_SIZES),
  addPrint: z.boolean().default(false),
  printName: z.string().trim().max(PRINT_NAME_MAX).optional(),
  printNumber: z.number().int().min(0).max(99).optional(),
  printCountry: z.string().trim().max(PRINT_COUNTRY_MAX).optional(),
  deviceId: z.string().trim().max(80).optional(),
  website: z.string().max(200).optional(), // honeypot
  turnstileToken: z.string().optional(),
  consent: z.literal(true),
  lang: z.enum(["en", "vi"]).default("en"),
});

// Only counts and times — never who has registered.
export async function GET() {
  const opensAt = jerseyOpensAt();
  let left = 10;
  if (process.env.POSTGRES_URL) {
    try {
      left = await earlyBirdsLeft();
    } catch (err) {
      console.error("Jersey status failed", err);
    }
  }
  return NextResponse.json(
    { opensAt: opensAt.toISOString(), closesAt: jerseyClosesAt().toISOString(), now: new Date().toISOString(), earlyBirdsLeft: left },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const MSG = {
  en: {
    rate: "Too many attempts. Please wait a minute and try again.",
    closed: "Registration hasn't opened yet.",
    over: "Registration has closed.",
    unavailable: "Registration is unavailable right now.",
    invalid: "Please check your details and try again.",
    captcha: "Please complete the captcha.",
    disposable: "Please use a permanent email address.",
    print: "Add the name to print on the back, or untick the printing option.",
    duplicate:
      "This email is already registered — one jersey per person. Check your inbox for your reference code, or contact the club if you need help.",
    failed: "Sorry, something went wrong. Please try again.",
  },
  vi: {
    rate: "Quá nhiều lần thử. Vui lòng đợi một phút rồi thử lại.",
    closed: "Đăng ký chưa mở.",
    over: "Đã đóng đăng ký.",
    unavailable: "Hiện chưa thể đăng ký. Vui lòng thử lại sau.",
    invalid: "Vui lòng kiểm tra lại thông tin và thử lại.",
    captcha: "Vui lòng hoàn thành xác minh captcha.",
    disposable: "Vui lòng dùng địa chỉ email thường xuyên của bạn.",
    print: "Hãy nhập tên cần in sau lưng, hoặc bỏ chọn mục in tên.",
    duplicate:
      "Email này đã được đăng ký — mỗi người chỉ một áo. Hãy kiểm tra hộp thư để lấy mã tham chiếu, hoặc liên hệ CLB nếu cần hỗ trợ.",
    failed: "Rất tiếc, đã có lỗi xảy ra. Vui lòng thử lại.",
  },
} as const;

function langOf(request: Request): "en" | "vi" {
  return request.headers.get("x-jersey-lang") === "vi" ? "vi" : "en";
}

export async function POST(request: Request) {
  const m = MSG[langOf(request)];
  const ip = getClientIp(request);
  if (!checkRateLimit(`jersey:${ip}`, 8)) {
    return NextResponse.json({ error: m.rate }, { status: 429 });
  }
  if (!isJerseyOpen()) {
    return NextResponse.json({ error: isJerseyClosed() ? m.over : m.closed }, { status: 403 });
  }
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: m.unavailable }, { status: 503 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: m.invalid }, { status: 400 });
  }

  // Bots fill the hidden field; pretend it worked.
  if (body.website) return NextResponse.json({ ok: true, refCode: "00000", priceCents: 0, earlyBird: false });

  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return NextResponse.json({ error: m.captcha }, { status: 400 });
  }
  if (isDisposableEmail(body.email)) {
    return NextResponse.json({ error: m.disposable }, { status: 400 });
  }
  // Letters (including Vietnamese diacritics), digits and a few separators only.
  const cleanPrint = (s: string | undefined) => (s ?? "").toUpperCase().replace(/[^\p{L}\p{N} .'-]/gu, "").trim();
  const printName = body.addPrint ? cleanPrint(body.printName) : "";
  if (body.addPrint && !printName) {
    return NextResponse.json({ error: m.print }, { status: 400 });
  }
  // The number and the country are alternatives; a number wins if both arrive.
  const printNumber = body.addPrint ? (body.printNumber ?? null) : null;
  const printCountry = body.addPrint && printNumber === null ? cleanPrint(body.printCountry) || null : null;

  try {
    await ensureJerseyTables();
    const result = await registerJersey({
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      emailNormalized: normalizeEmail(body.email),
      phone: body.phone,
      phoneNormalized: normalizePhone(body.phone),
      nameNormalized: normalizeName(body.firstName, body.lastName),
      size: body.size,
      printName: body.addPrint ? printName : null,
      printNumber,
      printCountry,
      ipHash: hashIp(ip),
      deviceId: body.deviceId || null,
      lang: body.lang,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: m.duplicate,
        },
        { status: 409 },
      );
    }

    const r = result.registration;
    try {
      await sendJerseyRegistrationEmail({
        to: r.email,
        firstName: r.firstName,
        refCode: r.refCode,
        priceCents: r.priceCents,
        earlyBird: r.earlyBird,
        lang: r.lang,
        deadline: r.expiresAt ? new Date(r.expiresAt) : null,
      });
      if (r.flags.length > 0) {
        await sendJerseyAdminAlertEmail({
          name: `${r.firstName} ${r.lastName}`,
          email: r.email,
          refCode: r.refCode,
          flags: r.flags,
        });
      }
    } catch (err) {
      console.error("Jersey email failed", err);
    }

    // Flags are for the admin only; the registrant never sees them.
    return NextResponse.json({
      ok: true,
      refCode: r.refCode,
      priceCents: r.priceCents,
      earlyBird: r.earlyBird,
      expiresAt: r.expiresAt,
    });
  } catch (err) {
    console.error("Jersey registration failed", err);
    return NextResponse.json({ error: m.failed }, { status: 500 });
  }
}
