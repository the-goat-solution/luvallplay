import { NextResponse } from "next/server";
import { z } from "zod";
import { sendJerseyAdminAlertEmail, sendJerseyRegistrationEmail } from "@/lib/email";
import {
  JERSEY_SIZES,
  PRINT_NAME_MAX,
  isDisposableEmail,
  isJerseyOpen,
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
  deviceId: z.string().trim().max(80).optional(),
  website: z.string().max(200).optional(), // honeypot
  turnstileToken: z.string().optional(),
  consent: z.literal(true),
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
    { opensAt: opensAt.toISOString(), now: new Date().toISOString(), earlyBirdsLeft: left },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`jersey:${ip}`, 8)) {
    return NextResponse.json({ error: "Too many attempts. Please wait a minute and try again." }, { status: 429 });
  }
  if (!isJerseyOpen()) {
    return NextResponse.json({ error: "Registration hasn't opened yet." }, { status: 403 });
  }
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Registration is unavailable right now." }, { status: 503 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Please check your details and try again." }, { status: 400 });
  }

  // Bots fill the hidden field; pretend it worked.
  if (body.website) return NextResponse.json({ ok: true, refCode: "00000", priceCents: 0, earlyBird: false });

  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return NextResponse.json({ error: "Please complete the captcha." }, { status: 400 });
  }
  if (isDisposableEmail(body.email)) {
    return NextResponse.json({ error: "Please use a permanent email address." }, { status: 400 });
  }
  const printName = body.addPrint ? (body.printName ?? "").toUpperCase().replace(/[^A-Z0-9 .'-]/g, "") : "";
  if (body.addPrint && (!printName.trim() || body.printNumber === undefined)) {
    return NextResponse.json({ error: "Add a print name and number, or untick the printing option." }, { status: 400 });
  }

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
      printName: body.addPrint ? printName.trim() : null,
      printNumber: body.addPrint ? (body.printNumber ?? null) : null,
      ipHash: hashIp(ip),
      deviceId: body.deviceId || null,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            "This email is already registered — one jersey per person. Check your inbox for your reference code, or contact the club if you need help.",
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
    return NextResponse.json({ error: "Sorry, something went wrong. Please try again." }, { status: 500 });
  }
}
