import { db, sql } from "@vercel/postgres";
import { ensurePlayerTables, getPlayerSetting, setPlayerSetting } from "./player-db";
import { sha256 } from "./player-auth";
import { sendAdminAlertEmail } from "./player-email";

// SMS sign-in codes through Google Identity Platform (Firebase phone auth),
// capped at Google's free allowance so texts never cost the club money.
//
// The cap is a ROLLING 24 hours rather than "per day": Google doesn't
// publish when its daily free count resets, and limiting every 24-hour
// window to N guarantees no calendar day, in any time zone, goes over N.
//
// Our server is the only thing that can make Google send a text: the API
// key is a server-only env var and the browser only ever solves the
// reCAPTCHA. So the counter below can't be bypassed from outside.

const IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/v1";
const DEFAULT_FREE_LIMIT = 10;
const PER_NUMBER_PER_HOUR = 3;
const SMS_SWITCH_KEY = "sms_enabled";
const CAP_ALERT_KEY = "sms_cap_alert_at";

export type SmsPurpose = "login" | "phone_confirm";

function apiKey(): string | null {
  return process.env.FIREBASE_API_KEY?.trim() || null;
}

export function smsFreeLimit(): number {
  const raw = process.env.SMS_FREE_LIMIT_24H;
  if (raw === undefined || raw === "") return DEFAULT_FREE_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_FREE_LIMIT;
}

export async function isSmsSwitchedOn(): Promise<boolean> {
  return (await getPlayerSetting(SMS_SWITCH_KEY)) !== "off";
}

export async function setSmsSwitch(on: boolean): Promise<void> {
  await setPlayerSetting(SMS_SWITCH_KEY, on ? "on" : "off");
}

export type SmsUsage = {
  configured: boolean;
  switchedOn: boolean;
  limit: number;
  used: number;
  /** When the oldest counted text drops out of the window (null if under the cap). */
  nextSlotAt: string | null;
  available: boolean;
};

export async function getSmsUsage(): Promise<SmsUsage> {
  const configured = Boolean(apiKey());
  const limit = smsFreeLimit();
  if (!process.env.POSTGRES_URL) {
    return { configured, switchedOn: false, limit, used: 0, nextSlotAt: null, available: false };
  }
  await ensurePlayerTables();
  const [switchedOn, { rows }] = await Promise.all([
    isSmsSwitchedOn(),
    sql`
      SELECT sent_at FROM sms_sends
      WHERE sent_at > NOW() - INTERVAL '24 hours'
      ORDER BY sent_at ASC;
    `,
  ]);
  const used = rows.length;
  let nextSlotAt: string | null = null;
  if (limit > 0 && used >= limit) {
    // The (used - limit + 1)th oldest text has to age out before one frees up.
    const freeing = rows[used - limit] as { sent_at: Date };
    nextSlotAt = new Date(new Date(freeing.sent_at).getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
  return {
    configured,
    switchedOn,
    limit,
    used,
    nextSlotAt,
    available: configured && switchedOn && limit > 0 && used < limit,
  };
}

/** Whether to show "Text me a code" at all. */
export async function isSmsAvailable(): Promise<boolean> {
  try {
    return (await getSmsUsage()).available;
  } catch (err) {
    console.error("[sms] usage check failed:", err);
    return false;
  }
}

let cachedSiteKey: { key: string; at: number } | null = null;

/** The reCAPTCHA site key Google wants solved before it sends a text. Public. */
export async function getRecaptchaSiteKey(): Promise<string | null> {
  const fromEnv = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY?.trim();
  if (fromEnv) return fromEnv;
  const key = apiKey();
  if (!key) return null;
  if (cachedSiteKey && Date.now() - cachedSiteKey.at < 6 * 60 * 60 * 1000) return cachedSiteKey.key;
  const res = await fetch(`${IDENTITY_TOOLKIT}/recaptchaParams?key=${encodeURIComponent(key)}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { recaptchaSiteKey?: string };
  if (!data.recaptchaSiteKey) return null;
  cachedSiteKey = { key: data.recaptchaSiteKey, at: Date.now() };
  return data.recaptchaSiteKey;
}

export type SendSmsResult =
  | { ok: true; sessionInfo: string }
  | {
      ok: false;
      reason: "unavailable" | "cap_reached" | "too_many_for_number" | "invalid_number" | "captcha_failed" | "send_failed";
    };

/**
 * Reserves one of the free texts (atomically), then asks Google to send the
 * code. If Google refuses, the reservation is released.
 */
export async function sendSmsCode(input: {
  phoneE164: string;
  recaptchaToken: string;
  purpose: SmsPurpose;
  ip: string;
}): Promise<SendSmsResult> {
  const key = apiKey();
  const limit = smsFreeLimit();
  if (!key || limit <= 0 || !(await isSmsSwitchedOn())) return { ok: false, reason: "unavailable" };
  await ensurePlayerTables();
  const phoneHash = sha256(input.phoneE164);

  const { rows: perNumber } = await sql`
    SELECT count(*)::int AS n FROM sms_sends
    WHERE phone_hash = ${phoneHash} AND sent_at > NOW() - INTERVAL '1 hour';
  `;
  if ((perNumber[0]?.n as number) >= PER_NUMBER_PER_HOUR) return { ok: false, reason: "too_many_for_number" };

  // Reserve a slot. The advisory lock serialises every reservation, so two
  // people tapping at the same moment can't both take the last free text.
  const client = await db.connect();
  let reservedId: number | null = null;
  let usedAfter = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sms_free_cap'))");
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM sms_sends WHERE sent_at > NOW() - INTERVAL '24 hours';`,
    );
    const used = rows[0].n as number;
    if (used >= limit) {
      await client.query("ROLLBACK");
      await alertCapReachedOnce();
      return { ok: false, reason: "cap_reached" };
    }
    const inserted = await client.query(
      `INSERT INTO sms_sends (purpose, phone_hash, ip_hash) VALUES ($1, $2, $3) RETURNING id;`,
      [input.purpose, phoneHash, sha256(input.ip)],
    );
    reservedId = inserted.rows[0].id as number;
    usedAfter = used + 1;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const res = await fetch(`${IDENTITY_TOOLKIT}/accounts:sendVerificationCode?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: input.phoneE164, recaptchaToken: input.recaptchaToken }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { sessionInfo?: string; error?: { message?: string } };
  if (!res.ok || !data.sessionInfo) {
    // Nothing was sent, so give the slot back.
    await sql`DELETE FROM sms_sends WHERE id = ${reservedId};`;
    const message = data.error?.message ?? "";
    console.error("[sms] sendVerificationCode failed:", res.status, message);
    if (message.startsWith("INVALID_PHONE_NUMBER") || message.startsWith("MISSING_PHONE_NUMBER")) {
      return { ok: false, reason: "invalid_number" };
    }
    if (message.startsWith("CAPTCHA_CHECK_FAILED") || message.startsWith("MISSING_RECAPTCHA_TOKEN")) {
      return { ok: false, reason: "captcha_failed" };
    }
    if (message.startsWith("QUOTA_EXCEEDED") || message.startsWith("TOO_MANY_ATTEMPTS")) {
      return { ok: false, reason: "cap_reached" };
    }
    return { ok: false, reason: "send_failed" };
  }
  if (usedAfter >= limit) await alertCapReachedOnce();
  return { ok: true, sessionInfo: data.sessionInfo };
}

export type VerifySmsResult =
  | { ok: true; phoneE164: string }
  | { ok: false; reason: "invalid_code" | "expired" | "failed" };

/** Checks the typed code with Google; returns the number Google confirmed. */
export async function verifySmsCode(sessionInfo: string, code: string): Promise<VerifySmsResult> {
  const key = apiKey();
  if (!key) return { ok: false, reason: "failed" };
  const res = await fetch(`${IDENTITY_TOOLKIT}/accounts:signInWithPhoneNumber?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionInfo, code: code.replace(/\D/g, "") }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { phoneNumber?: string; error?: { message?: string } };
  if (res.ok && data.phoneNumber) return { ok: true, phoneE164: data.phoneNumber };
  const message = data.error?.message ?? "";
  if (message.startsWith("INVALID_CODE")) return { ok: false, reason: "invalid_code" };
  if (message.startsWith("SESSION_EXPIRED") || message.startsWith("INVALID_SESSION_INFO")) {
    return { ok: false, reason: "expired" };
  }
  console.error("[sms] signInWithPhoneNumber failed:", res.status, message);
  return { ok: false, reason: "failed" };
}

/** One admin email per 24 hours the first time the free texts run out. */
async function alertCapReachedOnce(): Promise<void> {
  try {
    const last = await getPlayerSetting(CAP_ALERT_KEY);
    if (last && Date.now() - new Date(last).getTime() < 24 * 60 * 60 * 1000) return;
    await setPlayerSetting(CAP_ALERT_KEY, new Date().toISOString());
    await sendAdminAlertEmail({
      subject: "SMS sign-in paused: free texts used up",
      heading: "Free SMS codes used up for now",
      lines: [
        `All ${smsFreeLimit()} free text messages in the last 24 hours have been used.`,
        "Until one frees up, the website only offers sign-in by email code, so nothing is charged.",
        "If this happens often, you can lower SMS_FREE_LIMIT_24H or switch SMS off on Admin → Players.",
      ],
    });
  } catch (err) {
    console.error("[sms] cap alert failed:", err);
  }
}
