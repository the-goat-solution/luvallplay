// The one database client (Phase 2: replaces @vercel/postgres).
//
// Two drivers behind one surface (build plan §6.9), chosen by
// DATABASE_DRIVER:
//
//   neon      (default) Neon's serverless driver (@neondatabase/serverless),
//             exactly as @vercel/postgres used it. For regions on Neon.
//   postgres  standard Postgres over TCP (lib/database-pg.ts). For regions on
//             plain managed Postgres (Hanoi). Every call goes to its pool.
//
// Any other value stops the app at its first query: a region must never
// guess which database it is talking to.
//
// The surface:
//
//   sql`SELECT … ${value}`      one query over HTTP (Neon "SQL over HTTP")
//   sql.query(text, params)     one query on the WebSocket pool
//   db.connect()                a pooled client for transactions and locks
//                               (always release() it)
//   orm                         Drizzle ORM on the same pool, typed by
//                               db/schema.ts, for repository functions
//
// The golden master tests (tests/golden-master.test.ts) run every
// repository function on the old driver and on this one, against the same
// data, and require identical results.
//
// Connection: POSTGRES_URL (set by lib/db-switch.ts from DATABASE_URL_VAR),
// read once at first use. lib/db-env.ts applies the switch and the preview
// guard on import, so this holds in middleware too.
// First: the DATABASE_URL_VAR switch and the preview guard, in every bundle
// that uses the database (middleware doesn't run instrumentation.ts).
import "./db-env.ts";
import { Pool, neon, types, type PoolClient, type QueryResult, type QueryResultRow } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as schema from "@luvallplay/db/schema";
import { createPgDatabase, type PgDatabase } from "./database-pg.ts";
import { defaultTenantSlug } from "./tenant-members.ts";
import { APP_ROLE, isReadOnlyStatement, readScoped, scopePool, textOf, type PoolLike, type Queryable } from "./tenant-scope.ts";

// Postgres DATE columns stay the 'YYYY-MM-DD' string Postgres sends. The
// driver's default turns them into a Date at local midnight, which shifts the
// day whenever the process's time zone isn't UTC (it breaks under
// Pacific/Auckland, the club's own). OID 1082 = date. (Was set in lib/db.ts.)
types.setTypeParser(1082, (val: string) => val);

type Primitive = string | number | boolean | bigint | null | undefined | Date;
// Rows are loosely typed by default, as with @vercel/postgres: callers cast
// the columns they read. Repository functions use the typed `orm()` instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

/**
 * The app's own login (runbook §11.2), when it has one: a role that is not
 * the database owner and can do nothing until it steps down to the app's
 * role. APP_DATABASE_URL holds its connection string; POSTGRES_URL stays the
 * owner's, for migrations and operator scripts, which the app then never uses.
 */
export function appLogin(): string | null {
  const v = process.env.APP_DATABASE_URL?.trim();
  return v && v !== "undefined" ? v : null;
}

function connectionString(): string {
  const url = appLogin() ?? process.env.POSTGRES_URL;
  if (!url || url === "undefined") {
    throw new Error(
      process.env.PREVIEW_DATABASE_BLOCKED
        ? `Database switched off on this preview: ${process.env.PREVIEW_DATABASE_BLOCKED}`
        : "No database: POSTGRES_URL is not set.",
    );
  }
  return url;
}

export type DatabaseDriver = "neon" | "postgres";

/** The driver this deployment uses. Throws on a value it doesn't know (fail closed). */
export function databaseDriver(): DatabaseDriver {
  const v = process.env.DATABASE_DRIVER?.trim().toLowerCase();
  if (!v || v === "neon") return "neon";
  if (v === "postgres" || v === "pg") return "postgres";
  throw new Error(`DATABASE_DRIVER is "${process.env.DATABASE_DRIVER}": expected "neon" or "postgres".`);
}

// The standard-Postgres client, created at first use when that driver is chosen.
let pgDatabase: PgDatabase | null = null;
function viaPg(): PgDatabase | null {
  if (databaseDriver() !== "postgres") return null;
  pgDatabase ??= createPgDatabase(url);
  return pgDatabase;
}

// ── Running as the app's role, for one club (steps 10 and 11) ──────────────
//
// TENANT_SCOPE chooses how queries reach the database:
//
//   off      (default) as the connection's own role (the owner), as before.
//   shadow   as before, and a sample of the reads is run a second time as
//            the app's role for the club, through row-level security; a
//            read that answers differently is put on the shadow record.
//            Every way in is covered: sql`…`, sql.query(), the connections
//            sql.connect() hands out, and Drizzle (orm()).
//   enforce  every statement runs as the app's role for the club
//            (lib/tenant-scope.ts). What row-level security hides, the app
//            can't see.
//
// Any other value counts as "enforce": a typo must not open the door.
export type TenantScopeMode = "off" | "shadow" | "enforce";

export function tenantScopeMode(): TenantScopeMode {
  // The app's own login can't read as the owner, so there is nothing to
  // compare with and nothing to fall back to: every statement is scoped.
  if (appLogin()) return "enforce";
  const v = process.env.TENANT_SCOPE?.trim().toLowerCase();
  if (!v || v === "off") return "off";
  if (v === "shadow") return "shadow";
  return "enforce";
}

/** The share of reads that shadow mode runs twice (TENANT_SHADOW_SAMPLE, default one in ten). */
function shadowSample(): number {
  const v = Number(process.env.TENANT_SHADOW_SAMPLE);
  return Number.isFinite(v) && v >= 0 && v <= 1 && process.env.TENANT_SHADOW_SAMPLE ? v : 0.1;
}

// Bound once, at first use, like @vercel/postgres: the pool and the HTTP
// queries always use the same database for the life of the process.
let pool: Pool | null = null;
let boundUrl: string | null = null;
function url(): string {
  boundUrl ??= connectionString();
  return boundUrl;
}
function getPool(): Pool {
  pool ??= new Pool({ connectionString: url() });
  return pool;
}

/** Builds "$1, $2…" text from a tagged template, like @vercel/postgres. */
function fromTemplate(strings: TemplateStringsArray, values: unknown[]): [string, unknown[]] {
  if (!Array.isArray(strings) || !("raw" in strings)) {
    throw new Error("`sql` is a tagged template: use sql`SELECT …`, or sql.query(text, params).");
  }
  let text = strings[0] ?? "";
  for (let i = 1; i < strings.length; i++) text += `$${i}${strings[i] ?? ""}`;
  return [text, values];
}

async function viaHttp<R extends QueryResultRow>(text: string, params: unknown[]): Promise<QueryResult<R>> {
  const run = neon(url(), { fullResults: true });
  return (await run.query(text, params as Primitive[])) as unknown as QueryResult<R>;
}

/** One statement over HTTP as the app's role for the club: a three-statement transaction in one request. */
async function viaHttpScoped<R extends QueryResultRow>(text: string, params: unknown[]): Promise<QueryResult<R>> {
  const run = neon(url(), { fullResults: true });
  const id = await scopeTenantId();
  const results = await run.transaction([
    run.query(`SET LOCAL ROLE ${APP_ROLE}`),
    run.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(id)]),
    run.query(text, params as Primitive[]),
  ]);
  return results[2] as unknown as QueryResult<R>;
}

/** The pool of whichever driver is in use, unscoped. */
function rawPool(): PoolLike {
  return (viaPg()?.pool() ?? getPool()) as unknown as PoolLike;
}

/**
 * The pool with no club named, whatever TENANT_SCOPE says. ONLY for the
 * row-level-security probe (lib/shadow-log.ts), which sets the role and the
 * club itself and has to be able to name none: given the scoped pool, its
 * "no club named" half would see the club's rows and report a leak that
 * isn't there. Never use it to answer a request.
 */
export function unscopedPool(): PoolLike {
  return rawPool();
}

// The club this deployment serves, looked up once: as the connection's own
// role, or, with the app's own login (which has no rights of its own), as
// the app's role with no club named. The clubs table is a platform table.
let tenantIdPromise: Promise<number> | null = null;
/** Whether that lookup has answered (so asking again needs no connection). */
let tenantIdKnown = false;
function scopeTenantId(): Promise<number> {
  if (!tenantIdPromise) {
    const slug = defaultTenantSlug();
    const text = `SELECT id FROM tenants WHERE slug = $1`;
    const found = (appLogin() ? readScoped(rawPool(), null, text, [slug]) : rawPool().query(text, [slug])) as Promise<{ rows: { id: number }[] }>;
    const lookup = found
      .then((r: { rows: { id: number }[] }) => {
        if (!r.rows[0]) throw new Error(`No club "${slug}" in tenants.`);
        if (tenantIdPromise === lookup) tenantIdKnown = true;
        return r.rows[0].id;
      });
    // A failed lookup isn't remembered: the next query asks again.
    lookup.catch(() => {
      if (tenantIdPromise === lookup) tenantIdPromise = null;
    });
    tenantIdPromise = lookup;
  }
  return tenantIdPromise;
}

// Scoped views of the pool, made once per pool.
let scopedPool: { of: PoolLike; scoped: PoolLike } | null = null;
function scoped(): PoolLike {
  const pool = rawPool();
  if (scopedPool?.of !== pool) scopedPool = { of: pool, scoped: scopePool(pool, scopeTenantId) };
  return scopedPool.scoped;
}

// ── Shadow reads ───────────────────────────────────────────────────────────
// A difference goes on the durable shadow record (the same rows as
// lib/shadow-log.ts writes; written here directly so this file depends on
// nothing that depends on it), once per statement per server instance.
const shadowReported = new Set<string>();

async function reportShadowDifference(text: string, detail: string): Promise<void> {
  const key = text.replace(/\s+/g, " ").trim().slice(0, 400);
  if (shadowReported.has(key) || shadowReported.size >= 50) return;
  shadowReported.add(key);
  console.warn(`[shadow] tenant read differs (${detail}): ${key.slice(0, 160)}`);
  await rawPool()
    .query(`INSERT INTO admin_audit_log (actor_player_id, actor_kind, action, target, meta) VALUES (NULL, 'system', 'shadow.tenant-reads', 'differ', $1::jsonb)`, [
      // The statement's text only: its values are parameters and are not recorded.
      JSON.stringify({ statement: key.slice(0, 300), detail }),
    ])
    .catch(() => {});
}

/** Whether the pool can hand out a connection now, without waiting for one to come back. */
function hasSpareConnection(pool: PoolLike): boolean {
  const p = pool as unknown as { idleCount?: number; totalCount?: number; options?: { max?: number } };
  if (typeof p.idleCount !== "number" || typeof p.totalCount !== "number") return false;
  return p.idleCount > 0 || p.totalCount < (p.options?.max ?? 10);
}

/**
 * Runs a read again as the app's role for the club and compares. Never
 * throws; never changes anything.
 *
 * `held`: the caller is holding a pooled connection (a transaction, or
 * Drizzle's). The comparison needs connections of its own, and waiting for
 * one while holding one is how a pool deadlocks, so each of its reads only
 * starts when the pool has a connection to spare at that moment, and is
 * skipped otherwise. (The check and the borrow happen in the same tick.)
 *
 * Both answers compared here are fresh reads on other connections, so a
 * read inside a transaction is compared as the committed data stands, not
 * with the transaction's own uncommitted writes; the two roles see the same
 * committed data, which is the comparison that matters.
 */
async function shadowRead(text: string, params: unknown[] | undefined, sample: number, held = false): Promise<void> {
  try {
    if (!isReadOnlyStatement(text) || Math.random() >= sample) return;
    const pool = rawPool();
    const spare = () => !held || hasSpareConnection(pool);
    // The club's id is looked up once, and that lookup needs a connection too.
    if (!tenantIdKnown && !spare()) return;
    const id = await scopeTenantId();
    // Compared as a set of rows: without an ORDER BY, the two roles may get
    // the same rows in a different order (their query plans differ), and
    // that isn't a difference in what a club can see.
    const canon = (rows: unknown[]) => JSON.stringify(rows.map((r) => JSON.stringify(r)).sort());
    let asApp: string;
    if (!spare()) return;
    const scopedRead = readScoped(pool, id, text, params);
    try {
      asApp = canon((await scopedRead).rows);
    } catch (err) {
      return await reportShadowDifference(text, `error as the app's role: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
    }
    // The owner's answer, through the same connection type and at the same
    // moment (the first answer may be older, or parsed by the HTTP path).
    if (!spare()) return;
    const asOwner = canon((await pool.query(text, params)).rows);
    if (asOwner === asApp) return;
    // Not the same twice in a row as the owner either: the statement isn't
    // deterministic (now(), random(), no ORDER BY), so it can't be compared.
    if (!spare()) return;
    if (canon((await pool.query(text, params)).rows) !== asOwner) return;
    await reportShadowDifference(text, "rows differ");
  } catch {
    // A shadow read must never break the request it rides on.
  }
}

/** The values of a query() call, whichever way it was passed (text + values, or a config object). */
function paramsOf(args: unknown[]): unknown[] | undefined {
  if (Array.isArray(args[1])) return args[1];
  const values = (args[0] as { values?: unknown } | null)?.values;
  return Array.isArray(values) ? values : undefined;
}

/**
 * Shadow mode for a connection the caller holds (sql.connect(), and the one
 * Drizzle borrows for a transaction): every statement runs exactly as
 * before, on that connection, and a sample of its reads is compared.
 */
function shadowClient<T extends Queryable>(client: T): T {
  const query = async (...args: unknown[]) => {
    const result = await client.query(...args);
    // Callback-style calls return nothing to await and aren't compared.
    if (typeof args[args.length - 1] !== "function") await shadowRead(textOf(args), paramsOf(args), shadowSample(), true);
    return result;
  };
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "query") return query;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Shadow mode for the pool Drizzle runs on: every repository query is run
 * as before and a sample of the reads is compared, like sql`…` and
 * sql.query() (audit C0b: these were the reads shadow mode didn't see).
 */
function shadowPool<T extends PoolLike>(pool: T): T {
  const query = async (...args: unknown[]) => {
    const result = await pool.query(...args);
    if (typeof args[args.length - 1] !== "function") await shadowRead(textOf(args), paramsOf(args), shadowSample());
    return result;
  };
  const connect = async () => shadowClient(await pool.connect());
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === "query") return query;
      if (prop === "connect") return connect;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function runQuery<R extends QueryResultRow>(text: string, params: unknown[] | undefined, overHttp: boolean): Promise<QueryResult<R>> {
  const mode = tenantScopeMode();
  const tcp = viaPg();
  if (mode === "enforce") {
    if (!tcp && overHttp) return viaHttpScoped<R>(text, params ?? []);
    return (await scoped().query(text, params)) as unknown as QueryResult<R>;
  }
  const result = tcp
    ? ((await tcp.sql.query(text, params)) as unknown as QueryResult<R>)
    : overHttp
      ? await viaHttp<R>(text, params ?? [])
      : await getPool().query<R>(text, params);
  if (mode === "shadow") await shadowRead(text, params, shadowSample());
  return result;
}

export type SqlTag = {
  <R extends QueryResultRow = AnyRow>(strings: TemplateStringsArray, ...values: Primitive[]): Promise<QueryResult<R>>;
  query<R extends QueryResultRow = AnyRow>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
  connect(): Promise<PoolClient>;
};

export const sql: SqlTag = Object.assign(
  // async throughout: a missing database is a rejected promise, never a throw.
  async <R extends QueryResultRow = AnyRow>(strings: TemplateStringsArray, ...values: Primitive[]) => {
    const [text, params] = fromTemplate(strings, values);
    return runQuery<R>(text, params, true);
  },
  {
    query: async <R extends QueryResultRow = AnyRow>(text: string, params?: unknown[]) => runQuery<R>(text, params, false),
    connect: async () => {
      // Transactions and locks: as the app's role for the club when enforced.
      if (tenantScopeMode() === "enforce") return (await scoped().connect()) as unknown as PoolClient;
      const tcp = viaPg();
      // The two drivers' pooled clients have the same shape (query, release).
      const client = tcp ? ((await tcp.sql.connect()) as unknown as PoolClient) : await getPool().connect();
      // Shadow mode: the transaction runs as before; a sample of its reads is compared.
      return tenantScopeMode() === "shadow" ? shadowClient(client) : client;
    },
  },
);

/** Same object as `sql`; `db.connect()` reads better for transactions. */
export const db = sql;

export { types };

let ormInstance: NeonDatabase<typeof schema> | null = null;
let scopedOrm: { of: PoolLike; orm: NeonDatabase<typeof schema> } | null = null;
let shadowOrm: { of: PoolLike; orm: NeonDatabase<typeof schema> } | null = null;
/** Drizzle on the shared pool (typed by db/schema.ts). The same query builder on either driver. */
export function orm(): NeonDatabase<typeof schema> {
  if (tenantScopeMode() === "enforce") {
    // Drizzle on the scoped pool: the same builder, every statement as the app's role.
    const pool = scoped();
    if (scopedOrm?.of !== pool) {
      scopedOrm = { of: pool, orm: viaPg() ? (drizzlePg({ client: pool as unknown as pg.Pool, schema }) as unknown as NeonDatabase<typeof schema>) : drizzle({ client: pool as unknown as Pool, schema }) };
    }
    return scopedOrm.orm;
  }
  if (tenantScopeMode() === "shadow") {
    // Drizzle on a pool that compares a sample of its reads.
    const pool = rawPool();
    if (shadowOrm?.of !== pool) {
      const watched = shadowPool(pool);
      shadowOrm = { of: pool, orm: viaPg() ? (drizzlePg({ client: watched as unknown as pg.Pool, schema }) as unknown as NeonDatabase<typeof schema>) : drizzle({ client: watched as unknown as Pool, schema }) };
    }
    return shadowOrm.orm;
  }
  const tcp = viaPg();
  if (tcp) return tcp.orm() as unknown as NeonDatabase<typeof schema>;
  ormInstance ??= drizzle({ client: getPool(), schema });
  return ormInstance;
}

export { schema };

/** Closes the pool and forgets the database (scripts and tests). */
export async function closeDatabase(): Promise<void> {
  const p = pool;
  pool = null;
  boundUrl = null;
  ormInstance = null;
  scopedOrm = null;
  shadowOrm = null;
  scopedPool = null;
  tenantIdPromise = null;
  tenantIdKnown = false;
  shadowReported.clear();
  const tcp = pgDatabase;
  pgDatabase = null;
  await tcp?.close();
  await p?.end();
}
