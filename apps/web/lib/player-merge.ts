import { visionName } from "./club-terms";
import { db } from "./database";
import { mirrorClubMember } from "./tenant-members";
import { T } from "./arena-db";
import { WV } from "./wolf-vision-db";
import { normalizeEmail as jerseyNormalizeEmail } from "./jersey";

// Merges a duplicate member (an email typed wrongly, a second account) into
// the one to keep, so everything lives under the kept email from then on:
// memberships, bookings, sign-ups, play days, round robin results, Arena
// pairs and challenges, Wolf Vision passes, shop orders, photos, messages.
// Admin only (/admin/players). Everything runs in one transaction; a preview
// runs the same statements and rolls back, so its counts are exact.
//
// What the kept account ends up with:
//   - every record that was under the duplicate's email or player id;
//   - details it was missing (name, phone, picture, Stripe customer,
//     round robin name) filled from the duplicate;
//   - a play day on both accounts counts once.
// The duplicate account is retired the way "delete account" does it (soft
// delete, sign-ins removed, email freed). Afterwards points are recalculated.

export type Q = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;

export class MergeError extends Error {}

export type MergeResult = {
  applied: boolean;
  keepEmail: string;
  mergeEmail: string;
  /** What happens to the accounts themselves. */
  account: "merged" | "renamed" | "records_only";
  keepName: string | null;
  mergeName: string | null;
  /** Rows moved, per kind of record (only non-zero ones). */
  moved: { label: string; n: number }[];
  notes: string[];
};

type PlayerRow = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  phone_verified_at: Date | null;
  stripe_customer_id: string | null;
  minigame_name: string | null;
  avatar_url: string | null;
  claimed_at: Date | null;
  installed_at: Date | null;
};

async function playerByEmail(q: Q, email: string): Promise<PlayerRow | null> {
  const { rows } = await q(
    `SELECT id, email, first_name, last_name, display_name, phone, phone_e164, phone_verified_at, stripe_customer_id,
            minigame_name, avatar_url, claimed_at, installed_at
     FROM players WHERE lower(trim(email)) = $1 AND deleted_at IS NULL;`,
    [email],
  );
  return (rows[0] as PlayerRow | undefined) ?? null;
}

const fullName = (p: PlayerRow | null) => (p ? `${p.first_name} ${p.last_name}`.trim() || null : null);

/** The merge itself, on a query function inside an open transaction (exported for tests). */
export async function runMerge(q: Q, keepEmail: string, mergeEmail: string): Promise<Omit<MergeResult, "applied">> {
  const moved: { label: string; n: number }[] = [];
  const notes: string[] = [];
  const count = (label: string, n: number | null) => {
    if (n) {
      const had = moved.find((m) => m.label === label);
      if (had) had.n += n;
      else moved.push({ label, n });
    }
  };
  const existing = new Map<string, boolean>();
  const has = async (table: string) => {
    if (!existing.has(table)) {
      const { rows } = await q(`SELECT to_regclass($1) IS NOT NULL AS ok;`, [table]);
      existing.set(table, Boolean(rows[0].ok));
    }
    return existing.get(table)!;
  };

  const keep = await playerByEmail(q, keepEmail);
  const dupe = await playerByEmail(q, mergeEmail);

  // ── Email-keyed records ──────────────────────────────────────────────
  const emailTables: [string, string][] = [
    ["memberships", "memberships"],
    ["bookings", "bookings"],
    ["session_fill_ins", "fill-ins"],
    ["waitlist", "waitlist entries"],
    ["donations", "donations"],
    ["shop_orders", "shop orders"],
  ];
  for (const [table, label] of emailTables) {
    if (!(await has(table))) continue;
    const r = await q(`UPDATE ${table} SET email = $1 WHERE lower(trim(email)) = $2;`, [keepEmail, mergeEmail]);
    count(label, r.rowCount);
  }
  if (await has("day_requests")) {
    // One open request per person per day: the kept one stays if both asked for the same day.
    await q(
      `DELETE FROM day_requests d WHERE lower(trim(d.email)) = $2 AND d.notified_at IS NULL
         AND EXISTS (SELECT 1 FROM day_requests k WHERE lower(k.email) = $1 AND k.day = d.day AND k.notified_at IS NULL);`,
      [keepEmail, mergeEmail],
    );
    count("play day requests", (await q(`UPDATE day_requests SET email = $1 WHERE lower(trim(email)) = $2;`, [keepEmail, mergeEmail])).rowCount);
  }
  if (await has("jersey_registrations")) {
    // One open (pending or paid) jersey order per email. When both emails have
    // one, neither is cancelled here: the duplicate's order gets the kept email
    // for contact but keeps its own duplicate-check key, and the admin decides.
    const keepNorm = jerseyNormalizeEmail(keepEmail);
    const ACTIVE = `status IN ('pending', 'paid')`;
    const keepHasOpen = `EXISTS (SELECT 1 FROM jersey_registrations k WHERE k.email_normalized = $3 AND k.${ACTIVE})`;
    const { rows: both } = await q(
      `SELECT coalesce(ref_code, '#' || id) AS ref, status FROM jersey_registrations
       WHERE lower(trim(email)) = $2 AND ${ACTIVE} AND ${keepHasOpen.replace("$3", "$1")};`,
      [keepNorm, mergeEmail],
    );
    const { rows: kept } = both.length
      ? await q(`SELECT coalesce(ref_code, '#' || id) AS ref, status FROM jersey_registrations WHERE email_normalized = $1 AND ${ACTIVE};`, [keepNorm])
      : { rows: [] };
    const full = await q(
      `UPDATE jersey_registrations SET email = $1, email_normalized = $3
       WHERE lower(trim(email)) = $2 AND NOT (${ACTIVE} AND ${keepHasOpen});`,
      [keepEmail, mergeEmail, keepNorm],
    );
    const contact = await q(`UPDATE jersey_registrations SET email = $1 WHERE lower(trim(email)) = $2;`, [keepEmail, mergeEmail]);
    count("jersey registrations", (full.rowCount ?? 0) + (contact.rowCount ?? 0));
    if (both.length) {
      const list = (rows: Record<string, unknown>[]) => rows.map((r) => `${r.ref} (${r.status})`).join(", ");
      notes.push(
        `Both emails have an open jersey order: ${list(kept)} and ${list(both)}. Both are kept under ${keepEmail}; ` +
          `if one is a double order, ask the developer to cancel it (the jersey admin pages are archived).`,
      );
    }
  }

  // Play days: one row per date. A day counts if either row counted.
  if (await has("attendance")) {
    const r = await q(
      `INSERT INTO attendance (session_date, email, source, verified, removed, recorded_at)
       SELECT session_date, $1, source, verified, removed, recorded_at FROM attendance WHERE lower(trim(email)) = $2
       ON CONFLICT (session_date, email) DO UPDATE SET
         verified = attendance.verified OR EXCLUDED.verified,
         removed = attendance.removed AND EXCLUDED.removed;`,
      [keepEmail, mergeEmail],
    );
    count("play days", r.rowCount);
    await q(`DELETE FROM attendance WHERE lower(trim(email)) = $1;`, [mergeEmail]);
  }
  if (await has("player_absences")) {
    const r = await q(
      `UPDATE player_absences SET email = $1 WHERE lower(trim(email)) = $2
         AND NOT EXISTS (SELECT 1 FROM player_absences x WHERE x.email = $1 AND x.session_date = player_absences.session_date);`,
      [keepEmail, mergeEmail],
    );
    count("“Can’t make it” days", r.rowCount);
    await q(`DELETE FROM player_absences WHERE lower(trim(email)) = $1;`, [mergeEmail]);
  }
  if (await has("casual_play_profiles")) {
    // Court board tier: the kept one wins if both have one.
    await q(
      `UPDATE casual_play_profiles SET email = $1 WHERE email = $2
         AND NOT EXISTS (SELECT 1 FROM casual_play_profiles x WHERE x.email = $1);`,
      [keepEmail, mergeEmail],
    );
    await q(`DELETE FROM casual_play_profiles WHERE email = $1;`, [mergeEmail]);
  }
  if (await has("auth_codes")) await q(`DELETE FROM auth_codes WHERE lower(trim(email)) = $1;`, [mergeEmail]);

  // ── The accounts ─────────────────────────────────────────────────────
  let account: MergeResult["account"] = "records_only";
  if (dupe && !keep) {
    // Only the duplicate has an account: it simply takes the kept email.
    await q(`UPDATE players SET email = $2 WHERE id = $1;`, [dupe.id, keepEmail]);
    account = "renamed";
    notes.push(`The account ${mergeEmail} now signs in as ${keepEmail}.`);
  } else if (dupe && keep) {
    account = "merged";
    await mergeAccounts(q, keep, dupe, has, count, notes);
  } else if (!moved.length) {
    throw new MergeError(`Nothing found under ${mergeEmail}: no account and no records.`);
  } else if (!keep) {
    notes.push(`Neither email has a player account yet; the records now sit under ${keepEmail}, ready for when that player signs in.`);
  }

  return { keepEmail, mergeEmail, account, keepName: fullName(keep), mergeName: fullName(dupe), moved, notes };
}

async function mergeAccounts(
  q: Q,
  keep: PlayerRow,
  dupe: PlayerRow,
  has: (t: string) => Promise<boolean>,
  count: (label: string, n: number | null) => void,
  notes: string[],
) {
  const k = keep.id;
  const d = dupe.id;

  // ── Arena: refuse the few cases that can't be merged automatically ──
  const arena = (await has(T.pairs)) && (await has(T.members)) && (await has(T.challenges));
  if (arena) {
    const together = await q(`SELECT id FROM ${T.pairs} WHERE player_low = $1 AND player_high = $2;`, [Math.min(k, d), Math.max(k, d)]);
    if (together.rows.length)
      throw new MergeError("The two accounts were paired with each other in the Arena, so they can't be one player. Nothing was changed.");
    const both = await q(`SELECT id FROM ${T.challenges} WHERE $1 IN (p1, p2, a1, a2) AND $2 IN (p1, p2, a1, a2);`, [k, d]);
    if (both.rows.length)
      throw new MergeError(`The two accounts played in the same Arena challenge (#${both.rows.map((r) => r.id).join(", #")}). Nothing was changed.`);
    const active = await q(`SELECT count(DISTINCT player_id)::int AS n FROM ${T.members} WHERE active AND player_id IN ($1, $2);`, [k, d]);
    if (Number(active.rows[0].n) === 2)
      throw new MergeError("Both accounts have a current Arena partner. One of them needs to leave their pair first. Nothing was changed.");

    count("Arena pairs", (await q(`UPDATE ${T.members} SET player_id = $1 WHERE player_id = $2;`, [k, d])).rowCount);
    await q(
      `UPDATE ${T.pairs} SET
         player_low = LEAST(CASE WHEN player_low = $2 THEN $1 ELSE player_low END, CASE WHEN player_high = $2 THEN $1 ELSE player_high END),
         player_high = GREATEST(CASE WHEN player_low = $2 THEN $1 ELSE player_low END, CASE WHEN player_high = $2 THEN $1 ELSE player_high END)
       WHERE $2 IN (player_low, player_high);`,
      [k, d],
    );
    let challenges = 0;
    for (const col of ["p1", "p2", "a1", "a2"]) {
      challenges += (await q(`UPDATE ${T.challenges} SET ${col} = $1 WHERE ${col} = $2;`, [k, d])).rowCount ?? 0;
    }
    count("Arena challenges", challenges);
    for (const col of ["posted_by", "accepted_by", "called_off_by", "entered_by", "confirmed_by", "disputed_by"]) {
      await q(`UPDATE ${T.challenges} SET ${col} = $1 WHERE ${col} = $2;`, [k, d]);
    }
  }
  if (await has(T.codes)) {
    await q(`UPDATE ${T.codes} SET owner_id = $1 WHERE owner_id = $2;`, [k, d]);
    await q(`UPDATE ${T.codes} SET consumed_by = $1 WHERE consumed_by = $2;`, [k, d]);
  }
  if (await has(T.attempts)) await q(`UPDATE ${T.attempts} SET player_id = $1 WHERE player_id = $2;`, [k, d]);
  if (await has(T.after)) {
    await q(
      `UPDATE ${T.after} SET player_id = $1 WHERE player_id = $2
         AND NOT EXISTS (SELECT 1 FROM ${T.after} x WHERE x.player_id = $1 AND x.challenge_id = ${T.after}.challenge_id);`,
      [k, d],
    );
    await q(`DELETE FROM ${T.after} WHERE player_id = $1;`, [d]);
  }
  if (await has(T.matchStats)) {
    await q(`UPDATE ${T.matchStats} SET recorded_by = $1 WHERE recorded_by = $2;`, [k, d]);
    // The saved numbers name each player by id.
    const r = await q(
      `UPDATE ${T.matchStats} SET stats = jsonb_set(stats, '{players}', (
         SELECT jsonb_agg(CASE WHEN (e->>'playerId')::int = $2 THEN jsonb_set(e, '{playerId}', to_jsonb($1::int)) ELSE e END ORDER BY i)
         FROM jsonb_array_elements(stats->'players') WITH ORDINALITY AS x(e, i)))
       WHERE jsonb_typeof(stats->'players') = 'array' AND stats->'players' @> jsonb_build_array(jsonb_build_object('playerId', $2::int));`,
      [k, d],
    );
    count(`${visionName()} match stats`, r.rowCount);
  }
  // Ranks are rebuilt by the recalculation afterwards.
  if (await has(T.ranks)) await q(`DELETE FROM ${T.ranks} WHERE player_id = $1;`, [d]);

  // ── Other records by player id ──────────────────────────────────────
  const idTables: [string, string][] = [
    [WV.passes, `${visionName()} passes`],
    [WV.updates, `${visionName()} training updates`],
    [WV.labels, `${visionName()} labels`],
    ["shop_orders", "shop orders linked to the account"],
    ["player_events", "activity events"],
    ["message_threads", "message threads"],
    ["player_photos", "photos"],
    ["api_tokens", "connected app tokens"],
    ["webhook_endpoints", "webhooks"],
    ["cancellation_feedback", "membership feedback"],
  ];
  for (const [table, label] of idTables) {
    if (!(await has(table))) continue;
    count(label, (await q(`UPDATE ${table} SET player_id = $1 WHERE player_id = $2;`, [k, d])).rowCount);
  }

  // ── Round robin results (keyed by the mini game name) ───────────────
  const keepName = keep.minigame_name;
  const dupeName = dupe.minigame_name;
  let takeName: string | null = null;
  if (dupeName && !keepName) takeName = dupeName;
  else if (dupeName && keepName && dupeName.toLowerCase() !== keepName.toLowerCase() && (await has("rr_results"))) {
    const clash = await q(
      `SELECT a.draw_id FROM rr_results a JOIN rr_results b ON a.draw_id = b.draw_id
       WHERE lower(a.mg_name) = lower($1) AND lower(b.mg_name) = lower($2) ORDER BY a.draw_id;`,
      [dupeName, keepName],
    );
    if (clash.rows.length)
      throw new MergeError(
        `Both round robin names ("${keepName}" and "${dupeName}") are in the same draw (${clash.rows.map((r) => r.draw_id).join(", ")}). Nothing was changed.`,
      );
    count("round robin results", (await q(`UPDATE rr_results SET mg_name = $2 WHERE lower(mg_name) = lower($1);`, [dupeName, keepName])).rowCount);
    notes.push(`Round robin results under "${dupeName}" now count as "${keepName}".`);
  }

  // ── Retire the duplicate, then give the kept account what it lacked ─
  await q(`DELETE FROM player_sessions WHERE player_id = $1;`, [d]);
  await q(
    `UPDATE players SET deleted_at = NOW(), email = 'deleted-' || id || '@deleted.invalid',
       phone = NULL, phone_e164 = NULL, phone_verified_at = NULL, display_name = NULL, minigame_name = NULL,
       stripe_customer_id = NULL, avatar_url = NULL, first_name = '', last_name = '', leaderboard_visible = FALSE
     WHERE id = $1;`,
    [d],
  );
  const takePhone = !keep.phone_e164 && !keep.phone && (dupe.phone || dupe.phone_e164);
  const takeName2 = !keep.first_name.trim() && !keep.last_name.trim();
  await q(
    `UPDATE players SET
       first_name = CASE WHEN $2 THEN $3 ELSE first_name END,
       last_name = CASE WHEN $2 THEN $4 ELSE last_name END,
       display_name = COALESCE(display_name, $5),
       phone = CASE WHEN $6 THEN $7 ELSE phone END,
       phone_e164 = CASE WHEN $6 THEN $8 ELSE phone_e164 END,
       phone_verified_at = CASE WHEN $6 THEN $9::timestamptz ELSE phone_verified_at END,
       stripe_customer_id = COALESCE(stripe_customer_id, $10),
       avatar_url = COALESCE(avatar_url, $11),
       minigame_name = COALESCE(minigame_name, $12),
       claimed_at = LEAST(claimed_at, $13::timestamptz),
       installed_at = COALESCE(installed_at, $14::timestamptz)
     WHERE id = $1;`,
    [
      k,
      takeName2,
      dupe.first_name,
      dupe.last_name,
      dupe.display_name,
      Boolean(takePhone),
      dupe.phone,
      dupe.phone_e164,
      dupe.phone_verified_at,
      dupe.stripe_customer_id,
      dupe.avatar_url,
      takeName,
      dupe.claimed_at,
      dupe.installed_at,
    ],
  );
  if (takeName) notes.push(`${keep.email} takes the round robin name "${takeName}".`);
  if (takePhone) notes.push(`${keep.email} takes the phone number from the duplicate.`);
  if (dupe.stripe_customer_id && keep.stripe_customer_id && dupe.stripe_customer_id !== keep.stripe_customer_id)
    notes.push(`The duplicate had its own Stripe customer (${dupe.stripe_customer_id}); its email is updated in Stripe too.`);
  notes.push(`The duplicate account #${d} is retired (it can no longer sign in).`);
}

/**
 * Previews (apply = false: runs and rolls back) or applies a merge of
 * mergeEmail into keepEmail. Throws MergeError with a plain-English reason
 * when it can't be done; nothing is changed then.
 */
export async function mergeMembers(keepRaw: string, mergeRaw: string, apply: boolean): Promise<MergeResult> {
  const keepEmail = keepRaw.trim().toLowerCase();
  const mergeEmail = mergeRaw.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(keepEmail) || !/^\S+@\S+\.\S+$/.test(mergeEmail)) throw new MergeError("Enter both emails.");
  if (keepEmail === mergeEmail) throw new MergeError("The two emails are the same.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const q: Q = (text, params) => client.query(text, params as unknown[]);
    const result = await runMerge(q, keepEmail, mergeEmail);
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    // Phase 3: after the commit (a failed mirror must not undo a merge), the
    // retired account's club_members row follows its leaderboard flag.
    if (apply) await mirrorClubMember(db, null);
    return { ...result, applied: apply };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
