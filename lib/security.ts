import { BOOKING_WINDOW_DAYS } from "./constants";
import { ADMIN_COOKIE, verifyAdminToken } from "./admin-session";
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

// Mirrors the admin_token check in middleware.ts, for use in API route
// handlers (which get a plain Request, not the NextRequest the middleware
// works with). Both call the same verifier in lib/admin-session.ts, so an
// expired session is rejected identically on pages and on API routes.
export async function isAdminRequest(request: Request): Promise<boolean> {
  return verifyAdminToken(getCookieFromRequest(request, ADMIN_COOKIE));
}
