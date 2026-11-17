import { sql } from "@vercel/postgres";

// Start-up table checks, once per deployment instead of once per server.
//
// Every module creates its tables with idempotent DDL (CREATE TABLE IF NOT
// EXISTS ...). Run on every cold start, that was ~70 statements one after
// another: ~16 s when the database is far away. Now the first server of a
// new deployment runs each module's DDL and records it in `schema_runs`;
// every later cold start of the same deployment does one query to see what
// has already run and skips the rest. A new deployment (new code, maybe new
// columns) runs the DDL again once. Local development always runs it.

const DEPLOY = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "";
const GATED = Boolean(DEPLOY) && process.env.NODE_ENV === "production";

let donePromise: Promise<Set<string>> | null = null;

async function loadDone(): Promise<Set<string>> {
  try {
    const { rows } = await sql.query(`SELECT name FROM schema_runs WHERE deploy = $1;`, [DEPLOY]);
    return new Set(rows.map((r) => r.name as string));
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err;
    await sql.query(`
      CREATE TABLE IF NOT EXISTS schema_runs (
        name TEXT NOT NULL,
        deploy TEXT NOT NULL,
        ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (name, deploy)
      );`);
    return new Set();
  }
}

/** Runs a module's table DDL unless this deployment already has. */
export async function onceThisDeploy(name: string, ddl: () => Promise<void>): Promise<void> {
  if (!GATED) return ddl();
  if (!donePromise) {
    donePromise = loadDone().catch((err) => {
      donePromise = null;
      throw err;
    });
  }
  const done = await donePromise;
  if (done.has(name)) return;
  await ddl();
  await sql.query(`INSERT INTO schema_runs (name, deploy) VALUES ($1, $2) ON CONFLICT DO NOTHING;`, [name, DEPLOY]);
  done.add(name);
}
