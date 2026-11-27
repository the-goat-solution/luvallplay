// A player's phone number, sealed beside the plain column (migration
// players_contact_sealed).
//
// A number is kept three ways while the plain columns exist:
//
//   phone / phone_e164   as before (what the app reads until PII_READS says
//                        otherwise);
//   phone_sealed         the E.164 number, encrypted for that one person:
//                        bound to ["player.phone", playerId], so one row's
//                        sealed text can't be opened as another's, even by
//                        copying it in the database (keys: CONTACT_KEKS);
//   phone_index          a keyed fingerprint of the number (CONTACT_INDEX_KEYS),
//                        the same for the same number, so "who has this
//                        number?" and "one verified account per number" still
//                        work on it; phone_index_kid names the key.
//
// What this does and doesn't give, said plainly:
// - While phone and phone_e164 exist, sealing adds NO secrecy. It prepares
//   their removal (not part of this change).
// - Phone numbers are few (about 10^8 per country). Whoever holds
//   CONTACT_INDEX_KEYS and a copy of the database can recover every number
//   by trying them all: the index key is as secret as the numbers.
//
// Rules of this file:
// - Writes fill the sealed columns whenever both key lists are set. With
//   either unset they store the plain number only, as before this change. A
//   MALFORMED list throws: it must never quietly become "not sealed".
// - With neither key list set and PII_READS not "sealed", no statement the
//   app runs names the new columns at all: the app works exactly as before
//   on a database the migration hasn't reached yet. So the order in
//   production is: migrate, then set the keys, then backfill, then switch
//   reads. (Setting a key before the migration has run breaks writes.)
// - Reads follow PII_READS: "plain" (default) matches phone_e164, "sealed"
//   matches phone_index under every listed index key.
// - The database clears the sealed columns itself whenever the plain number
//   changes without a new sealing (trigger players_phone_sealed_follows_plain),
//   so no writer can leave a stale one behind.
// - Nothing here logs a number, a sealed text or an index, and none of them
//   belongs in the audit log.
import { blindIndex, createSeal, parseKeks, SealError } from "@luvallplay/crypto";
import { toE164 } from "@luvallplay/core/phone";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type Env = Record<string, string | undefined>;

/** The purpose: first in every binding, and part of what the index hashes. */
const PURPOSE = "player.phone";

export type SealedPhone = { sealed: string; index: string; indexKid: string };
export type PhoneSealing = {
  /** Whether numbers are sealed here: both key lists set. Throws on a malformed list. */
  available(): boolean;
  /** The three values a row stores for this person's number. Throws SealError with no key. */
  seal(playerId: number, e164: string): SealedPhone;
  /** The number, for the person it was sealed for. */
  open(playerId: number, sealed: string): string;
  /** The number's index under every listed index key, newest first: what a lookup matches. Empty with no key. */
  indexes(e164: string): string[];
};

/** The deployment's phone sealing, from CONTACT_KEKS and CONTACT_INDEX_KEYS. */
export function phoneSealing(env: Env = process.env): PhoneSealing {
  const keks = () => parseKeks(env.CONTACT_KEKS, "CONTACT_KEKS");
  const indexKeys = () => parseKeks(env.CONTACT_INDEX_KEYS, "CONTACT_INDEX_KEYS");
  const envelope = createSeal({ purpose: "CONTACT_KEKS", keks });
  const index = blindIndex({ purpose: PURPOSE, keys: indexKeys });
  return {
    available() {
      // Both are read (not `a && b`) so a malformed list is reported whichever it is.
      const sealing = keks().length > 0;
      const indexing = indexKeys().length > 0;
      return sealing && indexing;
    },
    seal(playerId, e164) {
      // The index first: with no index key nothing is sealed either (a sealed number nobody could find).
      const { kid, mac } = index.current(e164);
      return { sealed: envelope.seal([PURPOSE, playerId], e164), index: mac, indexKid: kid };
    },
    open(playerId, sealed) {
      return envelope.open([PURPOSE, playerId], sealed);
    },
    indexes(e164) {
      return index.all(e164).map((entry) => entry.mac);
    },
  };
}

/** Which copy lookups read: "plain" until the owner switches to "sealed". Any other value is refused. */
export function piiReads(env: Env = process.env): "plain" | "sealed" {
  const value = (env.PII_READS ?? "").trim();
  if (value === "" || value === "plain") return "plain";
  if (value === "sealed") return "sealed";
  throw new Error('PII_READS must be "plain" or "sealed".');
}

/**
 * Whether this deployment uses the sealed columns at all: a contact key list
 * is set (even a malformed one) or reads are switched to sealed. While it is
 * false the app names none of the three columns, so it runs unchanged on a
 * database that doesn't have them yet.
 */
export function sealedColumnsInUse(env: Env = process.env): boolean {
  const set = (value: string | undefined) => Boolean(value && value.trim());
  return set(env.CONTACT_KEKS) || set(env.CONTACT_INDEX_KEYS) || (env.PII_READS ?? "").trim() === "sealed";
}

/**
 * For an UPDATE that sets phone_e164 to the parameter named `e164Param`: the
 * extra SET clauses (starting with a comma) and their parameters, numbered
 * from `firstParam`, that keep the sealed columns in step.
 *
 * With sealing on: a changed number takes the new sealing (or none, when the
 * number is removed); an unchanged one is sealed if it wasn't. `onlyIfEmpty`
 * is for an UPDATE that only fills a missing number (coalesce): the sealed
 * columns are then written only where the row had no number.
 *
 * With sealing off (either key list unset) it adds nothing: the statement is
 * the one the app ran before this change. A changed number then loses its
 * sealed copy through the database's trigger, and an unchanged one keeps it.
 */
export function sealedPhoneUpdate(
  playerId: number,
  e164: string | null | undefined,
  at: { e164Param: string; firstParam: number; onlyIfEmpty?: boolean },
  env: Env = process.env,
): { set: string; params: (string | null)[] } {
  const sealing = phoneSealing(env);
  if (!sealing.available()) return { set: "", params: [] };
  const now = e164 ? sealing.seal(playerId, e164) : null;
  const [sealed, index, kid] = [0, 1, 2].map((n) => `$${at.firstParam + n}`);
  const fresh = at.onlyIfEmpty ? "phone_e164 IS NULL" : `phone_e164 IS DISTINCT FROM ${at.e164Param} OR ${sealed}::text IS NOT NULL`;
  return {
    set: `,
       phone_sealed = CASE WHEN ${fresh} THEN ${sealed} ELSE phone_sealed END,
       phone_index = CASE WHEN ${fresh} THEN ${index} ELSE phone_index END,
       phone_index_kid = CASE WHEN ${fresh} THEN ${kid} ELSE phone_index_kid END`,
    params: [now?.sealed ?? null, now?.index ?? null, now?.indexKid ?? null],
  };
}

/**
 * For an UPDATE that wipes an account's number (deletion, a merge's retired
 * duplicate): the extra SET clauses (starting with a comma) that empty the
 * sealed columns by name. The trigger would empty them anyway; this says it
 * in the statement too. Nothing while the columns aren't in use.
 */
export function sealedPhoneCleared(env: Env = process.env): string {
  return sealedColumnsInUse(env) ? ", phone_sealed = NULL, phone_index = NULL, phone_index_kid = NULL" : "";
}

/**
 * The verified, not-deleted account that holds this number (however it is
 * written), or null. With PII_READS=sealed it is found by its index, under
 * any listed index key; with no index key nobody is found.
 */
export async function findVerifiedByPhone(db: Db, phone: string, env: Env = process.env): Promise<number | null> {
  const e164 = toE164(phone);
  if (!e164) return null;
  if (piiReads(env) === "sealed") {
    const indexes = phoneSealing(env).indexes(e164);
    if (!indexes.length) return null;
    const { rows } = await db.query(
      `SELECT id FROM players WHERE phone_index = ANY($1::text[]) AND phone_verified_at IS NOT NULL AND deleted_at IS NULL ORDER BY id LIMIT 1`,
      [indexes],
    );
    return rows[0] ? Number(rows[0].id) : null;
  }
  const { rows } = await db.query(`SELECT id FROM players WHERE phone_e164 = $1 AND phone_verified_at IS NOT NULL AND deleted_at IS NULL`, [e164]);
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Records that this person proved the number is theirs. "taken" when another
 * verified, live account holds it: by the plain column's unique index, by
 * the index column's, and (during a key rotation, when the same number has
 * a different index under each key) by a check against every listed key's.
 */
export async function verifyPhone(db: Db, playerId: number, e164: string, env: Env = process.env): Promise<"ok" | "taken"> {
  const params: unknown[] = [playerId, e164];
  const sealed = sealedPhoneUpdate(playerId, e164, { e164Param: "$2", firstParam: params.length + 1 }, env);
  params.push(...sealed.params);
  // Only where the index column is in use: on a database without it this is the statement the app always ran.
  const indexes = sealedColumnsInUse(env) ? phoneSealing(env).indexes(e164) : [];
  let free = "";
  if (indexes.length) {
    params.push(indexes);
    free = ` AND NOT EXISTS (
         SELECT 1 FROM players o
         WHERE o.id <> $1 AND o.phone_index = ANY($${params.length}::text[]) AND o.phone_verified_at IS NOT NULL AND o.deleted_at IS NULL)`;
  }
  try {
    const { rows } = await db.query(
      `UPDATE players SET phone_e164 = $2, phone_verified_at = NOW(), phone = coalesce(phone, $2)${sealed.set}
       WHERE id = $1${free}
       RETURNING id`,
      params,
    );
    if (rows.length || !free) return "ok";
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return "taken";
    throw err;
  }
  // Nothing was written: the number is someone else's, or (as before this change) there is no such account.
  const { rows } = await db.query(`SELECT 1 FROM players WHERE id = $1`, [playerId]);
  return rows.length ? "taken" : "ok";
}

async function sealRow(db: Db, sealing: PhoneSealing, playerId: number, e164: string): Promise<boolean> {
  const now = sealing.seal(playerId, e164);
  // Only if the row still holds this number and nothing sealed it meanwhile.
  const { rows } = await db.query(
    `UPDATE players SET phone_sealed = $3, phone_index = $4, phone_index_kid = $5
     WHERE id = $1 AND phone_e164 = $2 AND phone_sealed IS NULL RETURNING id`,
    [playerId, e164, now.sealed, now.index, now.indexKid],
  );
  return rows.length > 0;
}

/**
 * Seals the plain number a row already holds, if it has one and it isn't
 * sealed yet. For a row whose id wasn't known before it was written (a new
 * account) or that was just given another row's number (a merge: the sealed
 * text is bound to the person, so it is sealed anew, never copied). Returns
 * whether it sealed anything.
 */
export async function sealStoredPhone(db: Db, playerId: number, env: Env = process.env): Promise<boolean> {
  const sealing = phoneSealing(env);
  if (!sealing.available()) return false;
  const { rows } = await db.query(`SELECT phone_e164 FROM players WHERE id = $1 AND phone_e164 IS NOT NULL AND phone_sealed IS NULL`, [playerId]);
  const e164 = rows[0]?.phone_e164;
  return typeof e164 === "string" ? sealRow(db, sealing, playerId, e164) : false;
}

export type BackfillResult = { pending: number; sealed: number; failed: number };

/**
 * Seals every number written before the keys existed: rows with a plain
 * number and no sealed copy, in batches, oldest id first. Without `apply` it
 * only counts. It can be stopped and run again: a sealed row is never
 * touched, so a second run changes nothing. `log` gets counts and row ids
 * only, never a number, a sealed text or an index.
 */
export async function backfillPhones(db: Db, opts: { apply: boolean; batch?: number; env?: Env; log?: (line: string) => void }): Promise<BackfillResult> {
  const { apply, batch = 200, env = process.env, log = () => {} } = opts;
  if (!Number.isSafeInteger(batch) || batch < 1) throw new Error("The batch size must be a whole number above 0.");
  const sealing = phoneSealing(env);
  if (apply && !sealing.available()) throw new SealError("CONTACT_KEKS and CONTACT_INDEX_KEYS must both be set to seal phone numbers.", "unavailable");
  const pending = Number((await db.query(`SELECT count(*)::int AS n FROM players WHERE phone_e164 IS NOT NULL AND phone_sealed IS NULL`)).rows[0].n);
  log(`${pending} account(s) have a phone number that isn't sealed yet.`);
  const result: BackfillResult = { pending, sealed: 0, failed: 0 };
  if (!apply) return result;
  let after = 0;
  for (;;) {
    const { rows } = await db.query(`SELECT id, phone_e164 FROM players WHERE phone_e164 IS NOT NULL AND phone_sealed IS NULL AND id > $1 ORDER BY id LIMIT $2`, [after, batch]);
    if (!rows.length) break;
    for (const row of rows) {
      const id = Number(row.id);
      after = id;
      try {
        if (await sealRow(db, sealing, id, String(row.phone_e164))) result.sealed++;
      } catch (err) {
        // A row the database refuses (its error has a five-character code) is
        // counted and the rest carry on; anything else (a lost connection, a
        // key problem) stops the run. Said without the number: the code and
        // the row's id only.
        const code = (err as { code?: unknown }).code;
        if (err instanceof SealError || typeof code !== "string" || !/^[0-9A-Z]{5}$/.test(code)) throw err;
        result.failed++;
        log(`Account ${id} could not be sealed (database error ${code}).`);
      }
    }
    log(`Sealed ${result.sealed} of ${pending} so far.`);
  }
  log(`Done: ${result.sealed} sealed, ${result.failed} failed.`);
  return result;
}
