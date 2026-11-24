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
import { APP_ROLE, isReadOnlyStatement, readScoped, scopePool, type PoolLike } from "./tenant-scope.ts";

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

// The club this deployment serves, looked up once: as the connection's own
// role, or, with the app's own login (which has no rights of its own), as
// the app's role with no club named. The clubs table is a platform table.
let tenantIdPromise: Promise<number> | null = null;
function scopeTenantId(): Promise<number> {
  if (!tenantIdPromise) {
    const slug = defaultTenantSlug();
    const text = `SELECT id FROM tenants WHERE slug = $1`;
    const found = (appLogin() ? readScoped(rawPool(), null, text, [slug]) : rawPool().query(text, [slug])) as Promise<{ rows: { id: number }[] }>;
    const lookup = found
      .then((r: { rows: { id: number }[] }) => {
        if (!r.rows[0]) throw new Error(`No club "${slug}" in tenants.`);
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

/** Runs a read again as the app's role for the club and compares. Never throws; never changes anything. */
async function shadowRead(text: string, params: unknown[] | undefined, sample: number): Promise<void> {
  try {
    if (!isReadOnlyStatement(text) || Math.random() >= sample) return;
    const pool = rawPool();
    const id = await scopeTenantId();
    // Compared as a set of rows: without an ORDER BY, the two roles may get
    // the same rows in a different order (their query plans differ), and
    // that isn't a difference in what a club can see.
    const canon = (rows: unknown[]) => JSON.stringify(rows.map((r) => JSON.stringify(r)).sort());
    let asApp: string;
    try {
      asApp = canon((await readScoped(pool, id, text, params)).rows);
    } catch (err) {
      return await reportShadowDifference(text, `error as the app's role: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
    }
    // The owner's answer, through the same connection type and at the same
    // moment (the first answer may be older, or parsed by the HTTP path).
    const asOwner = canon((await pool.query(text, params)).rows);
    if (asOwner === asApp) return;
    // Not the same twice in a row as the owner either: the statement isn't
    // deterministic (now(), random(), no ORDER BY), so it can't be compared.
    if (canon((await pool.query(text, params)).rows) !== asOwner) return;
    await reportShadowDifference(text, "rows differ");
  } catch {
    // A shadow read must never break the request it rides on.
  }
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
      if (tcp) return (await tcp.sql.connect()) as unknown as PoolClient;
      return getPool().connect();
    },
  },
);

/** Same object as `sql`; `db.connect()` reads better for transactions. */
export const db = sql;

export { types };

let ormInstance: NeonDatabase<typeof schema> | null = null;
let scopedOrm: { of: PoolLike; orm: NeonDatabase<typeof schema> } | null = null;
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
  scopedPool = null;
  tenantIdPromise = null;
  shadowReported.clear();
  const tcp = pgDatabase;
  pgDatabase = null;
  await tcp?.close();
  await p?.end();
}
