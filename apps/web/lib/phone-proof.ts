import { hmac } from "./player-auth";

// After a text code is confirmed for a number that has no account yet, the
// player still has to confirm an email (it's the key for Stripe and club
// emails). This short-lived signed token carries the proven number across
// that step, so the number can be attached to the account they end up in.

const TTL_MS = 30 * 60 * 1000;

export function signPhoneProof(phoneE164: string): string {
  const payload = `${phoneE164}.${Date.now() + TTL_MS}`;
  return `${Buffer.from(payload).toString("base64url")}.${hmac(`phone-proof:${payload}`)}`;
}

export function verifyPhoneProof(token: string | null | undefined): string | null {
  if (!token) return null;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  if (hmac(`phone-proof:${payload}`) !== sig) return null;
  const dot = payload.lastIndexOf(".");
  const phone = payload.slice(0, dot);
  if (Date.now() > Number(payload.slice(dot + 1))) return null;
  return /^\+\d{8,15}$/.test(phone) ? phone : null;
}
