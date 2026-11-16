// Admin session token.
//
// The cookie used to hold ADMIN_PASSWORD verbatim, which meant the session
// never expired (the password is always "valid") and the raw password sat in
// the browser. It's now a short signed token carrying its own expiry, so a
// session can actually lapse and the password itself never leaves the server.
//
// Web Crypto rather than node:crypto because this runs in BOTH places: the
// Edge-runtime middleware guarding /admin pages, and the Node-runtime API
// routes under /api/admin. Keeping one implementation means the two can't
// drift into disagreeing about who's logged in.

export const ADMIN_COOKIE = "admin_token";

// Sliding window: every authenticated admin request mints a fresh token, so
// this is time since last activity, not time since login.
export const ADMIN_SESSION_TTL_MS = 48 * 60 * 60 * 1000;

function getSecret(): string | null {
  return process.env.ADMIN_PASSWORD || null;
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// `<expiresAtMs>.<sha256 hmac hex>`. The expiry is in the signed payload, so
// it's enforced server-side on every request — unlike a cookie Max-Age,
// which is only a hint the browser is free to ignore.
export async function signAdminToken(
  now: number = Date.now(),
): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  const payload = String(now + ADMIN_SESSION_TTL_MS);
  return `${payload}.${await hmacHex(payload, secret)}`;
}

export async function verifyAdminToken(
  token: string | null | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  const secret = getSecret();
  if (!secret || !token) return false;

  const separator = token.indexOf(".");
  if (separator === -1) return false;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  // Reject anything that isn't exactly a sha256 hex digest before comparing,
  // and anything that isn't a plain integer expiry — same reasoning as
  // other signed tokens in this codebase.
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  if (!/^\d+$/.test(payload)) return false;

  const expected = await hmacHex(payload, secret);
  if (!timingSafeEqualHex(signature, expected)) return false;

  return now <= Number(payload);
}

// Cookie attributes shared by every place that sets this cookie, so a
// refresh can never accidentally narrow the scope of an existing session.
// path "/" matters: "/admin" would not be sent to /api/admin/* routes.
export function adminCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
  };
}

// Deletes the cookie an older build scoped to "/admin". That cookie is never
// sent to /api/admin/* (the path doesn't match), so it silently produced
// "Unauthorized" on those routes while /admin pages still worked — and
// nothing could clear it, because a delete only removes a cookie at its own
// path.
//
// Appended as a raw header rather than through response.cookies.set():
// ResponseCookies keys by cookie NAME alone, so setting "admin_token" twice
// on one response keeps only the last one — which would wipe the session
// cookie we just issued. Verified against @edge-runtime/cookies.
export function appendLegacyAdminCookieClear(response: {
  headers: { append: (name: string, value: string) => void };
}): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${ADMIN_COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
  );
}
