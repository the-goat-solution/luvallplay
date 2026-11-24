// The site's forms: waitlist ("Start your club"), walkthrough, invite a club,
// "get the app: notify me" and contact.
//
// Every form: a honeypot field, rate limiting, optional Cloudflare Turnstile,
// recorded consent, and double opt-in (nothing counts until the person taps
// the link in their email). The team is told once an address is confirmed.
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { sendMail } from "./email";
import { messages } from "./messages";
import { originFor } from "./site";
import { isLang, type Lang } from "./types";
import { KINDS, REQUIRED, type Kind } from "./forms-shared";

export { KINDS, REQUIRED, type Kind };

export type Submission = {
  kind: Kind;
  locale: Lang;
  email: string;
  name: string | null;
  club: string | null;
  sport: string | null;
  city: string | null;
  role: "organiser" | "player" | null;
  message: string | null;
  extra: Record<string, string | boolean>;
  consentText: string;
};

export type ParseResult = { ok: true; value: Submission } | { ok: false; reason: "spam" | "invalid"; field?: string };

const clean = (v: FormDataEntryValue | null, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
  return s || null;
};

export const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

export function consentText(kind: Kind, lang: Lang): string {
  const f = messages[lang].form;
  return kind === "contact" || kind === "walkthrough" || kind === "invite" ? f.consentReply : f.consentUpdates;
}

export function parseSubmission(form: FormData): ParseResult {
  // The honeypot: a field people never see. Anything in it is a bot.
  if (clean(form.get("website"), 200)) return { ok: false, reason: "spam" };
  const kind = clean(form.get("kind"), 20) as Kind | null;
  const locale = clean(form.get("locale"), 2) ?? undefined;
  if (!kind || !KINDS.includes(kind) || !isLang(locale)) return { ok: false, reason: "invalid", field: "kind" };
  const email = clean(form.get("email"), 254)?.toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "invalid", field: "email" };
  if (form.get("consent") !== "yes") return { ok: false, reason: "invalid", field: "consent" };
  const role = clean(form.get("role"), 20);
  const value: Submission = {
    kind,
    locale,
    email,
    name: clean(form.get("name"), 120),
    club: clean(form.get("club"), 160),
    sport: clean(form.get("sport"), 60),
    city: clean(form.get("city"), 120),
    role: role === "organiser" || role === "player" ? role : null,
    message: clean(form.get("message"), 4000),
    extra: {},
    consentText: consentText(kind, locale),
  };
  for (const field of REQUIRED[kind]) if (!value[field]) return { ok: false, reason: "invalid", field };
  if (kind === "invite") {
    const organiserEmail = clean(form.get("organiserEmail"), 254);
    if (organiserEmail && EMAIL_RE.test(organiserEmail)) value.extra.organiserEmail = organiserEmail.toLowerCase();
    value.extra.mentionMe = form.get("mentionMe") === "yes";
  }
  return { ok: true, value };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** A salted, one-way hash of the visitor's address: enough to rate limit, not to identify. */
export function rateBucket(ip: string, env: Record<string, string | undefined> = process.env): string {
  const day = new Date().toISOString().slice(0, 10);
  return sha(`${env.RATE_LIMIT_SALT || "luvallplay-site"}:${day}:${ip}`);
}

export const RATE_LIMIT = { perHour: 8 };

/** True when this visitor may submit again. Records the attempt. */
export async function allowRate(bucket: string): Promise<boolean> {
  const { rows } = await db().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM site_rate_limits WHERE bucket = $1 AND created_at > now() - interval '1 hour'",
    [bucket],
  );
  if (Number(rows[0].n) >= RATE_LIMIT.perHour) return false;
  await db().query("INSERT INTO site_rate_limits (bucket) VALUES ($1)", [bucket]);
  return true;
}

export async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Not configured: the honeypot and rate limit stand alone.
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  return res.ok && ((await res.json()) as { success?: boolean }).success === true;
}

/**
 * Stores a submission as pending and emails the confirmation link.
 * A repeat from the same address updates the first row (no duplicates) and
 * sends a fresh link, unless it's already confirmed.
 */
export async function saveSubmission(s: Submission): Promise<{ status: "pending" | "already-confirmed"; mail: "sent" | "captured" | "failed" | "none" }> {
  const token = randomBytes(24).toString("base64url");
  const { rows } = await db().query<{ id: string; status: string }>(
    `INSERT INTO site_submissions (kind, email, name, club, sport, city, role, message, extra, locale, consent_text, token_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (kind, lower(email)) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, site_submissions.name),
       club = COALESCE(EXCLUDED.club, site_submissions.club),
       sport = COALESCE(EXCLUDED.sport, site_submissions.sport),
       city = COALESCE(EXCLUDED.city, site_submissions.city),
       role = COALESCE(EXCLUDED.role, site_submissions.role),
       message = COALESCE(EXCLUDED.message, site_submissions.message),
       extra = site_submissions.extra || EXCLUDED.extra,
       locale = EXCLUDED.locale,
       consent_text = EXCLUDED.consent_text,
       consent_at = now(),
       token_hash = CASE WHEN site_submissions.status = 'confirmed' THEN site_submissions.token_hash ELSE EXCLUDED.token_hash END,
       updated_at = now()
     RETURNING id, status`,
    [s.kind, s.email, s.name, s.club, s.sport, s.city, s.role, s.message, JSON.stringify(s.extra), s.locale, s.consentText, sha(token)],
  );
  if (rows[0].status === "confirmed") {
    // Already on the list: tell the team about the new details, send nothing to the person.
    await notifyTeam(rows[0].id, true);
    return { status: "already-confirmed", mail: "none" };
  }
  const m = messages[s.locale].email;
  const origin = originFor(s.locale);
  const confirm = `${origin}/api/forms/confirm?t=${token}&l=${s.locale}`;
  const remove = `${origin}/api/forms/remove?t=${token}&l=${s.locale}`;
  const text = `${m.confirmIntro}\n\n${confirm}\n\n${m.confirmIgnore}\n\n${m.remove}: ${remove}\n\n${m.signoff}\nLuvallplay`;
  const html = `<p>${m.confirmIntro}</p><p><a href="${confirm}" style="display:inline-block;background:#0e6b4f;color:#fafaf7;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${m.confirmButton}</a></p><p>${m.confirmIgnore}</p><p style="font-size:13px;color:#4a5a55"><a href="${remove}" style="color:#4a5a55">${m.remove}</a></p><p>${m.signoff}<br>Luvallplay</p>`;
  const mail = await sendMail({ to: s.email, subject: m.confirmSubject, text, html });
  return { status: "pending", mail };
}

type Row = { id: string; kind: Kind; email: string; name: string | null; club: string | null; sport: string | null; city: string | null; role: string | null; message: string | null; extra: Record<string, unknown>; locale: Lang; status: string };

/** The link in the email: marks the address confirmed and tells the team. */
export async function confirmSubmission(token: string): Promise<Lang | null> {
  const { rows } = await db().query<Row>(
    `UPDATE site_submissions SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, now()), updated_at = now()
     WHERE token_hash = $1 RETURNING *`,
    [sha(token)],
  );
  if (!rows[0]) return null;
  await notifyTeam(rows[0].id, false);
  return rows[0].locale;
}

/** "Remove my details": deletes the row for good. */
export async function removeSubmission(token: string): Promise<Lang | null> {
  const { rows } = await db().query<{ locale: Lang }>("DELETE FROM site_submissions WHERE token_hash = $1 RETURNING locale", [sha(token)]);
  return rows[0]?.locale ?? null;
}

async function notifyTeam(id: string, update: boolean): Promise<void> {
  const to = process.env.TEAM_NOTIFY_EMAIL;
  const { rows } = await db().query<Row & { team_notified_at: string | null }>("SELECT * FROM site_submissions WHERE id = $1", [id]);
  const r = rows[0];
  if (!r || !to || (r.team_notified_at && !update)) return;
  const lines = [
    `Form: ${r.kind}${update ? " (updated)" : ""}`,
    `Email: ${r.email}`,
    r.name && `Name: ${r.name}`,
    r.role && `Role: ${r.role}`,
    r.club && `Club: ${r.club}`,
    r.sport && `Sport: ${r.sport}`,
    r.city && `City: ${r.city}`,
    r.message && `Message:\n${r.message}`,
    Object.keys(r.extra ?? {}).length ? `More: ${JSON.stringify(r.extra)}` : null,
    `Language: ${r.locale}`,
  ].filter(Boolean);
  const sent = await sendMail({ to, subject: `[Luvallplay site] ${r.kind}: ${r.club || r.name || r.email}`, text: lines.join("\n"), replyTo: r.email });
  if (sent !== "failed") await db().query("UPDATE site_submissions SET team_notified_at = now() WHERE id = $1", [id]);
}

/** Housekeeping (daily cron): the retention promises in the privacy notice. */
export async function purge(): Promise<{ unconfirmed: number; rate: number; captured: number }> {
  const a = await db().query("DELETE FROM site_submissions WHERE status = 'pending' AND created_at < now() - interval '30 days'");
  const b = await db().query("DELETE FROM site_rate_limits WHERE created_at < now() - interval '1 day'");
  const c = await db().query("DELETE FROM site_captured_emails WHERE created_at < now() - interval '7 days'");
  return { unconfirmed: a.rowCount ?? 0, rate: b.rowCount ?? 0, captured: c.rowCount ?? 0 };
}
