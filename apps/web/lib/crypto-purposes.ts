// Every sealed column, and how its rows are brought to a new key.
//
// PURPOSES lists each column that holds sealed text ("v1.<key id>.…",
// @luvallplay/crypto): which key list seals it, how a row is found, and what
// its sealed text is bound to. reseal() uses the list after a key rotation
// (scripts/crypto/reseal.mjs is its command line; packages/crypto/README.md
// has the steps): it opens each row sealed with an older key and seals it
// again with the first key listed, bound to the same things, so the row opens
// exactly where it opened before.
//
// A NEW SEALED COLUMN ADDS ITS ENTRY HERE in the change that creates it.
// Otherwise its rows are never re-sealed, and removing an old key makes them
// unreadable for good.
//
// Rules of reseal():
// - Without `apply` it only counts rows per key id and writes nothing.
// - Each batch (100 rows) is one transaction. Stopped at any point, every row
//   is either as it was or fully re-sealed, and both open: the old key stays
//   listed until a later run reports nothing left on it. Running it again
//   continues where it stopped.
// - A row is written only if its sealed text is still what was read
//   (UPDATE … WHERE <key> AND <column> = <old>): when the app wrote the row
//   meanwhile, the app's write wins, and it is already on the current key.
// - Only the sealed column changes (and, for a phone number, its index).
//   Nothing is cleared, and a row that can't be opened is left exactly as it
//   was, counted, and named by its key.
// - It says counts, key ids and row keys only: never the plain text, a sealed
//   text, an index or a key.
// - Before the first write, the keys held HERE are proven to be the servers'
//   own: a row already on the current key id (sealed by a server) must open
//   with this shell's key, and a phone number already on the current index
//   key must give the same index. A shell with the right key id and other key
//   BYTES would otherwise re-seal everything under a key no server has, and
//   its own "does it open?" check would pass. If rows are on the current key
//   and none can be confirmed, the run is refused whole. If no row is on it
//   yet, the run is refused unless `firstUseOfKey` says the key was checked
//   against the deployed value by hand.
// - A club-owned table (forced row-level security) is handled one club at a
//   time, with the club named for each transaction (app.tenant_id), which is
//   the only way the app's database role sees its rows at all.
import { createSeal, parseKeks, SealError, sealedWith, type Binding } from "@luvallplay/crypto";
import { evidenceBinding, reportBinding } from "./moderation/seal.ts";
import { KeyNotConfirmedError, phoneBinding, phoneSealing } from "./pii/contact.ts";

export { KeyNotConfirmedError };

type Row = Record<string, unknown>;
type Env = Record<string, string | undefined>;

export type Purpose = {
  /** Its name: `--purpose <name>` on the command line. */
  purpose: string;
  /** The environment variable that holds its key list. */
  env: string;
  table: string;
  /** The column that holds the sealed text. */
  column: string;
  /** The columns that name one row (its primary key), in order. All whole numbers. For a club-owned table the first is tenant_id. */
  keyColumns: readonly string[];
  /** One row, as a WHERE clause over `keyColumns` with parameters from $1. */
  key: (row: Row) => { where: string; params: unknown[] };
  /** What the row's sealed text is bound to: exactly what the app seals it with. */
  binding: (row: Row) => Binding;
  /** Columns the binding is made of that aren't in the key. */
  bindingColumns?: readonly string[];
  /** For a club-owned table: the row's club. Its rows are then read and written one club at a time. */
  tenant?: (row: Row) => number;
  /** The module the column belongs to, when it has one. */
  module?: string;
  /**
   * Columns computed from the same plain text and kept in step with the
   * sealed one (a phone number's index). `read` names what else is read;
   * `ready` throws when they can't be computed here; `problem` says why a row
   * must be left alone (in words that hold nothing of the row), or null; `set`
   * gives their new values, written by the same UPDATE as the sealed text;
   * `canary` is how their own key is confirmed before anything is written
   * (null with no key).
   */
  beside?: {
    read: readonly string[];
    ready: (env: Env) => void;
    problem: (row: Row, plaintext: string) => string | null;
    set: (plaintext: string, env: Env) => Record<string, string>;
    canary: (env: Env) => Canary | null;
  };
};

/**
 * How one key held here is confirmed against rows a server already wrote
 * with the key of the same id, before a run writes anything.
 */
type Canary = {
  /** The key list (its environment variable) and the key id to confirm: the first one listed. */
  env: string;
  kid: string;
  /** What the key did to those rows, for the message. */
  made: "sealed" | "indexed";
  /** Columns it reads beside the row's key. */
  read: readonly string[];
  /** SQL: the row is on the key id in this parameter. */
  on: (param: string) => string;
  /** Whether this row, already on that key id, agrees with the key held here. Never throws for a row that just doesn't. */
  confirms: (row: Row) => boolean;
};

const int = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("A row's key must be a positive whole number.");
  return n;
};
const byColumns = (columns: readonly string[]) => (row: Row) => ({
  where: columns.map((column, i) => `${column} = $${i + 1}`).join(" AND "),
  params: columns.map((column) => int(row[column])),
});

/**
 * While players.phone_e164 exists it is what the app reads, and the database
 * clears the sealed copy whenever it changes (trigger
 * players_phone_sealed_follows_plain). So a sealed number beside an empty or
 * different plain one should not exist; if one does, nobody can say which is
 * right, and it is left for a person to look at. (This check goes when the
 * plain columns do.)
 */
function phoneProblem(row: Row, e164: string): string | null {
  if (row.phone_e164 == null) return "it has a sealed number and no plain one";
  return row.phone_e164 === e164 ? null : "its sealed number is not its plain one";
}
function phoneReady(env: Env): void {
  if (!phoneSealing(env).available()) throw new SealError("CONTACT_KEKS and CONTACT_INDEX_KEYS must both be set.", "unavailable");
}
/** The index key held here is the servers' when a row they indexed with it gives the same index for its own (opened) number. */
function phoneIndexCanary(env: Env): Canary | null {
  const kid = parseKeks(env.CONTACT_INDEX_KEYS, "CONTACT_INDEX_KEYS")[0]?.id;
  if (!kid) return null;
  const sealing = phoneSealing(env);
  return {
    env: "CONTACT_INDEX_KEYS",
    kid,
    made: "indexed",
    read: ["phone_sealed", "phone_index"],
    on: (param) => `phone_index_kid = ${param}`,
    confirms: (row) => opens(() => sealing.currentIndex(sealing.open(int(row.id), String(row.phone_sealed))).index === row.phone_index),
  };
}

export const PURPOSES: readonly Purpose[] = [
  // The integrations vault (INTEGRATIONS_KEKS, lib/integrations/token-vault.ts,
  // bound to [tenantId, connector, connectionId]) has no table yet: nothing is
  // stored sealed with it. Its entry is added in the PR that creates the
  // connections table.
  {
    // A device's push address: lib/push/seal.ts.
    purpose: "push_devices.sealed",
    env: "PUSH_KEKS",
    table: "push_devices",
    column: "sealed",
    keyColumns: ["id"],
    key: byColumns(["id"]),
    binding: (row) => ["push", int(row.player_id), int(row.id)],
    bindingColumns: ["player_id"],
  },
  {
    // A child's medical note: lib/juniors/care.ts. No id: one row per child in a club.
    purpose: "junior_medical_notes.sealed",
    env: "JUNIORS_KEKS",
    table: "junior_medical_notes",
    column: "sealed",
    keyColumns: ["tenant_id", "junior_profile_id"],
    key: byColumns(["tenant_id", "junior_profile_id"]),
    binding: (row) => [int(row.tenant_id), "juniors.medical", `child:${int(row.junior_profile_id)}`],
    tenant: (row) => int(row.tenant_id),
    module: "juniors",
  },
  {
    // A player's phone number: lib/pii/contact.ts. Its index (phone_index,
    // under CONTACT_INDEX_KEYS) is brought to the current index key by the
    // same write.
    purpose: "players.phone_sealed",
    env: "CONTACT_KEKS",
    table: "players",
    column: "phone_sealed",
    keyColumns: ["id"],
    key: byColumns(["id"]),
    binding: (row) => phoneBinding(int(row.id)),
    beside: {
      read: ["phone_e164"],
      ready: phoneReady,
      problem: phoneProblem,
      set: (e164, env) => {
        const { index, indexKid } = phoneSealing(env).currentIndex(e164);
        return { phone_index: index, phone_index_kid: indexKid };
      },
      canary: phoneIndexCanary,
    },
  },
  // Reports to moderators: lib/moderation/seal.ts. Two columns under one key
  // list (MODERATION_KEKS); the first part of each binding keeps one from
  // opening as the other.
  {
    // What the reporter wrote.
    purpose: "content_reports.details_sealed",
    env: "MODERATION_KEKS",
    table: "content_reports",
    column: "details_sealed",
    keyColumns: ["id"],
    key: byColumns(["id"]),
    binding: (row) => reportBinding(int(row.id)),
  },
  {
    // The copy of the content kept for a child-safety report. The app's role
    // can't update this table; the run connects as the database's owner, as
    // every run does.
    purpose: "moderation_evidence.sealed",
    env: "MODERATION_KEKS",
    table: "moderation_evidence",
    column: "sealed",
    keyColumns: ["report_id"],
    key: byColumns(["report_id"]),
    binding: (row) => evidenceBinding(int(row.report_id)),
  },
];

/** Not a sealed column but rotated the same way: the phone index, when only CONTACT_INDEX_KEYS changes. */
const CONTACT_INDEX = "contact-index";
/** Everything `--purpose` accepts. */
export const RESEAL_PURPOSES: readonly string[] = [...PURPOSES.map((p) => p.purpose), CONTACT_INDEX];

// ── What one run works through ──────────────────────────────────────────────

/** Why one row was left alone. Its message holds nothing of the row. */
class RowProblem extends Error {}

type Job = {
  table: string;
  keyColumns: readonly string[];
  key: Purpose["key"];
  tenant?: Purpose["tenant"];
  /** The columns read beside the key. */
  read: readonly string[];
  /** SQL: the rows this is about at all. */
  present: string;
  /** The key id the rows should be on: the first key listed. Null with no key. */
  current: string | null;
  /** The key id a row is on now. */
  onKey: (row: Row) => string | null;
  /** SQL: the row isn't on the key id in this parameter. */
  stale: (param: string) => string;
  /** The columns that must still hold what was read for the write to happen. */
  guard: readonly string[];
  /** Throws unless everything needed to write is here. */
  ready: () => void;
  /** Each key this job writes with, to be confirmed against existing rows before the first write. */
  canaries: () => Canary[];
  /** The row's new values. Throws SealError or RowProblem for a row to leave alone. */
  next: (row: Row) => Record<string, string>;
  /** What the rows are, and what is done to them, for the log. */
  words: { rows: string; done: string; verb: string };
};

function sealJob(p: Purpose, env: Env): Job {
  const keks = () => parseKeks(env[p.env], p.env);
  const envelope = createSeal({ purpose: p.env, keks });
  return {
    table: p.table,
    keyColumns: p.keyColumns,
    key: p.key,
    tenant: p.tenant,
    read: [p.column, ...(p.bindingColumns ?? []), ...(p.beside?.read ?? [])],
    present: `${p.column} IS NOT NULL`,
    // A malformed list throws here, before anything is read.
    current: keks()[0]?.id ?? null,
    onKey: (row) => sealedWith(String(row[p.column])),
    stale: (param) => `split_part(${p.column}, '.', 2) <> ${param}`,
    guard: [p.column],
    ready() {
      if (!keks().length) throw new SealError(`No encryption key is set (${p.env}), so nothing can be re-sealed.`, "unavailable");
      p.beside?.ready(env);
    },
    canaries() {
      const kid = keks()[0]?.id;
      const mine: Canary[] = kid
        ? [{ env: p.env, kid, made: "sealed", read: [], on: (param) => `split_part(${p.column}, '.', 2) = ${param}`, confirms: (row) => opens(() => (envelope.open(p.binding(row), String(row[p.column])), true)) }]
        : [];
      const beside = p.beside?.canary(env);
      return beside ? [...mine, beside] : mine;
    },
    next(row) {
      const binding = p.binding(row);
      const plaintext = envelope.open(binding, String(row[p.column]));
      const problem = p.beside?.problem(row, plaintext);
      if (problem) throw new RowProblem(problem);
      const sealed = envelope.seal(binding, plaintext);
      // Proven to open, to the same text, before it replaces the old one.
      if (envelope.open(binding, sealed) !== plaintext) throw new Error("A re-sealed text did not open to what was sealed. Nothing was written for it.");
      return { [p.column]: sealed, ...p.beside?.set(plaintext, env) };
    },
    words: { rows: "sealed row(s)", done: "re-sealed", verb: "re-seal" },
  };
}

/**
 * The phone index alone: rows whose phone_index_kid isn't the first key of
 * CONTACT_INDEX_KEYS get the number's index under that key. The number comes
 * from the row's own sealed copy (which is not re-sealed), so this needs
 * CONTACT_KEKS too. Lookups match every listed index key meanwhile; the old
 * index key may be removed only once a run reports nothing left on it.
 */
function contactIndexJob(env: Env): Job {
  const sealing = phoneSealing(env);
  return {
    table: "players",
    keyColumns: ["id"],
    key: byColumns(["id"]),
    read: ["phone_sealed", "phone_index_kid", "phone_e164"],
    present: "phone_sealed IS NOT NULL",
    current: parseKeks(env.CONTACT_INDEX_KEYS, "CONTACT_INDEX_KEYS")[0]?.id ?? null,
    onKey: (row) => (typeof row.phone_index_kid === "string" ? row.phone_index_kid : null),
    stale: (param) => `phone_index_kid IS DISTINCT FROM ${param}`,
    guard: ["phone_sealed", "phone_index_kid"],
    ready: () => phoneReady(env),
    canaries() {
      const canary = phoneIndexCanary(env);
      return canary ? [canary] : [];
    },
    next(row) {
      const e164 = sealing.open(int(row.id), String(row.phone_sealed));
      const problem = phoneProblem(row, e164);
      if (problem) throw new RowProblem(problem);
      const { index, indexKid } = sealing.currentIndex(e164);
      return { phone_index: index, phone_index_kid: indexKid };
    },
    words: { rows: "sealed phone number(s)", done: "re-indexed", verb: "re-index" },
  };
}

// ── The run ─────────────────────────────────────────────────────────────────

/** ONE database connection (a client, not a pool): each batch is a transaction on it. */
export type ResealDb = { query: (text: string, params?: unknown[]) => Promise<{ rows: Row[] }> };

export type ResealResult = {
  purpose: string;
  /** The key id rows are brought to (the first key listed), or null with no key. */
  current: string | null;
  /** How many rows were on each key id when the run began. */
  byKey: Record<string, number>;
  /** How many of them were not on the current key. */
  todo: number;
  /** How many this run brought to the current key. */
  done: number;
  /** Rows the app wrote while the run was at them: left as the app wrote them. */
  skipped: number;
  /** Rows that could not be opened, or that the database refused: left exactly as they were. */
  problems: number;
};

export type ResealOptions = {
  purpose: string;
  /** False: count only. True: write. */
  apply: boolean;
  /** Rows per transaction. */
  batch?: number;
  /**
   * `--first-use-of-key`. No row is on the current key id yet, so nothing in
   * the database can confirm that the key held here is the servers'. True
   * says the operator checked it against the deployed value. It never lets a
   * run through when rows ARE on the key and can't be confirmed with it.
   */
  firstUseOfKey?: boolean;
  env?: Env;
  /** Gets counts, key ids and row keys. Never plain text, sealed text, an index or a key. */
  log?: (line: string) => void;
  /**
   * Called inside each batch's transaction once its rows are read ("read"),
   * and after each batch is committed ("committed"). If it throws, the run
   * stops there. For tests: it is how a run is interrupted.
   */
  onStep?: (step: "read" | "committed") => void | Promise<void>;
};

const NO_KEY = "(none)";
/** How many rows already on the current key are tried before the key held here is called a different one. */
const CANARY_ROWS = 20;
const isDatabaseRefusal = (err: unknown): err is { code: string } => /^[0-9A-Z]{5}$/.test(String((err as { code?: unknown } | null)?.code ?? ""));
/** A row that can't be opened: a key that isn't listed, a wrong binding or changed text, or not sealed text at all. */
const isRowProblem = (err: unknown): boolean => err instanceof RowProblem || (err instanceof SealError && ["unknown_key", "unopenable", "format"].includes(err.code));
/** True or false from `check`; false too when the row can't be opened here. Anything else (a malformed key list) is thrown. */
function opens(check: () => boolean): boolean {
  try {
    return check();
  } catch (err) {
    if (!isRowProblem(err)) throw err;
    return false;
  }
}
const reasonOf = (err: unknown): string => {
  if (err instanceof RowProblem) return err.message;
  const code = (err as SealError).code;
  if (code === "unknown_key") return "the key it was sealed with isn't listed";
  return code === "format" ? "it isn't in the sealed format" : "it can't be opened (changed, or sealed for another row)";
};

/**
 * Counts the rows of one purpose per key id and, with `apply`, brings those
 * not on the current key to it. Safe to stop and to run again (the rules are
 * at the top of this file). Throws before reading anything on an unknown
 * purpose or a malformed key list, and before writing anything when a key
 * that is needed isn't set, or when a key held here can't be confirmed
 * against rows already on its id (KeyNotConfirmedError).
 */
export async function reseal(db: ResealDb, opts: ResealOptions): Promise<ResealResult> {
  const { purpose, apply, batch = 100, firstUseOfKey = false, env = process.env, log = () => {}, onStep = () => {} } = opts;
  if (!Number.isSafeInteger(batch) || batch < 1) throw new Error("The batch size must be a whole number above 0.");
  const entry = PURPOSES.find((p) => p.purpose === purpose);
  if (!entry && purpose !== CONTACT_INDEX) throw new Error(`"${purpose}" is not a purpose. Known: ${RESEAL_PURPOSES.join(", ")}.`);
  const job = entry ? sealJob(entry, env) : contactIndexJob(env);
  if (job.tenant && job.keyColumns[0] !== "tenant_id") throw new Error(`${job.table}: a club-owned table's key starts with tenant_id.`);
  if (apply) job.ready();

  // Said first, before anything is read: the key every row is brought to is
  // the first one listed in THIS environment. The operator compares it with
  // the first key of the list the servers run with; a list in the wrong order
  // here would bring everything back to the old key.
  log(`current key: ${job.current ?? NO_KEY}`);

  const nameOf = (row: Row) => `${job.table} ${job.keyColumns.map((k) => `${k}=${int(row[k])}`).join(" ")}`;
  const canaries = apply ? job.canaries() : [];
  const columns = [...new Set([...job.keyColumns, ...job.read, ...canaries.flatMap((canary) => canary.read)])].join(", ");
  const keyList = job.keyColumns.join(", ");

  /** One transaction; for a club-owned table, the club's. */
  const transaction = async <T>(tenantId: number | null, work: () => Promise<T>): Promise<T> => {
    await db.query("BEGIN");
    try {
      // `true`: for this transaction only, so it can't leak to whoever uses the connection next.
      if (tenantId !== null) await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantId)]);
      const out = await work();
      await db.query("COMMIT");
      return out;
    } catch (err) {
      await db.query("ROLLBACK").catch(() => {});
      throw err;
    }
  };
  /** The next rows in key order after `after`, for one club or for the whole table. */
  const page = async (tenantId: number | null, after: number[] | null, limit: number, extra?: { sql: (param: string) => string; value: unknown }) => {
    const where = [job.present];
    const params: unknown[] = [];
    const param = (value: unknown) => `$${params.push(value)}`;
    if (tenantId !== null) where.push(`tenant_id = ${param(tenantId)}`);
    if (after) where.push(`(${keyList}) > (${after.map(param).join(", ")})`);
    if (extra) where.push(extra.sql(param(extra.value)));
    return (await db.query(`SELECT ${columns} FROM ${job.table} WHERE ${where.join(" AND ")} ORDER BY ${keyList} LIMIT ${param(limit)}`, params)).rows;
  };
  const keyOf = (row: Row) => job.keyColumns.map((k) => int(row[k]));

  // One club at a time for a club-owned table (tenants itself is not club-owned: every role reads it).
  const scopes: (number | null)[] = job.tenant ? (await db.query(`SELECT id FROM tenants ORDER BY id`)).rows.map((r) => int(r.id)) : [null];

  // 1. Count per key id.
  const byKey: Record<string, number> = {};
  for (const tenantId of scopes) {
    let after: number[] | null = null;
    for (;;) {
      const rows: Row[] = await transaction(tenantId, () => page(tenantId, after, 500));
      for (const row of rows) {
        const kid = job.onKey(row) ?? NO_KEY;
        byKey[kid] = (byKey[kid] ?? 0) + 1;
      }
      if (rows.length < 500) break;
      after = keyOf(rows[rows.length - 1]);
    }
  }
  const total = Object.values(byKey).reduce((a, b) => a + b, 0);
  const todo = total - (job.current ? (byKey[job.current] ?? 0) : 0);
  const result: ResealResult = { purpose, current: job.current, byKey, todo, done: 0, skipped: 0, problems: 0 };
  log(`${purpose}: ${total} ${job.words.rows}.`);
  for (const kid of Object.keys(byKey).sort()) log(`  key ${kid}: ${byKey[kid]}${kid === job.current ? " (the current key)" : ""}`);
  if (!job.current) {
    log(`No key is set here for this purpose, so this only counted.`);
    return result;
  }
  log(`${todo} to ${job.words.verb} onto key ${job.current}.`);
  if (!apply) return result;

  // 2. Before any write: each key held here is confirmed against rows the
  // servers already wrote with it. A row in any club is enough.
  for (const canary of canaries) {
    let tried = 0;
    let confirmed = false;
    for (const tenantId of scopes) {
      if (confirmed || tried >= CANARY_ROWS) break;
      const rows: Row[] = await transaction(tenantId, () => page(tenantId, null, CANARY_ROWS - tried, { sql: canary.on, value: canary.kid }));
      for (const row of rows) {
        if (job.tenant && job.tenant(row) !== tenantId) continue;
        tried++;
        confirmed = canary.confirms(row);
        if (confirmed) break;
      }
    }
    if (confirmed) continue;
    if (tried) {
      throw new KeyNotConfirmedError(
        `${canary.env}: the key "${canary.kid}" in this shell differs from the one that ${canary.made} the existing rows on "${canary.kid}" (none of the ${tried} tried agrees with it). Nothing was written. Compare this shell's list with the deployed value.`,
      );
    }
    if (!firstUseOfKey) {
      throw new KeyNotConfirmedError(
        `${canary.env}: no row is on key "${canary.kid}" yet, so nothing confirms that the key in this shell is the servers'. Nothing was written. Let the servers ${canary.made === "sealed" ? "seal" : "index"} at least one row with the new key first, or check the key against the deployed value and add --first-use-of-key.`,
      );
    }
    log(`No row is on key ${canary.kid} (${canary.env}) yet: nothing in the database confirmed it (--first-use-of-key).`);
  }

  // 3. Bring the rest to the current key, a batch per transaction.
  for (const tenantId of scopes) {
    let after: number[] | null = null;
    for (;;) {
      const tally = { read: 0, done: 0, skipped: 0, problems: 0 };
      const notes: string[] = [];
      let last: number[] | null = after;
      await transaction(tenantId, async () => {
        const rows = await page(tenantId, after, batch, { sql: job.stale, value: job.current });
        tally.read = rows.length;
        await onStep("read");
        for (const row of rows) {
          last = keyOf(row);
          let set: Record<string, string>;
          try {
            if (job.tenant && job.tenant(row) !== tenantId) throw new RowProblem("it is not this club's row");
            set = job.next(row);
          } catch (err) {
            if (!isRowProblem(err)) throw err;
            tally.problems++;
            notes.push(`Left as it was: ${nameOf(row)}: ${reasonOf(err)}.`);
            continue;
          }
          const { where, params } = job.key(row);
          const param = (value: unknown) => `$${params.push(value)}`;
          const assignments = Object.entries(set).map(([column, value]) => `${column} = ${param(value)}`);
          const unchanged = job.guard.map((column) => `${column} IS NOT DISTINCT FROM ${param(row[column])}`);
          // A row the database refuses (its error has a five-character code)
          // is counted and the batch carries on; the savepoint keeps the
          // batch's transaction usable.
          await db.query("SAVEPOINT one_row");
          try {
            const written = await db.query(`UPDATE ${job.table} SET ${assignments.join(", ")} WHERE ${where} AND ${unchanged.join(" AND ")} RETURNING 1`, params);
            await db.query("RELEASE SAVEPOINT one_row");
            if (written.rows.length) tally.done++;
            else tally.skipped++;
          } catch (err) {
            if (!isDatabaseRefusal(err)) throw err;
            await db.query("ROLLBACK TO SAVEPOINT one_row");
            tally.problems++;
            notes.push(`Left as it was: ${nameOf(row)}: the database refused it (error ${err.code}).`);
          }
        }
      });
      // Counted and said only once the batch is committed.
      result.done += tally.done;
      result.skipped += tally.skipped;
      result.problems += tally.problems;
      for (const note of notes) log(note);
      if (tally.read) log(`${result.done} of ${todo} ${job.words.done} so far.`);
      await onStep("committed");
      if (tally.read < batch) break;
      after = last;
    }
  }
  log(`Done: ${result.done} ${job.words.done}, ${result.skipped} changed meanwhile and left as written, ${result.problems} with a problem and left as they were.`);
  return result;
}
