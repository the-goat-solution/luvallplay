// Suspensions: a moderator closes Social, the Marketplace, or both to a
// person (table player_suspensions, migration 0022).
//
// Rules of this file:
// - Rows are only ever added. The app's database role can't change or delete
//   one. A lift ("unsuspend") or a new end date is a new row.
// - A suspension outlives the account. The row keeps the account's id
//   (without a foreign key) and keyed indexes of the email and phone the
//   account had: HMACs under CONTACT_INDEX_KEYS with the purposes
//   "suspension.email" and "suspension.phone" (@luvallplay/crypto). The email
//   and phone themselves are never stored. Deleting the account touches
//   nothing here, and the same email or phone signing up again is found.
// - With no index key set the row is still written, with no indexes: it then
//   holds for the account only. A MALFORMED key list throws.
// - The index key that made a row's indexes (index_kid) has to stay in
//   CONTACT_INDEX_KEYS for as long as the row should match by email or
//   phone: these rows can't be re-indexed (nothing may update them, and after
//   a deletion the email is gone). A lookup tries every key listed.
// - Which row wins: for each of the three ways a person is known (account
//   id, email, phone) the LATEST row that speaks to the scope asked about
//   decides for it: a row for that scope or for "all". The person is suspended when any of
//   the three says so, except that a row naming this very account overrides
//   older rows found by email or phone: that is how a moderator lifts a
//   suspension for someone who signed up again.
// - Nothing here logs an email, a phone number or an index.
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { blindIndex, parseKeks } from "@luvallplay/crypto";
import { toE164 } from "@luvallplay/core/phone";
import { err, ok, type Result } from "./result.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type Env = Record<string, string | undefined>;

/** What a suspension closes. A row may also say "all". */
export type SuspensionArea = "social" | "market";
export type SuspensionScope = SuspensionArea | "all";
const AREAS: readonly string[] = ["social", "market"];
const SCOPES: readonly string[] = ["social", "market", "all"];
/** A reason is a short code (a report reason, "appeal_upheld"), never a sentence about someone. */
const REASON_CODE = /^[a-z][a-z0-9_]{0,39}$/;

export type ActiveSuspension = { id: number; scope: SuspensionScope; until: string | null; reasonCode: string };

const indexKeys = (env: Env) => () => parseKeks(env.CONTACT_INDEX_KEYS, "CONTACT_INDEX_KEYS");
const emailIndex = (env: Env) => blindIndex({ purpose: "suspension.email", keys: indexKeys(env) });
const phoneIndex = (env: Env) => blindIndex({ purpose: "suspension.phone", keys: indexKeys(env) });

/** An email as it is indexed: trimmed and lower-cased. A deleted account's placeholder address is nobody's. */
function normalEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email && !email.endsWith("@deleted.invalid") ? email : null;
}

/**
 * A feed query's condition that the row's author isn't suspended from
 * `area` right now, by account id (an author has an account). `playerColumn`
 * is a column ("p.author_id"); anything else throws.
 */
export function notSuspendedSql(playerColumn: string, area: SuspensionArea): string {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(playerColumn)) throw new Error(`notSuspendedSql: "${playerColumn}" is not a column.`);
  if (!AREAS.includes(area)) throw new Error(`notSuspendedSql: the scope is "social" or "market".`);
  return `NOT COALESCE((SELECT ps.action = 'suspend' AND (ps.until IS NULL OR ps.until > now()) FROM player_suspensions ps WHERE ps.player_id = ${playerColumn} AND ps.scope IN ('${area}', 'all') ORDER BY ps.id DESC LIMIT 1), false)`;
}

async function addRow(
  db: Db,
  input: { playerId: number; action: "suspend" | "unsuspend"; scope: SuspensionScope; until: Date | null; reasonCode: string; actorId: number | null },
  env: Env,
): Promise<Result<{ id: number }, "not_found" | "invalid">> {
  if (!Number.isInteger(input.playerId) || !SCOPES.includes(input.scope) || !REASON_CODE.test(String(input.reasonCode))) return err("invalid");
  if (input.until !== null && (!(input.until instanceof Date) || Number.isNaN(input.until.getTime()) || input.until.getTime() <= Date.now())) return err("invalid");
  // Read first, so a malformed key list stops everything before a row is written.
  const first = indexKeys(env)()[0];
  const person = (await db.query(`SELECT email, phone_e164 FROM players WHERE id = $1`, [input.playerId])).rows[0];
  if (!person) return err("not_found");
  const email = normalEmail(person.email);
  const phone = typeof person.phone_e164 === "string" && person.phone_e164 ? person.phone_e164 : null;
  const emailMac = first && email ? emailIndex(env).current(email).mac : null;
  const phoneMac = first && phone ? phoneIndex(env).current(phone).mac : null;
  const { rows } = await db.query(
    `INSERT INTO player_suspensions (player_id, action, scope, until, reason_code, email_index, phone_index, index_kid, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [input.playerId, input.action, input.scope, input.until, input.reasonCode, emailMac, phoneMac, emailMac || phoneMac ? first.id : null, input.actorId],
  );
  return ok({ id: Number(rows[0].id) });
}

/**
 * Suspends a person from `scope` until `until` (null: with no end), with the
 * indexes of their current email and phone. A second suspension is a new
 * row, and the newest decides. `not_found` when there is no such account;
 * `invalid` for an end date that isn't in the future, an unknown scope, or a
 * reason that isn't a code.
 */
export function suspend(
  db: Db,
  input: { playerId: number; scope: SuspensionScope; until: Date | null; reasonCode: string; actorId: number | null },
  env: Env = process.env,
): Promise<Result<{ id: number }, "not_found" | "invalid">> {
  return addRow(db, { ...input, action: "suspend" }, env);
}

/**
 * Lifts a person's suspension from `scope`: a new row, which wins because it
 * is the latest. Lifting "social" leaves the Marketplace as an earlier "all"
 * left it; lifting "all" opens both.
 */
export function unsuspend(
  db: Db,
  input: { playerId: number; scope: SuspensionScope; reasonCode: string; actorId: number | null },
  env: Env = process.env,
): Promise<Result<{ id: number }, "not_found" | "invalid">> {
  return addRow(db, { ...input, action: "unsuspend", until: null }, env);
}

/**
 * The suspension that closes `area` to this person right now, or null. The
 * person is whoever is known: an account id, an email, a phone number, any
 * of them. Give all three for someone signing up or joining, so an earlier
 * account's suspension is found by its email or phone.
 */
export async function activeSuspension(
  db: Db,
  who: { playerId?: number | null; email?: string | null; phone?: string | null },
  area: SuspensionArea,
  env: Env = process.env,
): Promise<ActiveSuspension | null> {
  if (!AREAS.includes(area)) throw new Error(`activeSuspension: the scope is "social" or "market".`);
  const playerId = Number.isInteger(who.playerId) ? who.playerId : null;
  const email = normalEmail(who.email);
  const phone = toE164(who.phone ?? null);
  // Under every listed key, so rows written before a rotation still match. Empty with no key.
  const emails = email ? emailIndex(env).all(email).map((e) => e.mac) : [];
  const phones = phone ? phoneIndex(env).all(phone).map((e) => e.mac) : [];
  if (playerId === null && !emails.length && !phones.length) return null;
  const { rows } = await db.query(
    `SELECT DISTINCT ON (found.by) found.by, s.id, s.scope, s.until, s.reason_code,
            (s.action = 'suspend' AND (s.until IS NULL OR s.until > now())) AS active
     FROM (
       SELECT 'id' AS by, id FROM player_suspensions WHERE player_id = $2 AND scope = ANY($1::text[])
       UNION ALL
       SELECT 'email', id FROM player_suspensions WHERE email_index = ANY($3::text[]) AND scope = ANY($1::text[])
       UNION ALL
       SELECT 'phone', id FROM player_suspensions WHERE phone_index = ANY($4::text[]) AND scope = ANY($1::text[])
     ) found JOIN player_suspensions s ON s.id = found.id
     ORDER BY found.by, s.id DESC`,
    [[area, "all"], playerId, emails, phones],
  );
  // The newest decision that names this very account overrides older ones found by its email or phone.
  const own = rows.find((r) => r.by === "id");
  const floor = own ? Number(own.id) : 0;
  const closing = rows.filter((r) => r.active === true && Number(r.id) >= floor).sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!closing) return null;
  return {
    id: Number(closing.id),
    scope: closing.scope as SuspensionScope,
    until: closing.until === null ? null : new Date(closing.until as string | Date).toISOString(),
    reasonCode: String(closing.reason_code),
  };
}
