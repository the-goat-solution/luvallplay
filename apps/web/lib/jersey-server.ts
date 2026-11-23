import crypto from "crypto";

// Server-only helpers (Node crypto) — kept out of lib/jersey.ts so the
// client form can import that file without bundling a crypto polyfill.

// The 5-digit code people put in their bank transfer reference.
export function generateRefCode(): string {
  return String(crypto.randomInt(10000, 100000));
}

// Stored instead of the raw address: enough to spot two registrations
// from one connection, without keeping people's IPs.
export function hashIp(ip: string): string | null {
  if (!ip || ip === "unknown") return null;
  const secret =
    process.env.JERSEY_HASH_SECRET || process.env.CANCEL_LINK_SECRET || process.env.ADMIN_PASSWORD || "three-wolves";
  return crypto.createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}
