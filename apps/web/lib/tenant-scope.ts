// Running queries as the app's role, for one club (build plan §6.1; Phase 3
// steps 10 and 11).
//
// The database's row-level security lets the role luvallplay_app see and
// write a row only when its tenant_id is the club named in the transaction
// setting app.tenant_id (migration 0007). This file wraps a connection so
// that every statement runs that way:
//
//   BEGIN
//   SELECT set_config('role', 'luvallplay_app', true),      -- = SET LOCAL ROLE
//          set_config('app.tenant_id', '<club id>', true)   -- true: this transaction only
//   …the statement(s)…
//   COMMIT
//
// The role and the club are set by ONE statement, and for a statement
// outside a transaction that statement travels with the BEGIN: three round
// trips to the database (setup, the statement, COMMIT), where there were
// five. On a pool of ten with a page firing nine queries at once, the two
// saved round trips per query are what `enforce` costs (audit, Medium).
//
// Both settings are transaction-local on purpose. The pooled endpoint hands
// a server connection to someone else after every transaction, so anything
// set for the session could leak to the next request; a transaction-local
// setting can't.
//
// No I/O of its own and no driver: it wraps anything with query(), so it
// works on the Neon driver and on node-postgres alike.

export const APP_ROLE = "luvallplay_app";

/**
 * The one statement that makes the current transaction the app's role's,
 * for one club (or, with null, for no club: nothing club-owned is visible).
 * The id is written into the text so the statement can share a message with
 * BEGIN (a message with parameters can hold only one statement); it is
 * checked to be a whole number first, and nothing else is ever put there.
 */
export function scopeStatement(tenantId: number | null): string {
  const role = `set_config('role', '${APP_ROLE}', true)`;
  if (tenantId === null) return `SELECT ${role}`;
  if (!Number.isInteger(tenantId) || tenantId < 0) throw new Error(`"${String(tenantId)}" is not a club id`);
  return `SELECT ${role}, set_config('app.tenant_id', '${tenantId}', true)`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export type Queryable = { query: (...args: Any[]) => Promise<Any> };
export type PoolLike = Queryable & { connect: () => Promise<Queryable & { release: (...args: Any[]) => void }> };

/** The SQL text of a query() call, whichever way it was passed. */
export function textOf(args: unknown[]): string {
  const first = args[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && typeof (first as { text?: unknown }).text === "string") return (first as { text: string }).text;
  return "";
}

/** Whether a statement opens or closes a transaction. (ROLLBACK TO SAVEPOINT does neither.) */
export function transactionVerb(text: string): "begin" | "end" | null {
  const t = text.trimStart().toLowerCase();
  if (/^(begin|start\s+transaction)\b/.test(t)) return "begin";
  if (/^rollback\s+to\b/.test(t)) return null;
  if (/^(commit|end|rollback|abort)\b/.test(t)) return "end";
  return null;
}

/**
 * A statement that only reads, as far as its text can tell: it starts with
 * SELECT or WITH and names nothing that writes, locks or changes a setting.
 * Used to pick statements that are safe to run a second time (shadow reads);
 * the second run is in a READ ONLY transaction as well.
 */
export function isReadOnlyStatement(text: string): boolean {
  const t = text.trim();
  if (!/^(select|with)\b/i.test(t)) return false;
  if (t.replace(/;\s*$/, "").includes(";")) return false;
  return !/\b(insert|update|delete|merge|truncate|create|alter|drop|grant|nextval|setval|set_config|pg_advisory\w*|pg_notify|lo_\w+|for\s+(update|share|no\s+key|key\s+share))\b/i.test(t);
}

/**
 * Wraps one connection so every statement runs as the app's role for
 * `tenantId`. A transaction the caller opens itself (query("BEGIN") …
 * query("COMMIT")) gets the role and the club right after its BEGIN; a
 * statement outside one gets a transaction of its own.
 */
export function scopeClient<T extends Queryable>(client: T, tenantId: number): T {
  let inTransaction = false;
  const raw = (...args: unknown[]) => client.query(...args);
  // Built (and the id checked) before anything is sent.
  const scope = scopeStatement(tenantId);
  const query = async (...args: unknown[]) => {
    const verb = transactionVerb(textOf(args));
    if (verb === "begin") {
      // The caller's BEGIN goes as it was written (it may carry an isolation
      // level); the role and the club follow in one statement.
      const result = await raw(...args);
      inTransaction = true;
      await raw(scope);
      return result;
    }
    if (verb === "end") {
      inTransaction = false;
      return raw(...args);
    }
    if (inTransaction) return raw(...args);
    try {
      // One message: open the transaction and step down for the club.
      await raw(`BEGIN; ${scope}`);
      const result = await raw(...args);
      await raw("COMMIT");
      return result;
    } catch (err) {
      await raw("ROLLBACK").catch(() => {});
      throw err;
    }
  };
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "query") return query;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Wraps a pool: query() borrows a connection for one scoped statement; connect() hands out a scoped connection. */
export function scopePool<T extends PoolLike>(pool: T, tenantId: () => Promise<number>): T {
  const query = async (...args: unknown[]) => {
    const id = await tenantId();
    const client = await pool.connect();
    try {
      return await scopeClient(client, id).query(...args);
    } finally {
      client.release();
    }
  };
  const connect = async () => scopeClient(await pool.connect(), await tenantId());
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === "query") return query;
      if (prop === "connect") return connect;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Runs one read as the app's role for `tenantId`, in a READ ONLY transaction
 * that is rolled back. For shadow reads: nothing it does can stay.
 */
export async function readScoped(pool: PoolLike, tenantId: number | null, text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
  const scope = scopeStatement(tenantId);
  const client = await pool.connect();
  try {
    await client.query(`BEGIN READ ONLY; ${scope}`);
    return await client.query(text, params);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

/**
 * Which of `tables` exist in the public schema, asked as the app's role with
 * no club named (the catalog is readable by every role, so this works on the
 * owner's connection and on the app's own login alike). A deployment can be
 * ahead of its database for a while: a club-owned table whose migration
 * hasn't run yet isn't there to probe.
 */
export async function existingTables(pool: PoolLike, tables: readonly string[]): Promise<{ present: string[]; missing: string[] }> {
  const { rows } = await readScoped(pool, null, `SELECT t FROM unnest($1::text[]) AS t WHERE to_regclass('public.' || quote_ident(t)) IS NOT NULL`, [[...tables]]);
  const found = new Set(rows.map((r) => r.t as string));
  return { present: tables.filter((t) => found.has(t)), missing: tables.filter((t) => !found.has(t)) };
}

/**
 * The isolation probe (the daily shadow heartbeat, and verify.mjs): for
 * every club-owned table, the app's role must see exactly the club's rows
 * with the club named, and none with no club named. Returns what differs;
 * empty = clean. Read-only.
 *
 * `pool` must be the unscoped pool: the probe sets the role and the club
 * itself, and a pool that already names a club would hide a failure of the
 * "no club named" half.
 *
 * - A table that doesn't exist is reported as a difference. Callers that
 *   expect one (the heartbeat, between a deploy and its migration) take it
 *   out first with existingTables().
 * - `ownerReads: false` is for the app's own login (APP_DATABASE_URL), which
 *   can't count rows as the owner. There the probe checks what can be seen
 *   from inside: no row of another club with the club named, and none with
 *   no club named.
 */
export async function probeTenantIsolation(pool: PoolLike, tenantId: number, tables: readonly string[], { ownerReads = true }: { ownerReads?: boolean } = {}): Promise<string[]> {
  const id = Number(tenantId);
  if (!Number.isInteger(id)) throw new Error(`probeTenantIsolation: "${tenantId}" is not a club id`);
  const { present, missing } = await existingTables(pool, tables);
  const differences: string[] = missing.map((t) => `${t}: the table doesn't exist`);
  if (!present.length) return differences;
  const each = (select: (t: string) => string) => present.map(select).join(" UNION ALL ");
  const counts = each((t) => `SELECT '${t}' AS t, count(*)::int AS n, (count(*) FILTER (WHERE tenant_id <> ${id}))::int AS other FROM "${t}"`);
  const asMap = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [r.t as string, r as { n: number; other: number }]));
  const owner = ownerReads ? asMap((await pool.query(each((t) => `SELECT '${t}' AS t, count(*)::int AS n FROM "${t}" WHERE tenant_id = ${id}`))).rows) : null;
  const scoped = asMap((await readScoped(pool, id, counts)).rows);
  const closed = asMap((await readScoped(pool, null, counts)).rows);
  for (const t of present) {
    if (owner && scoped.get(t)?.n !== owner.get(t)?.n) differences.push(`${t}: the app's role sees ${scoped.get(t)?.n} rows, the club has ${owner.get(t)?.n}`);
    else if (scoped.get(t)?.other !== 0) differences.push(`${t}: the app's role sees ${scoped.get(t)?.other} rows of another club`);
    if (closed.get(t)?.n !== 0) differences.push(`${t}: ${closed.get(t)?.n} rows visible with no club named`);
  }
  return differences;
}
