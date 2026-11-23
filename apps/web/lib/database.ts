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
import * as schema from "@luvallplay/db/schema";
import { createPgDatabase, type PgDatabase } from "./database-pg.ts";

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

function connectionString(): string {
  const url = process.env.POSTGRES_URL;
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

export type SqlTag = {
  <R extends QueryResultRow = AnyRow>(strings: TemplateStringsArray, ...values: Primitive[]): Promise<QueryResult<R>>;
  query<R extends QueryResultRow = AnyRow>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
  connect(): Promise<PoolClient>;
};

export const sql: SqlTag = Object.assign(
  // async throughout: a missing database is a rejected promise, never a throw.
  async <R extends QueryResultRow = AnyRow>(strings: TemplateStringsArray, ...values: Primitive[]) => {
    const tcp = viaPg();
    if (tcp) return (await tcp.sql(strings, ...values)) as unknown as QueryResult<R>;
    const [text, params] = fromTemplate(strings, values);
    return viaHttp<R>(text, params);
  },
  {
    query: async <R extends QueryResultRow = AnyRow>(text: string, params?: unknown[]) => {
      const tcp = viaPg();
      if (tcp) return (await tcp.sql.query(text, params)) as unknown as QueryResult<R>;
      return getPool().query<R>(text, params);
    },
    connect: async () => {
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
/** Drizzle on the shared pool (typed by db/schema.ts). The same query builder on either driver. */
export function orm(): NeonDatabase<typeof schema> {
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
  const tcp = pgDatabase;
  pgDatabase = null;
  await tcp?.close();
  await p?.end();
}
