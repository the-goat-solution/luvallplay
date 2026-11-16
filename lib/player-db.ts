import { sql } from "@vercel/postgres";
import { ensureTables } from "./db";
import { getClubToday } from "./dates";
import type { Lang } from "./i18n";
import { toE164 } from "./phone";

// Player accounts. Everything a player has done is already stored under
// their email (memberships, bookings, jersey registrations, court board
// profiles), so an account is keyed by that lower-cased email and the rest
// of the app links to it by email rather than by a new foreign key. That
// keeps every existing table untouched and means an account picks up its
// history the moment it exists.
//
// Same memoised, idempotent DDL approach as ensureTables() in lib/db.ts.

let ensurePromise: Promise<void> | null = null;

export function ensurePlayerTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = ensureImpl().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function ensureImpl() {
  await ensureTables();
  await sql`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      display_name TEXT,
      phone TEXT,
      phone_e164 TEXT,
      phone_verified_at TIMESTAMPTZ,
      lang TEXT NOT NULL DEFAULT 'en',
      stripe_customer_id TEXT,
      leaderboard_visible BOOLEAN NOT NULL DEFAULT TRUE,
      minigame_name TEXT,
      avatar_url TEXT,
      created_via TEXT NOT NULL DEFAULT 'signup',
      claimed_at TIMESTAMPTZ,
      welcome_sent_at TIMESTAMPTZ,
      welcome_card_dismissed_at TIMESTAMPTZ,
      install_hint_shown_at TIMESTAMPTZ,
      installed_at TIMESTAMPTZ,
      leaderboard_optout_token TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `;
  // A confirmed phone number signs in exactly one account.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS players_phone_verified_idx
      ON players (phone_e164)
      WHERE phone_verified_at IS NOT NULL AND deleted_at IS NULL;
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS players_minigame_name_idx
      ON players (lower(minigame_name))
      WHERE minigame_name IS NOT NULL;
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS auth_codes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      link_token_hash TEXT NOT NULL UNIQUE,
      attempts INT NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      ip_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS auth_codes_email_idx ON auth_codes (email, created_at DESC);`;
  await sql`
    CREATE TABLE IF NOT EXISTS player_sessions (
      id SERIAL PRIMARY KEY,
      player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `;
  // Every text message Google sends for us, for the rolling 24-hour cap on
  // SMS codes (lib/sms.ts). phone_hash lets the per-number limit work
  // without keeping numbers in a log.
  await sql`
    CREATE TABLE IF NOT EXISTS sms_sends (
      id SERIAL PRIMARY KEY,
      purpose TEXT NOT NULL,
      phone_hash TEXT NOT NULL,
      ip_hash TEXT,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS sms_sends_sent_at_idx ON sms_sends (sent_at);`;
  // Small key/value store for player-side switches (SMS on/off, the last
  // "cap reached" alert) that admins change at runtime.
  await sql`
    CREATE TABLE IF NOT EXISTS player_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  // Install-guide and welcome-card events, so admins can see how many
  // players added the app to their home screen.
  await sql`
    CREATE TABLE IF NOT EXISTS player_events (
      id SERIAL PRIMARY KEY,
      player_id INT REFERENCES players(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

export type Player = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  phone: string | null;
  phoneE164: string | null;
  phoneVerified: boolean;
  lang: Lang;
  stripeCustomerId: string | null;
  leaderboardVisible: boolean;
  minigameName: string | null;
  createdVia: "member_import" | "signup" | "admin";
  claimedAt: string | null;
  welcomeSentAt: string | null;
  welcomeCardDismissed: boolean;
  installHintShown: boolean;
  installedAt: string | null;
  createdAt: string;
};

export type PlayerRow = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  phone_verified_at: Date | null;
  lang: string;
  stripe_customer_id: string | null;
  leaderboard_visible: boolean;
  minigame_name: string | null;
  created_via: string;
  claimed_at: Date | null;
  welcome_sent_at: Date | null;
  welcome_card_dismissed_at: Date | null;
  install_hint_shown_at: Date | null;
  installed_at: Date | null;
  created_at: Date;
};

export const PLAYER_COLUMNS = `p.id, p.email, p.first_name, p.last_name, p.display_name, p.phone,
  p.phone_e164, p.phone_verified_at, p.lang, p.stripe_customer_id, p.leaderboard_visible,
  p.minigame_name, p.created_via, p.claimed_at, p.welcome_sent_at, p.welcome_card_dismissed_at,
  p.install_hint_shown_at, p.installed_at, p.created_at`;

/** "Hòa N." from first and last name: the default public name. */
export function defaultDisplayName(first: string, last: string, email = ""): string {
  const f = first.trim();
  const l = last.trim();
  if (!f) return email.split("@")[0] || "Player";
  return l ? `${f} ${l[0].toUpperCase()}.` : f;
}

export function mapPlayer(r: PlayerRow): Player {
  return {
    id: r.id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    displayName: r.display_name?.trim() || defaultDisplayName(r.first_name, r.last_name, r.email),
    phone: r.phone,
    phoneE164: r.phone_e164,
    phoneVerified: Boolean(r.phone_verified_at),
    lang: r.lang === "vi" ? "vi" : "en",
    stripeCustomerId: r.stripe_customer_id,
    leaderboardVisible: r.leaderboard_visible,
    minigameName: r.minigame_name,
    createdVia:
      r.created_via === "member_import" || r.created_via === "admin" ? r.created_via : "signup",
    claimedAt: r.claimed_at ? r.claimed_at.toISOString() : null,
    welcomeSentAt: r.welcome_sent_at ? r.welcome_sent_at.toISOString() : null,
    welcomeCardDismissed: Boolean(r.welcome_card_dismissed_at),
    installHintShown: Boolean(r.install_hint_shown_at),
    installedAt: r.installed_at ? r.installed_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

export function normalizeAccountEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export { toE164 } from "./phone";

export async function getPlayerById(id: number): Promise<Player | null> {
  await ensurePlayerTables();
  const { rows } = await sql.query(
    `SELECT ${PLAYER_COLUMNS} FROM players p WHERE p.id = $1 AND p.deleted_at IS NULL;`,
    [id],
  );
  return rows[0] ? mapPlayer(rows[0] as PlayerRow) : null;
}

export async function getPlayerByEmail(email: string): Promise<Player | null> {
  await ensurePlayerTables();
  const { rows } = await sql.query(
    `SELECT ${PLAYER_COLUMNS} FROM players p WHERE p.email = $1 AND p.deleted_at IS NULL;`,
    [normalizeAccountEmail(email)],
  );
  return rows[0] ? mapPlayer(rows[0] as PlayerRow) : null;
}

export async function getPlayerByVerifiedPhone(phoneE164: string): Promise<Player | null> {
  await ensurePlayerTables();
  const { rows } = await sql.query(
    `SELECT ${PLAYER_COLUMNS} FROM players p
     WHERE p.phone_e164 = $1 AND p.phone_verified_at IS NOT NULL AND p.deleted_at IS NULL;`,
    [phoneE164],
  );
  return rows[0] ? mapPlayer(rows[0] as PlayerRow) : null;
}

type MemberDetails = {
  firstName: string;
  lastName: string;
  phone: string | null;
  stripeCustomerId?: string | null;
};

/**
 * The newest name and phone recorded under an email, from memberships first
 * (members keep these most current), then casual bookings and jersey
 * registrations.
 */
export async function latestDetailsForEmail(email: string): Promise<MemberDetails | null> {
  await ensureTables();
  const { rows } = await sql.query(
    `SELECT first_name, last_name, phone, created_at FROM (
       SELECT first_name, last_name, phone, created_at, 1 AS rank FROM memberships
         WHERE lower(email) = $1 AND coalesce(first_name, '') <> ''
       UNION ALL
       SELECT first_name, last_name, phone, created_at, 2 AS rank FROM bookings
         WHERE lower(email) = $1 AND coalesce(first_name, '') <> ''
     ) d
     ORDER BY rank, created_at DESC
     LIMIT 1;`,
    [normalizeAccountEmail(email)],
  );
  const r = rows[0];
  if (!r) return null;
  return { firstName: r.first_name ?? "", lastName: r.last_name ?? "", phone: r.phone ?? null };
}

/**
 * Finds or creates the account for an email. Used by sign-in, membership
 * signup, cash members, the Stripe webhook and Stripe sync, so every member
 * ends up with exactly one account however they joined. Never overwrites
 * details a player has already set.
 */
export async function ensurePlayerForEmail(
  rawEmail: string,
  options: {
    via: "member_import" | "signup" | "admin";
    details?: Partial<MemberDetails>;
  },
): Promise<{ player: Player; created: boolean }> {
  await ensurePlayerTables();
  const email = normalizeAccountEmail(rawEmail);
  const existing = await getPlayerByEmail(email);
  if (existing) {
    // Fill gaps only: a player's own edits always win.
    const d = options.details;
    if (d) {
      await sql.query(
        `UPDATE players SET
           first_name = CASE WHEN first_name = '' THEN coalesce($2, first_name) ELSE first_name END,
           last_name = CASE WHEN last_name = '' THEN coalesce($3, last_name) ELSE last_name END,
           phone = coalesce(phone, $4),
           phone_e164 = coalesce(phone_e164, $5),
           stripe_customer_id = coalesce(stripe_customer_id, $6)
         WHERE id = $1;`,
        [
          existing.id,
          d.firstName?.trim() || null,
          d.lastName?.trim() || null,
          d.phone?.trim() || null,
          toE164(d.phone),
          d.stripeCustomerId ?? null,
        ],
      );
      return { player: (await getPlayerById(existing.id)) ?? existing, created: false };
    }
    return { player: existing, created: false };
  }

  const fromHistory = await latestDetailsForEmail(email);
  const firstName = options.details?.firstName?.trim() || fromHistory?.firstName || "";
  const lastName = options.details?.lastName?.trim() || fromHistory?.lastName || "";
  const phone = options.details?.phone?.trim() || fromHistory?.phone || null;
  const { rows } = await sql.query(
    `INSERT INTO players (email, first_name, last_name, phone, phone_e164, stripe_customer_id, created_via)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO NOTHING
     RETURNING id;`,
    [email, firstName, lastName, phone, toE164(phone), options.details?.stripeCustomerId ?? null, options.via],
  );
  const id = rows[0]?.id as number | undefined;
  const player = id ? await getPlayerById(id) : await getPlayerByEmail(email);
  if (!player) throw new Error("Could not create player account");
  return { player, created: Boolean(id) };
}

/**
 * Best-effort account link for a new membership. A failure here must never
 * break a payment or signup, so it only logs.
 */
export async function linkMemberAccount(
  email: string,
  details: Partial<MemberDetails>,
  via: "signup" | "admin" = "signup",
): Promise<void> {
  try {
    await ensurePlayerForEmail(email, { via, details });
  } catch (err) {
    console.error("[players] could not link account for new membership:", err);
  }
}

export async function updatePlayerProfile(
  id: number,
  input: { firstName: string; lastName: string; displayName: string | null; phone: string | null; lang: Lang },
): Promise<void> {
  const phoneE164 = toE164(input.phone);
  // Changing the number drops its confirmation: the new one hasn't been proven.
  await sql.query(
    `UPDATE players SET
       first_name = $2, last_name = $3, display_name = $4, lang = $7,
       phone_verified_at = CASE WHEN phone_e164 IS DISTINCT FROM $6 THEN NULL ELSE phone_verified_at END,
       phone = $5, phone_e164 = $6
     WHERE id = $1;`,
    [id, input.firstName.trim(), input.lastName.trim(), input.displayName?.trim() || null, input.phone?.trim() || null, phoneE164, input.lang],
  );
}

export async function setLeaderboardVisible(id: number, visible: boolean): Promise<void> {
  await sql`UPDATE players SET leaderboard_visible = ${visible} WHERE id = ${id};`;
}

export async function markPhoneVerified(id: number, phoneE164: string): Promise<"ok" | "taken"> {
  try {
    await sql`
      UPDATE players SET phone_e164 = ${phoneE164}, phone_verified_at = NOW(),
        phone = coalesce(phone, ${phoneE164})
      WHERE id = ${id};
    `;
    return "ok";
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return "taken";
    throw err;
  }
}

export async function markClaimed(id: number): Promise<void> {
  await sql`UPDATE players SET claimed_at = coalesce(claimed_at, NOW()) WHERE id = ${id};`;
}

export async function recordPlayerEvent(playerId: number | null, event: string, detail?: string): Promise<void> {
  await ensurePlayerTables();
  await sql`INSERT INTO player_events (player_id, event, detail) VALUES (${playerId}, ${event}, ${detail ?? null});`;
}

export async function getPlayerSetting(key: string): Promise<string | null> {
  await ensurePlayerTables();
  const { rows } = await sql`SELECT value FROM player_settings WHERE key = ${key};`;
  return (rows[0]?.value as string | undefined) ?? null;
}

export async function setPlayerSetting(key: string, value: string): Promise<void> {
  await ensurePlayerTables();
  await sql`
    INSERT INTO player_settings (key, value, updated_at) VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  `;
}

/**
 * Soft delete: the account and its sign-ins go, payment records (memberships,
 * bookings, orders) stay as the law requires, but are no longer linked to a
 * sign-in. The email is freed so the person can sign up again later.
 */
export async function deletePlayerAccount(id: number): Promise<void> {
  await sql`DELETE FROM player_sessions WHERE player_id = ${id};`;
  await sql`
    UPDATE players SET deleted_at = NOW(), email = 'deleted-' || id || '@deleted.invalid',
      phone = NULL, phone_e164 = NULL, phone_verified_at = NULL, display_name = NULL,
      first_name = '', last_name = '', leaderboard_visible = FALSE
    WHERE id = ${id};
  `;
}

// ---------------------------------------------------------------------------
// Member import (§4a of docs/plans/player-profiles.md)
// ---------------------------------------------------------------------------

export type ImportCandidate = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  plans: string[];
  hasAccount: boolean;
  /** Other candidate emails that are the same inbox written differently. */
  nearDuplicates: string[];
};

/** Lower-cased emails with a membership that grants access today or later. */
export async function listActiveMemberEmails(): Promise<string[]> {
  await ensureTables();
  const { dateKey } = getClubToday();
  const { rows } = await sql.query(
    `SELECT DISTINCT lower(trim(email)) AS email FROM memberships
     WHERE status IN ('active', 'trialing', 'past_due')
       AND (period_end IS NULL OR period_end >= $1::date OR (recurring AND cancel_at_period_end = FALSE));`,
    [dateKey],
  );
  return rows.map((r) => r.email as string).filter(Boolean);
}

function inboxKey(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export async function previewMemberImport(): Promise<ImportCandidate[]> {
  await ensurePlayerTables();
  const { dateKey } = getClubToday();
  const { rows } = await sql.query(
    `SELECT DISTINCT ON (lower(trim(m.email)))
        lower(trim(m.email)) AS email, m.first_name, m.last_name, m.phone,
        (SELECT array_agg(DISTINCT m2.plan || ' · ' || m2.day) FROM memberships m2
          WHERE lower(trim(m2.email)) = lower(trim(m.email))
            AND m2.status IN ('active', 'trialing', 'past_due')) AS plans,
        EXISTS (SELECT 1 FROM players p WHERE p.email = lower(trim(m.email)) AND p.deleted_at IS NULL) AS has_account
     FROM memberships m
     WHERE m.status IN ('active', 'trialing', 'past_due')
       AND (m.period_end IS NULL OR m.period_end >= $1::date OR (m.recurring AND m.cancel_at_period_end = FALSE))
     ORDER BY lower(trim(m.email)), m.created_at DESC;`,
    [dateKey],
  );
  const byInbox = new Map<string, string[]>();
  for (const r of rows) {
    const key = inboxKey(r.email as string);
    byInbox.set(key, [...(byInbox.get(key) ?? []), r.email as string]);
  }
  return rows.map((r) => ({
    email: r.email as string,
    firstName: (r.first_name as string) ?? "",
    lastName: (r.last_name as string) ?? "",
    phone: (r.phone as string | null) ?? null,
    plans: (r.plans as string[] | null) ?? [],
    hasAccount: Boolean(r.has_account),
    nearDuplicates: (byInbox.get(inboxKey(r.email as string)) ?? []).filter((e) => e !== r.email),
  }));
}

/** Creates accounts for every active member who hasn't got one. Safe to re-run. */
export async function runMemberImport(): Promise<{ created: number; existing: number }> {
  const candidates = await previewMemberImport();
  let created = 0;
  let existing = 0;
  for (const c of candidates) {
    const result = await ensurePlayerForEmail(c.email, {
      via: "member_import",
      details: { firstName: c.firstName, lastName: c.lastName, phone: c.phone },
    });
    if (result.created) created++;
    else existing++;
  }
  return { created, existing };
}

export type AdminPlayerRow = Player & {
  activeMembership: string | null;
  lastSeenAt: string | null;
};

export async function listPlayersForAdmin(search?: string): Promise<AdminPlayerRow[]> {
  await ensurePlayerTables();
  const { dateKey } = getClubToday();
  const q = search?.trim() ? `%${search.trim().toLowerCase()}%` : null;
  const { rows } = await sql.query(
    `SELECT ${PLAYER_COLUMNS},
       (SELECT m.plan || ' · ' || m.day FROM memberships m
         WHERE lower(trim(m.email)) = p.email AND m.status IN ('active', 'trialing', 'past_due')
           AND (m.period_end IS NULL OR m.period_end >= $1::date OR (m.recurring AND m.cancel_at_period_end = FALSE))
         ORDER BY m.created_at DESC LIMIT 1) AS active_membership,
       (SELECT max(s.last_seen_at) FROM player_sessions s WHERE s.player_id = p.id) AS last_seen_at
     FROM players p
     WHERE p.deleted_at IS NULL
       AND ($2::text IS NULL OR p.email LIKE $2 OR lower(p.first_name || ' ' || p.last_name) LIKE $2
            OR lower(coalesce(p.display_name, '')) LIKE $2)
     ORDER BY p.first_name, p.last_name, p.email;`,
    [dateKey, q],
  );
  return rows.map((r) => ({
    ...mapPlayer(r as PlayerRow),
    activeMembership: (r.active_membership as string | null) ?? null,
    lastSeenAt: r.last_seen_at ? (r.last_seen_at as Date).toISOString() : null,
  }));
}

/**
 * Changes a player's email everywhere it's used: the account, every row that
 * links to it by email, and the Stripe customer (done by the caller, which
 * has Stripe access).
 */
export async function changePlayerEmail(id: number, newEmailRaw: string): Promise<{ oldEmail: string; newEmail: string }> {
  await ensurePlayerTables();
  const newEmail = normalizeAccountEmail(newEmailRaw);
  const player = await getPlayerById(id);
  if (!player) throw new Error("Player not found");
  if (player.email === newEmail) return { oldEmail: player.email, newEmail };
  const clash = await getPlayerByEmail(newEmail);
  if (clash) throw new Error("Another account already uses that email");
  const old = player.email;
  await sql.query(`UPDATE players SET email = $2 WHERE id = $1;`, [id, newEmail]);
  await sql.query(`UPDATE memberships SET email = $2 WHERE lower(trim(email)) = $1;`, [old, newEmail]);
  await sql.query(`UPDATE bookings SET email = $2 WHERE lower(trim(email)) = $1;`, [old, newEmail]);
  await sql.query(`UPDATE session_fill_ins SET email = $2 WHERE lower(trim(email)) = $1;`, [old, newEmail]);
  // Tables owned by optional features may not exist yet on a fresh database.
  for (const table of ["casual_play_profiles", "jersey_registrations", "attendance", "player_absences"]) {
    try {
      await sql.query(`UPDATE ${table} SET email = $2 WHERE lower(trim(email)) = $1;`, [old, newEmail]);
    } catch (err) {
      if ((err as { code?: string }).code !== "42P01") throw err;
    }
  }
  return { oldEmail: old, newEmail };
}

// ---------------------------------------------------------------------------
// Welcome emails for imported members
// ---------------------------------------------------------------------------

export async function countWelcomePending(): Promise<number> {
  await ensurePlayerTables();
  const { rows } = await sql`
    SELECT count(*)::int AS n FROM players
    WHERE created_via = 'member_import' AND welcome_sent_at IS NULL AND deleted_at IS NULL;
  `;
  return (rows[0]?.n as number) ?? 0;
}

export async function listWelcomePending(limit: number): Promise<Player[]> {
  await ensurePlayerTables();
  const { rows } = await sql.query(
    `SELECT ${PLAYER_COLUMNS} FROM players p
     WHERE p.created_via = 'member_import' AND p.welcome_sent_at IS NULL AND p.deleted_at IS NULL
     ORDER BY p.id LIMIT $1;`,
    [limit],
  );
  return rows.map((r) => mapPlayer(r as PlayerRow));
}

/** The token behind the one-click "Hide me from the leaderboard" link. */
export async function ensureOptOutToken(playerId: number): Promise<string> {
  const { rows } = await sql`SELECT leaderboard_optout_token FROM players WHERE id = ${playerId};`;
  const existing = rows[0]?.leaderboard_optout_token as string | null;
  if (existing) return existing;
  const token = (await import("crypto")).randomBytes(24).toString("base64url");
  await sql`UPDATE players SET leaderboard_optout_token = ${token} WHERE id = ${playerId};`;
  return token;
}

export async function markWelcomeSent(playerId: number): Promise<void> {
  await sql`UPDATE players SET welcome_sent_at = NOW() WHERE id = ${playerId};`;
}
