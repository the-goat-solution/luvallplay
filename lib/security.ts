import crypto from "crypto";
import { BOOKING_WINDOW_DAYS } from "./constants";
import { isBookable, startOfDay } from "./dates";
import { sessionExists } from "./db";

const rateLimitMap = new Map<string, { count: number; reset: number }>();

export function checkRateLimit(
  key: string,
  limit = 20,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.reset) {
    rateLimitMap.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function verifyTurnstile(
  token: string | undefined,
  ip: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    },
  );
  const data = (await res.json()) as { success: boolean };
  return data.success;
}

export async function assertSessionBookable(sessionDate: string): Promise<void> {
  const [y, m, d] = sessionDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (!isBookable(date, new Date())) {
    throw new Error(
      `Booking is only open from ${BOOKING_WINDOW_DAYS} days before the session until 5PM on the day of play`,
    );
  }
  if (process.env.POSTGRES_URL) {
    const exists = await sessionExists(sessionDate);
    if (!exists) {
      throw new Error("This date is not an open session");
    }
  }
}

export function parseSessionDate(sessionDate: string): Date {
  const [y, m, d] = sessionDate.split("-").map(Number);
  if (!y || !m || !d) throw new Error("Invalid session date");
  return startOfDay(new Date(y, m - 1, d));
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function getCookieFromRequest(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// Mirrors the admin_token cookie check in middleware.ts, for use in API
// route handlers (which get a plain Request, not the NextRequest the
// middleware works with).
export function isAdminRequest(request: Request): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  const token = getCookieFromRequest(request, "admin_token");
  return !!token && timingSafeEqualStr(token, password);
}

const CANCEL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function getCancelTokenSecret(): string {
  const secret = process.env.CANCEL_LINK_SECRET;
  if (!secret) throw new Error("CANCEL_LINK_SECRET is not configured");
  return secret;
}

// Stateless signed token (membership id + expiry, HMAC'd) used for the
// emailed self-service cancellation link — avoids a separate token table.
export function signCancelToken(membershipId: number): string {
  const expires = Date.now() + CANCEL_TOKEN_TTL_MS;
  const payload = `${membershipId}.${expires}`;
  const sig = crypto
    .createHmac("sha256", getCancelTokenSecret())
    .update(payload)
    .digest("hex");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`;
}

export function verifyCancelToken(token: string): number | null {
  const [encodedPayload, sig] = token.split(".");
  if (!encodedPayload || !sig) return null;

  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return null;
  }

  // Node's hex decoder silently drops trailing bytes that aren't valid hex
  // pairs, so a tampered signature with garbage appended can still decode
  // to the right length — reject anything that isn't exactly a 64-char
  // sha256 hex digest before comparing.
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;

  const expectedSig = crypto
    .createHmac("sha256", getCancelTokenSecret())
    .update(payload)
    .digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  const [idStr, expiresStr] = payload.split(".");
  const id = Number(idStr);
  const expires = Number(expiresStr);
  if (!Number.isInteger(id) || !Number.isFinite(expires)) return null;
  if (Date.now() > expires) return null;
  return id;
}
