// Postgres access for the data guard (node-postgres works with Neon and a
// local Postgres alike). Snapshots run in one REPEATABLE READ READ ONLY
// transaction: every table is read at the same instant, and the database
// refuses any write, so taking a snapshot of production is safe.

import pg from "pg";
import { DEFAULT_CONFIG, snapshot, type GuardConfig, type Query, type Snapshot } from "./core.ts";

/** node-postgres by default; Neon over WebSocket with DB_DRIVER=neon-ws (scripts/db-client.mjs). */
export async function clientFor(url: string): Promise<pg.Client> {
  const { dbClient } = await import("../db-client.mjs");
  return (await dbClient(url, "data-guard")) as pg.Client;
}

export function queryFor(client: pg.Client): Query {
  return async (text, params) => (await client.query(text, params as unknown[] | undefined)).rows;
}

/** Host and database name only — never credentials — for logs and reports. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(unparseable connection string)";
  }
}

export async function takeSnapshot(url: string, opts: { label?: string; config?: GuardConfig } = {}): Promise<Snapshot> {
  const config = opts.config ?? DEFAULT_CONFIG;
  const client = await clientFor(url);
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    // Same text rendering of dates and numbers on every machine.
    await client.query("SET LOCAL TimeZone = 'UTC'");
    await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
    await client.query("SET LOCAL extra_float_digits = 3");
    await client.query("SET LOCAL statement_timeout = '300s'");
    await client.query(`SELECT set_config('search_path', $1, true)`, [config.schema]);
    const snap = await snapshot(queryFor(client), { ...opts, config });
    await client.query("ROLLBACK");
    return snap;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}
