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
// Keep the work short: the connection and the lock are held until it ends.

type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** A pool: `connect()` gives one connection, handed back with `release()` (with an error, the pool drops it instead). */
export type LockPool = { connect(): Promise<Db & { release(destroy?: Error | boolean): void }> };

// pg_advisory_xact_lock(int4, int4): the id has to fit 32 signed bits.
const MAX_INT4 = 2_147_483_647;
// A name written in the code ("social.posts"), never something a person typed.
const SCOPE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

/**
 * Run `fn` in a transaction that holds this player's lock for `scope`.
 * Commits when `fn` returns; rolls back and rethrows when it throws. The
 * connection always goes back to the pool.
 */
export async function withPlayerLock<T>(pool: LockPool, playerId: number, scope: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  if (typeof playerId !== "number" || !Number.isSafeInteger(playerId) || playerId < 1 || playerId > MAX_INT4) {
    throw new Error("withPlayerLock: the player id must be a positive whole number that fits 32 bits.");
  }
  if (typeof scope !== "string" || scope.length > 64 || !SCOPE.test(scope)) {
    throw new Error('withPlayerLock: the scope must be a plain name from the code, like "social.posts".');
  }
  const client = await pool.connect();
  // Set when the connection itself can't be trusted any more: the pool then drops it.
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), $2::int4)", [scope, playerId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    // Also after a failed BEGIN or COMMIT: harmless when no transaction is
    // open, and it never leaves one open on a connection going back to the pool.
    await client.query("ROLLBACK").catch((rollbackError: unknown) => {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    });
    throw e;
  } finally {
    if (broken) client.release(broken);
    else client.release();
  }
}
