// The second database driver (build plan §6.9; Phase 3 step 6): standard
// Postgres over TCP (node-postgres), for regions that aren't on Neon. The
// Neon serverless driver only works through Neon's proxy; a region on plain
// managed Postgres (Hanoi, decision AE) uses this one.
//
// Same surface as lib/database.ts, which chooses between the two with
// DATABASE_DRIVER. The golden master tests run every repository function on
// both and require identical results (tests/golden-master.test.ts).
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@luvallplay/db/schema";

// DATE columns stay 'YYYY-MM-DD' strings, as on the Neon driver (OID 1082).
pg.types.setTypeParser(1082, (val: string) => val);

type Primitive = string | number | boolean | bigint | null | undefined | Date;

/** Builds "$1, $2…" text from a tagged template. */
function fromTemplate(strings: TemplateStringsArray, values: unknown[]): [string, unknown[]] {
  if (!Array.isArray(strings) || !("raw" in strings)) {
    throw new Error("`sql` is a tagged template: use sql`SELECT …`, or sql.query(text, params).");
  }
  let text = strings[0] ?? "";
  for (let i = 1; i < strings.length; i++) text += "$" + i + (strings[i] ?? "");
  return [text, values];
}

export type PgDatabase = {
  sql: {
    (strings: TemplateStringsArray, ...values: Primitive[]): Promise<pg.QueryResult>;
    query(text: string, params?: unknown[]): Promise<pg.QueryResult>;
    connect(): Promise<pg.PoolClient>;
  };
  orm(): NodePgDatabase<typeof schema>;
  close(): Promise<void>;
};

/**
 * A database on node-postgres. `connectionString` is called once, at first
 * use, like the Neon client. Pool size: PG_POOL_MAX (default 10).
 */
export function createPgDatabase(connectionString: () => string): PgDatabase {
  let pool: pg.Pool | null = null;
  let ormInstance: NodePgDatabase<typeof schema> | null = null;
  const getPool = (): pg.Pool => {
    if (!pool) {
      const max = Number(process.env.PG_POOL_MAX);
      pool = new pg.Pool({ connectionString: connectionString(), max: Number.isInteger(max) && max > 0 ? max : 10 });
      // An idle connection dropped by the server must not crash the process.
      pool.on("error", (err) => console.error("[database] idle connection error:", err.message));
    }
    return pool;
  };
  const sql = Object.assign(
    // async throughout: a missing database is a rejected promise, never a throw.
    async (strings: TemplateStringsArray, ...values: Primitive[]) => {
      const [text, params] = fromTemplate(strings, values);
      return getPool().query(text, params);
    },
    {
      query: async (text: string, params?: unknown[]) => getPool().query(text, params),
      connect: async () => getPool().connect(),
    },
  );
  return {
    sql,
    orm: () => (ormInstance ??= drizzle({ client: getPool(), schema })),
    close: async () => {
      const p = pool;
      pool = null;
      ormInstance = null;
      await p?.end();
    },
  };
}
