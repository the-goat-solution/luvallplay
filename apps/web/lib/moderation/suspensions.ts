// Suspensions: a moderator closes Social, the Marketplace, or both to a
// person (table player_suspensions, migration 0022).
//
// Rules of this file:
// - Rows are only ever added. The app's database role can't change or delete
//   one, and can't choose a row's id or time. A lift ("unsuspend") is a new row.
// - A suspension outlives the account. The row keeps the account's id
//   (without a foreign key) and keyed indexes of the email and the VERIFIED
//   phone the account had: HMACs under CONTACT_INDEX_KEYS with the purposes
//   "suspension.email" and "suspension.phone" (@luvallplay/crypto). The email
//   and phone themselves are never stored. Deleting the account touches
//   nothing here, and the same email or phone signing up again is found.
// - Only a phone number the account has verified counts, when a row is
//   written and when a person is looked up. A number is unique only among
//   verified accounts: anyone can type anyone's number into their profile,
//   and that must neither get the number's real holder suspended nor be a
//   way to check a number.
// - With no index key set the row is still written, with no indexes: it then
//   holds for the account only. A MALFORMED key list throws.
// - The index key that made a row's indexes (index_kid) has to stay in
//   CONTACT_INDEX_KEYS for as long as the row should match by email or
//   phone: these rows can't be re-indexed (nothing may update them, and after
//   a deletion the email is gone). A lookup tries every key listed.
//
// Who is suspended. EVERY suspend row stands on its own. A person is
// suspended from an area (Social or the Marketplace) when there is a suspend
// row that
//   - is for that area or for "all",
//   - has no end, or an end still to come,
//   - matches them: by account id, or by the index of their email or of
//     their verified phone, and
//   - has not been lifted.
// A later row never shortens or erases an earlier one: a week's suspension
// written after a permanent one, or one that has ended, changes nothing. To
// shorten a suspension, lift it and write the new one.
//
// What lifts a row: a LATER unsuspend row for the SAME account id as the
// row, whose scope covers it. "all" lifts everything; "social" or "market"
// lifts rows of that scope only, so a lift of one area does NOT narrow a
// suspension from everything: lift "all", then suspend from what should stay
// closed. An unsuspend row carries no index and never matches or lifts by
// email or phone, so no row about one account can wash another's clean.
//
// unsuspend(person) therefore writes its lift for every account whose
// standing suspension reaches that person: their own account, and any
// earlier (deleted) account whose row matches their email or verified phone.
// That is how a moderator lets someone back in who signed up again.
//
// carrySuspensions(person) is for the moment before an account is deleted
// (Social plan, Task 6): if the person changed their email or phone since
// they were suspended, the rows only know the old ones. It writes each
// standing suspension again with the indexes they have now.
//
// Nothing here logs an email, a phone number or an index.
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

/** A suspend row `s` that is for `area` (or everything), hasn't ended, and no later unsuspend for its account covers. */
const standingSql = (scopes: string) => `s.action = 'suspend' AND s.scope IN (${scopes}) AND (s.until IS NULL OR s.until > now())
       AND NOT EXISTS (SELECT 1 FROM player_suspensions u WHERE u.action = 'unsuspend' AND u.player_id = s.player_id AND u.id > s.id AND (u.scope = 'all' OR u.scope = s.scope))`;
const ALL_SCOPES = `'social', 'market', 'all'`;

/**
 * A feed query's condition that the row's author isn't suspended from
 * `area` right now, by account id (an author has an account). `playerColumn`
 * is a column ("p.author_id"); anything else throws. The same rule as
 * activeSuspension asked about an account id alone.
 */
export function notSuspendedSql(playerColumn: string, area: SuspensionArea): string {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(playerColumn)) throw new Error(`notSuspendedSql: "${playerColumn}" is not a column.`);
  if (!AREAS.includes(area)) throw new Error(`notSuspendedSql: the scope is "social" or "market".`);
  return `NOT EXISTS (SELECT 1 FROM player_suspensions s WHERE s.player_id = ${playerColumn} AND ${standingSql(`'${area}', 'all'`)})`;
}

type Person = { email: string | null; phone: string | null };

/** The account's email and its VERIFIED phone, as they are indexed; null when there is no such account. */
async function loadPerson(db: Db, playerId: number): Promise<Person | null> {
  const row = (await db.query(`SELECT email, CASE WHEN phone_verified_at IS NOT NULL THEN phone_e164 END AS phone FROM players WHERE id = $1`, [playerId])).rows[0];
  if (!row) return null;
  return { email: normalEmail(row.email), phone: typeof row.phone === "string" && row.phone ? row.phone : null };
}

/** What a new row stores for this person: indexes under the first key listed, or nothing with no key. */
function currentIndexes(person: Person, env: Env): { email: string | null; phone: string | null; kid: string | null } {
  const first = indexKeys(env)()[0];
  const email = first && person.email ? emailIndex(env).current(person.email).mac : null;
  const phone = first && person.phone ? phoneIndex(env).current(person.phone).mac : null;
  return { email, phone, kid: email || phone ? first.id : null };
}

/** What a lookup matches: indexes under every key listed, so rows written before a rotation still match. Empty with no key. */
function everyIndex(person: Person, env: Env): { emails: string[]; phones: string[] } {
  return {
    emails: person.email ? emailIndex(env).all(person.email).map((e) => e.mac) : [],
    phones: person.phone ? phoneIndex(env).all(person.phone).map((e) => e.mac) : [],
  };
}

type Standing = { id: number; playerId: number | null; scope: SuspensionScope; until: Date | null; reasonCode: string; emailIndex: string | null; phoneIndex: string | null; createdBy: number | null };

/** Every standing suspend row (any of `scopes`) that reaches this person, oldest first. */
async function standing(db: Db, playerId: number | null, indexes: { emails: string[]; phones: string[] }, scopes: string): Promise<Standing[]> {
  const { rows } = await db.query(
    `SELECT s.id, s.player_id, s.scope, s.until, s.reason_code, s.email_index, s.phone_index, s.created_by
     FROM player_suspensions s
     WHERE (s.player_id = $1 OR s.email_index = ANY($2::text[]) OR s.phone_index = ANY($3::text[]))
       AND ${standingSql(scopes)}
     ORDER BY s.id`,
    [playerId, indexes.emails, indexes.phones],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    playerId: r.player_id === null ? null : Number(r.player_id),
    scope: r.scope as SuspensionScope,
    until: r.until === null ? null : new Date(r.until as string | Date),
    reasonCode: String(r.reason_code),
    emailIndex: (r.email_index as string | null) ?? null,
    phoneIndex: (r.phone_index as string | null) ?? null,
    createdBy: r.created_by === null ? null : Number(r.created_by),
  }));
}

const INSERT = `INSERT INTO player_suspensions (player_id, action, scope, until, reason_code, email_index, phone_index, index_kid, created_by)`;

/**
 * Suspends a person from `scope` until `until` (null: with no end), with the
 * indexes of their current email and verified phone. It adds to whatever
 * already stands: it never shortens an earlier suspension. `not_found` when
 * there is no such account; `invalid` for an end date that isn't in the
 * future, an unknown scope, or a reason that isn't a code.
 */
export async function suspend(
  db: Db,
  input: { playerId: number; scope: SuspensionScope; until: Date | null; reasonCode: string; actorId: number | null },
  env: Env = process.env,
): Promise<Result<{ id: number }, "not_found" | "invalid">> {
  if (!Number.isInteger(input.playerId) || !SCOPES.includes(input.scope) || !REASON_CODE.test(String(input.reasonCode))) return err("invalid");
  if (input.until !== null && (!(input.until instanceof Date) || Number.isNaN(input.until.getTime()) || input.until.getTime() <= Date.now())) return err("invalid");
  // Read first, so a malformed key list stops everything before a row is written.
  indexKeys(env)();
  const person = await loadPerson(db, input.playerId);
  if (!person) return err("not_found");
  const now = currentIndexes(person, env);
  const { rows } = await db.query(`${INSERT} VALUES ($1, 'suspend', $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [
    input.playerId,
    input.scope,
    input.until,
    input.reasonCode,
    now.email,
    now.phone,
    now.kid,
    input.actorId,
  ]);
  return ok({ id: Number(rows[0].id) });
}

/**
 * Lifts a person's suspension from `scope`: new rows, one for their own
 * account (its id is returned) and one for every other account whose
 * standing suspension of that scope reaches them by email or verified phone.
 * "social" or "market" lifts suspensions of that scope only and leaves one
 * that closes everything standing; "all" lifts everything.
 */
export async function unsuspend(
  db: Db,
  input: { playerId: number; scope: SuspensionScope; reasonCode: string; actorId: number | null },
  env: Env = process.env,
): Promise<Result<{ id: number }, "not_found" | "invalid">> {
  if (!Number.isInteger(input.playerId) || !SCOPES.includes(input.scope) || !REASON_CODE.test(String(input.reasonCode))) return err("invalid");
  indexKeys(env)();
  const person = await loadPerson(db, input.playerId);
  if (!person) return err("not_found");
  const reached = await standing(db, input.playerId, everyIndex(person, env), input.scope === "all" ? ALL_SCOPES : `'${input.scope}'`);
  const others = [...new Set(reached.map((r) => r.playerId).filter((id): id is number => id !== null && id !== input.playerId))];
  // The other accounts first, the person's own last: one statement, and the id returned is their own row's.
  const { rows } = await db.query(
    `${INSERT}
     SELECT account, 'unsuspend', $2, NULL, $3, NULL, NULL, NULL, $4::int FROM unnest($1::int[]) WITH ORDINALITY AS t(account, n) ORDER BY n
     RETURNING id, player_id`,
    [[...others, input.playerId], input.scope, input.reasonCode, input.actorId],
  );
  const own = rows.find((r) => Number(r.player_id) === input.playerId)!;
  return ok({ id: Number(own.id) });
}

/**
 * Writes this person's standing suspensions again with the indexes of the
 * email and verified phone they have NOW, where those differ from the row's.
 * Call it before an account is deleted (and it is safe to call at any time):
 * without it, changing email and phone and then deleting the account would
 * leave rows that only know the old ones. It also carries a suspension that
 * reaches the person from an earlier account. The new rows keep the scope,
 * end, reason and moderator of the row they repeat, and name this account.
 * Doing it again adds nothing. With no index key there is nothing to write.
 */
export async function carrySuspensions(db: Db, playerId: number, env: Env = process.env): Promise<Result<{ carried: number }, "not_found">> {
  indexKeys(env)();
  if (!Number.isInteger(playerId)) return err("not_found");
  const person = await loadPerson(db, playerId);
  if (!person) return err("not_found");
  const now = currentIndexes(person, env);
  if (!now.kid) return ok({ carried: 0 });
  const rows = await standing(db, playerId, everyIndex(person, env), ALL_SCOPES);
  const same = (r: Standing) => r.emailIndex === now.email && r.phoneIndex === now.phone;
  const sameTerms = (a: Standing, b: Standing) => a.scope === b.scope && (a.until?.getTime() ?? null) === (b.until?.getTime() ?? null);
  // A row is already carried when one with the same scope and end holds today's indexes.
  const todo = rows.filter((r) => !same(r) && !rows.some((done) => same(done) && sameTerms(done, r)));
  let carried = 0;
  const written: Standing[] = [];
  for (const r of todo) {
    if (written.some((w) => sameTerms(w, r))) continue;
    await db.query(`${INSERT} VALUES ($1, 'suspend', $2, $3, $4, $5, $6, $7, $8)`, [playerId, r.scope, r.until, r.reasonCode, now.email, now.phone, now.kid, r.createdBy]);
    written.push(r);
    carried++;
  }
  return ok({ carried });
}

/**
 * The suspension that closes `area` to this person right now, or null. The
 * person is whoever is known: an account id, an email, a phone number, any
 * of them. Give all three for someone signing up or joining, so an earlier
 * account's suspension is found by its email or phone. When several stand,
 * the one that lasts longest is returned.
 *
 * `phone` counts only when it is verified. With an account id, that is
 * checked here: the number is used only if it is that account's verified
 * number. With no account id (someone who just proved a number at sign-up)
 * the caller vouches for it: never pass a number a person merely typed.
 */
export async function activeSuspension(
  db: Db,
  who: { playerId?: number | null; email?: string | null; phone?: string | null },
  area: SuspensionArea,
  env: Env = process.env,
): Promise<ActiveSuspension | null> {
  if (!AREAS.includes(area)) throw new Error(`activeSuspension: the scope is "social" or "market".`);
  const playerId = Number.isInteger(who.playerId) ? (who.playerId as number) : null;
  const indexes = everyIndex({ email: normalEmail(who.email), phone: toE164(who.phone ?? null) }, env);
  if (playerId !== null && indexes.phones.length) {
    const phone = toE164(who.phone ?? null);
    const theirs = await db.query(`SELECT 1 FROM players WHERE id = $1 AND phone_e164 = $2 AND phone_verified_at IS NOT NULL`, [playerId, phone]);
    if (!theirs.rows.length) indexes.phones = [];
  }
  if (playerId === null && !indexes.emails.length && !indexes.phones.length) return null;
  const rows = await standing(db, playerId, indexes, `'${area}', 'all'`);
  if (!rows.length) return null;
  const end = (r: Standing) => r.until?.getTime() ?? Infinity;
  const longest = rows.reduce((best, r) => (end(r) > end(best) || (end(r) === end(best) && r.id > best.id) ? r : best));
  return { id: longest.id, scope: longest.scope, until: longest.until?.toISOString() ?? null, reasonCode: longest.reasonCode };
}
