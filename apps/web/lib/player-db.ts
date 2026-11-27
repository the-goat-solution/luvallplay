import { clubClock } from "./club";
import { sql } from "./database";
import { getClubToday } from "./dates";
import type { Lang } from "./i18n";
import { toE164 } from "./phone";
import { findVerifiedByPhone, phoneSealing, sealStoredPhone, sealedPhoneCleared, sealedPhoneUpdate, verifyPhone } from "./pii/contact";
import { defaultTenantSlug, joinClub, mirrorClubMember } from "./tenant-members";

// Player accounts. Everything a player has done is already stored under
// their email (memberships, bookings, jersey registrations, court board
// profiles), so an account is keyed by that lower-cased email and the rest
// of the app links to it by email rather than by a new foreign key. That
// keeps every existing table untouched and means an account picks up its
// history the moment it exists.

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
  /** Profile picture (public Blob URL), or null for initials. */
  avatarUrl: string | null;
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
  avatar_url?: string | null;
  created_at: Date;
};

export const PLAYER_COLUMNS = `p.id, p.email, p.first_name, p.last_name, p.display_name, p.phone,
  p.phone_e164, p.phone_verified_at, p.lang, p.stripe_customer_id, p.leaderboard_visible,
  p.minigame_name, p.created_via, p.claimed_at, p.welcome_sent_at, p.welcome_card_dismissed_at,
  p.install_hint_shown_at, p.installed_at, p.avatar_url, p.created_at`;

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
    avatarUrl: r.avatar_url ?? null,
    createdAt: r.created_at.toISOString(),
  };
}

export function normalizeAccountEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export { toE164 } from "./phone";

export async function getPlayerById(id: number): Promise<Player | null> {
  const { rows } = await sql.query(
    `SELECT ${PLAYER_COLUMNS} FROM players p WHERE p.id = $1 AND p.deleted_at IS NULL;`,
    [id],
  );
  return rows[0] ? mapPlayer(rows[0] as PlayerRow) : null;
}

export async function getPlayerByEmail(email: string): Promise<Player | null> {
  const { rows } = await sql.query(
    `SELECT ${PLAYER_COLUMNS} FROM players p WHERE p.email = $1 AND p.deleted_at IS NULL;`,
    [normalizeAccountEmail(email)],
  );
  return rows[0] ? mapPlayer(rows[0] as PlayerRow) : null;
}

/**
 * The verified account that holds this number. Which copy of the number is
 * matched (the plain column, or the sealed one's index) follows PII_READS
 * (lib/pii/contact.ts); either way only a verified, not-deleted account.
 */
export async function getPlayerByVerifiedPhone(phoneE164: string): Promise<Player | null> {
  const id = await findVerifiedByPhone(sql, phoneE164);
  return id ? getPlayerById(id) : null;
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
  const email = normalizeAccountEmail(rawEmail);
  const existing = await getPlayerByEmail(email);
  if (existing) {
    // Fill gaps only: a player's own edits always win.
    const d = options.details;
    if (d) {
      // A number that fills a gap is sealed with it (lib/pii/contact.ts); one the player already has is left as it is.
      const e164 = toE164(d.phone);
      const sealed = sealedPhoneUpdate(existing.id, e164, { e164Param: "$5", firstParam: 7, onlyIfEmpty: true });
      await sql.query(
        `UPDATE players SET
           first_name = CASE WHEN first_name = '' THEN coalesce($2, first_name) ELSE first_name END,
           last_name = CASE WHEN last_name = '' THEN coalesce($3, last_name) ELSE last_name END,
           phone = coalesce(phone, $4),
           phone_e164 = coalesce(phone_e164, $5),
           stripe_customer_id = coalesce(stripe_customer_id, $6)${sealed.set}
         WHERE id = $1;`,
        [
          existing.id,
          d.firstName?.trim() || null,
          d.lastName?.trim() || null,
          d.phone?.trim() || null,
          e164,
          d.stripeCustomerId ?? null,
          ...sealed.params,
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
  // A malformed key list is refused here, before the account exists, not after.
  phoneSealing().available();
  const { rows } = await sql.query(
    `INSERT INTO players (email, first_name, last_name, phone, phone_e164, stripe_customer_id, created_via)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO NOTHING
     RETURNING id;`,
    [email, firstName, lastName, phone, toE164(phone), options.details?.stripeCustomerId ?? null, options.via],
  );
  const id = rows[0]?.id as number | undefined;
  // The sealed copy is bound to the account's id, which exists only now.
  if (id) await sealStoredPhone(sql, id);
  // A new account made on the club's site is a member of that club.
  if (id) await joinClub(sql, id);
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
  const sealed = sealedPhoneUpdate(id, phoneE164, { e164Param: "$6", firstParam: 8 });
  // Changing the number drops its confirmation: the new one hasn't been proven.
  // The sealed copy and its index change with it (lib/pii/contact.ts).
  await sql.query(
    `UPDATE players SET
       first_name = $2, last_name = $3, display_name = $4, lang = $7,
       phone_verified_at = CASE WHEN phone_e164 IS DISTINCT FROM $6 THEN NULL ELSE phone_verified_at END,
       phone = $5, phone_e164 = $6${sealed.set}
     WHERE id = $1;`,
    [
      id,
      input.firstName.trim(),
      input.lastName.trim(),
      input.displayName?.trim() || null,
      input.phone?.trim() || null,
      phoneE164,
      input.lang,
      ...sealed.params,
    ],
  );
}

export async function setLeaderboardVisible(id: number, visible: boolean): Promise<void> {
  await sql`UPDATE players SET leaderboard_visible = ${visible} WHERE id = ${id};`;
  await mirrorClubMember(sql, id);
}

/**
 * The number is proven to be this player's. "taken" when another verified
 * account holds it. Also writes the sealed copy and its index, and during a
 * key rotation checks "taken" against every index key (lib/pii/contact.ts).
 */
export async function markPhoneVerified(id: number, phoneE164: string): Promise<"ok" | "taken"> {
  return verifyPhone(sql, id, phoneE164);
}

export async function markClaimed(id: number): Promise<void> {
  await sql`UPDATE players SET claimed_at = coalesce(claimed_at, NOW()) WHERE id = ${id};`;
}

export async function recordPlayerEvent(playerId: number | null, event: string, detail?: string): Promise<void> {
  await sql`INSERT INTO player_events (player_id, event, detail) VALUES (${playerId}, ${event}, ${detail ?? null});`;
}

export async function getPlayerSetting(key: string): Promise<string | null> {
  const { rows } = await sql`SELECT value FROM player_settings WHERE key = ${key};`;
  return (rows[0]?.value as string | undefined) ?? null;
}

export async function setPlayerSetting(key: string, value: string): Promise<void> {
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
  // The sealed copy of the number and its index go too (lib/pii/contact.ts).
  await sql.query(
    `UPDATE players SET deleted_at = NOW(), email = 'deleted-' || id || '@deleted.invalid',
      phone = NULL, phone_e164 = NULL, phone_verified_at = NULL, display_name = NULL,
      first_name = '', last_name = '', leaderboard_visible = FALSE${sealedPhoneCleared()}
    WHERE id = $1;`,
    [id],
  );
  await mirrorClubMember(sql, id);
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
  const { dateKey } = getClubToday(new Date(), await clubClock());
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
  const { dateKey } = getClubToday(new Date(), await clubClock());
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
  const { dateKey } = getClubToday(new Date(), await clubClock());
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
       -- Accounts are global; a club's directory is the people in that club.
       AND EXISTS (SELECT 1 FROM club_members cm JOIN tenants t ON t.id = cm.tenant_id WHERE cm.user_id = p.id AND t.slug = $3)
       AND ($2::text IS NULL OR p.email LIKE $2 OR lower(p.first_name || ' ' || p.last_name) LIKE $2
            OR lower(coalesce(p.display_name, '')) LIKE $2)
     ORDER BY p.first_name, p.last_name, p.email;`,
    [dateKey, q, defaultTenantSlug()],
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
  const { rows } = await sql`
    SELECT count(*)::int AS n FROM players
    WHERE created_via = 'member_import' AND welcome_sent_at IS NULL AND deleted_at IS NULL;
  `;
  return (rows[0]?.n as number) ?? 0;
}

export async function listWelcomePending(limit: number): Promise<Player[]> {
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

/** Sets (or clears) a player's profile picture; returns the previous URL so the caller can delete it. */
export async function setPlayerAvatar(playerId: number, url: string | null): Promise<string | null> {
  const { rows } = await sql.query(
    `UPDATE players p SET avatar_url = $2
     FROM (SELECT id, avatar_url AS old FROM players WHERE id = $1) o
     WHERE p.id = o.id RETURNING o.old;`,
    [playerId, url],
  );
  return (rows[0]?.old as string | null) ?? null;
}
