// One player's "count, then insert" at a time (encryption plan Task 8).
//
// A daily cap ("ten posts a day", "five active listings") is a count and
// then an insert. Two requests from the same person on two server instances
// can both count nine and both insert. withPlayerLock() runs the pair in one
// transaction, behind a Postgres advisory lock that belongs to this player
// and this cap: the second request waits for the first to commit, then
// counts ten.
//
// The lock is taken with pg_advisory_xact_lock(int4, int4): the scope's hash
// and the player's id. It is let go by the COMMIT or ROLLBACK itself, so it
// can't be left held. Other players, and the same player's other caps, don't
// wait. (The pattern of lib/juniors/data-rights.ts: a client, BEGIN, the
// work, COMMIT or ROLLBACK, release.)
//
// `fn` gets the transaction's own client and must do all its reads and
// writes on it: a query sent anywhere else is outside the lock's transaction.
// It must not end the transaction itself (no COMMIT or ROLLBACK of its own).
// Keep the work short: the connection and the lock are held until it ends.
//
// Three things it will not do:
//
// - Say "done" for work that wasn't saved. If a statement fails and `fn`
//   catches the error and returns anyway, the transaction is already aborted
//   and Postgres answers COMMIT with a silent ROLLBACK. withPlayerLock reads
//   what the COMMIT did and throws unless it committed.
// - Nest. Never nest; do every capped write for a player inside one lock.
//   Each call takes its own connection, so a lock taken inside another's work
//   (the same cap, or caps a then b in one request and b then a in another)
//   is a deadlock Postgres can't see: the inner call waits on a lock whose
//   holder is waiting on the inner call. Calling withPlayerLock inside
//   another withPlayerLock's `fn` throws at once, before a connection is
//   taken, whichever player or scope it names.
// - Wait for ever. The transaction runs with lock_timeout (5 seconds unless
//   the caller says): a wait that long for the player's lock fails with a
//   clear error, and the connection goes back to the pool, instead of piling
//   up held connections behind a stuck request. lock_timeout is the
//   transaction's, so it ALSO applies to every statement inside `fn` that
//   waits on a lock (a row another transaction is updating, FOR UPDATE):
//   that statement fails with Postgres's own "lock timeout" error (55P03),
//   which `fn` should let through so the whole thing rolls back.

import { AsyncLocalStorage } from "node:async_hooks";

type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
// What the server says a statement did ("COMMIT", "ROLLBACK"…), as pg reports it.
type LockClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; command?: string }>; release(destroy?: Error | boolean): void };

/** A pool: `connect()` gives one connection, handed back with `release()` (with an error, the pool drops it instead). */
export type LockPool = { connect(): Promise<LockClient> };

export type PlayerLockOptions = {
  /** How long to wait for a lock (the player's, and any a statement in `fn` waits on), in milliseconds. Default 5000. */
  lockTimeoutMs?: number;
};

// pg_advisory_xact_lock(int4, int4): the id has to fit 32 signed bits.
const MAX_INT4 = 2_147_483_647;
// A name written in the code ("social.posts"), never something a person typed.
const SCOPE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
// Long enough for a queue of one person's honest requests, short enough that
// a stuck one doesn't hold connections.
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const MAX_LOCK_TIMEOUT_MS = 60_000;
// Postgres: "canceling statement due to lock timeout".
const LOCK_NOT_AVAILABLE = "55P03";

// Set while a withPlayerLock's `fn` runs, for everything `fn` calls and awaits.
const inside = new AsyncLocalStorage<{ running: boolean }>();

/**
 * Run `fn` in a transaction that holds this player's lock for `scope`.
 * Commits when `fn` returns; rolls back and rethrows when it throws. Throws
 * when the commit didn't commit, when called inside another withPlayerLock,
 * and when the lock can't be had within the timeout. The connection always
 * goes back to the pool.
 */
export async function withPlayerLock<T>(pool: LockPool, playerId: number, scope: string, fn: (tx: Db) => Promise<T>, opts: PlayerLockOptions = {}): Promise<T> {
  if (typeof playerId !== "number" || !Number.isSafeInteger(playerId) || playerId < 1 || playerId > MAX_INT4) {
    throw new Error("withPlayerLock: the player id must be a positive whole number that fits 32 bits.");
  }
  if (typeof scope !== "string" || scope.length > 64 || !SCOPE.test(scope)) {
    throw new Error('withPlayerLock: the scope must be a plain name from the code, like "social.posts".');
  }
  const lockTimeoutMs = opts?.lockTimeoutMs === undefined ? DEFAULT_LOCK_TIMEOUT_MS : opts.lockTimeoutMs;
  // It goes into the statement's text (SET takes no parameters): a whole number, nothing else.
  if (typeof lockTimeoutMs !== "number" || !Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 1 || lockTimeoutMs > MAX_LOCK_TIMEOUT_MS) {
    throw new Error(`withPlayerLock: the lock timeout must be a whole number of milliseconds from 1 to ${MAX_LOCK_TIMEOUT_MS}.`);
  }
  if (inside.getStore()?.running) {
    throw new Error("withPlayerLock: locks must not be nested. This was called inside another withPlayerLock's work, which can wait on itself for ever; do every capped write for a player inside one lock.");
  }
  const client = await pool.connect();
  // Set when the connection itself can't be trusted any more: the pool then drops it.
  let broken: Error | undefined;
  const mark = { running: true };
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), $2::int4)", [scope, playerId]);
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code !== LOCK_NOT_AVAILABLE) throw e;
      throw new Error(`withPlayerLock: gave up after ${lockTimeoutMs} ms waiting for this player's "${scope}" lock. Another request of theirs is still holding it; nothing was written.`, { cause: e });
    }
    const result = await inside.run(mark, () => fn(client));
    const committed = await client.query("COMMIT");
    // An aborted transaction (a statement failed and `fn` carried on) answers
    // COMMIT with ROLLBACK, and no error.
    if (committed?.command !== "COMMIT") {
      throw new Error(`withPlayerLock: nothing was saved. The transaction didn't commit (the database answered ${committed?.command ? `"${committed.command}"` : "without saying what it did"}): a statement failed inside the work and the work carried on.`);
    }
    return result;
  } catch (e) {
    // Also after a failed BEGIN or COMMIT: harmless when no transaction is
    // open, and it never leaves one open on a connection going back to the pool.
    await client.query("ROLLBACK").catch((rollbackError: unknown) => {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    });
    throw e;
  } finally {
    // Work that `fn` started and didn't wait for is no longer "inside".
    mark.running = false;
    if (broken) client.release(broken);
    else client.release();
  }
}
