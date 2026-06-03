import { BOOKING_LOCK_DAYS } from "./constants";
import { isBookable, startOfDay } from "./dates";

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

export function assertSessionBookable(sessionDate: string): void {
  const [y, m, d] = sessionDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (!isBookable(date)) {
    throw new Error(
      `Session must be booked at least ${BOOKING_LOCK_DAYS} days in advance`,
    );
  }
  if (date.getDay() !== 5) {
    throw new Error("Sessions are only on Fridays");
  }
}

export function parseSessionDate(sessionDate: string): Date {
  const [y, m, d] = sessionDate.split("-").map(Number);
  if (!y || !m || !d) throw new Error("Invalid session date");
  return startOfDay(new Date(y, m - 1, d));
}
