import { BOOKING_WINDOW_DAYS } from "./constants";
import { isBookable, startOfDay } from "./dates";
import { sessionExists } from "./db";
import { isAdminApiRequest } from "./admin-access";

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

// Mirrors the admin check in proxy.ts, for use in API route handlers (which
// get a plain Request). Both go through lib/admin-access.ts: a full club
// admin signed in within 12 hours.
export async function isAdminRequest(request: Request): Promise<boolean> {
  return isAdminApiRequest(request);
}
